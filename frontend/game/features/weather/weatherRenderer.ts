import type { SimEventWire } from '@terra/contracts';
import {
  getRainLevel, getWeatherParams, isTwisterAvailable, isUserEditingWeather, isWeatherOn,
  onWeatherAction, onWeatherUserEdit, setWeather, setWeatherParams, triggerWaterElectrocution,
  type WeatherActionKind, type WeatherParams,
} from '@terra/render/core/weatherConfig';
import { getWindParams, onWindUserEdit, setWindParams } from '@terra/render/core/windConfig';
import { HEX_TERRAIN, tileXZ } from '@terra/render/planets/hex';
import {
  LightningStrikeFx, MeteorStrikeFx, readWeatherParams, ScreenWeatherOverlay, TwisterFx,
  type ActiveTwisterSnapshot,
} from '@terra/render/weather';
import { hexIndex } from '@terra/sim/grid/hex';
import type * as THREE from 'three';
import type { FeatureContext, GameView, RendererDef, RendererInstance } from '../../core/registry/types';
import type { ClientView } from '../../store/replica/viewCodec';
import type { WorldStore } from '../../store/WorldStore';
import { ownColonyIndex } from '../shared/colony';
import '../shared/scene3d';
import { resolveTargetTile } from './commands';
import { HqRespawnModal } from './hqRespawnModal';
import {
  clearLightningTilesOnTerrain,
  clearMeteorTilesOnTerrain,
  clearTwisterTreesOnTerrain,
  computeCraterDiscTiles,
  expandLightningTiles,
  extractOverloadedBuildings,
  purgeUnsyncedPreviewTwisters,
  resolveCamera,
  resolveHeightAt,
  resolveHexTerrain,
  resolveScene,
} from './parts/terrainSync';

export { HqRespawnModal } from './hqRespawnModal';

export interface WeatherBlobView {
  rainIntensity?: number; rainLevel?: 'none' | 'minor' | 'heavy'; stormActive?: boolean;
  activeTwisters?: ReadonlyArray<ActiveTwisterSnapshot>; overloadUntilByEntity?: Record<string, number>;
  craters?: ReadonlyArray<{ id?: number; q: number; r: number; tiles?: ReadonlyArray<{ q: number; r: number }> }>;
  lightningSites?: ReadonlyArray<{ id?: number; q: number; r: number; tiles?: ReadonlyArray<{ q: number; r: number }> }>;
  lastMeteor?: { q: number; r: number; tick: number; tiles?: Array<{ q: number; r: number }> };
  lastLightning?: { q: number; r: number; tick: number; hitWater?: boolean; tiles?: Array<{ q: number; r: number }> };
}

const DEDUP_WINDOW_MS = 650, USER_EDIT_THROTTLE_MS = 120;
const getNowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class WeatherHazardRenderer implements RendererInstance {
  public readonly screenOverlay: ScreenWeatherOverlay;
  public readonly hqRespawnModal: HqRespawnModal;
  public readonly meteorFx: MeteorStrikeFx | null;
  public readonly twisterFx: TwisterFx | null;
  public readonly lightningFx: LightningStrikeFx | null;

  private readonly offServerEvents?: () => void;
  private readonly offRenderEvents?: () => void;
  private readonly offWeatherAction: () => void;
  private readonly offWeatherUserEdit: () => void;
  private readonly offWindUserEdit: () => void;
  private readonly seenEvents = new Map<string, number>();
  private readonly pendingMeteorClears: Array<{ tiles: Array<{ q: number; r: number }>; remainingS: number }> = [];
  private lastMeteorTick = -1;
  private lastLightningTick = -1;
  private hasUserEditedWeather = false;
  private lastSentWeatherOn = isWeatherOn();
  private lastSentRainIntensity = getWeatherParams().rainIntensity;
  private lastSentStormActive = getWeatherParams().stormActive;
  private weatherEditTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWeatherSendMs = -Infinity;
  private windEditTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWindSendMs = -Infinity;
  private lastSentWindPct = Math.round(getWindParams().strength * 100);

  constructor(private readonly ctx: FeatureContext) {
    const parentEl = ((ctx.services as { uiParent?: HTMLElement }).uiParent ?? (typeof document !== 'undefined' ? document.body : null)) || null;
    this.screenOverlay = new ScreenWeatherOverlay(parentEl);
    this.hqRespawnModal = new HqRespawnModal(ctx, parentEl);
    const scene = resolveScene(ctx);
    const onShake = (amp: number) => this.applyCameraShake(amp);

    if (scene) {
      this.meteorFx = new MeteorStrikeFx(scene, { screenOverlay: this.screenOverlay, onShake, projectToScreen: (wp) => this.projectWorldToScreenPercent(wp) });
      this.twisterFx = new TwisterFx(scene);
      this.lightningFx = new LightningStrikeFx(scene, { screenOverlay: this.screenOverlay, onShake });
      this.hqRespawnModal.setImpactDelayProvider(() => this.meteorFx?.getRemainingDescentTime() ?? 0);
    } else {
      this.meteorFx = null; this.twisterFx = null; this.lightningFx = null;
    }
    ctx.services.weatherPreview = {
      triggerMeteor: (q, r) => this.playMeteor(q, r),
      triggerTwister: (q, r, dirDeg) => this.playTwister(q, r, dirDeg),
      triggerLightning: (q, r) => this.playLightning([{ q, r }]),
    };
    const store = ctx.services.store as Partial<WorldStore> | undefined;
    this.offRenderEvents = store?.onRenderEvents?.((events) => this.handleSimEvents(events));
    this.offServerEvents = store?.onServerEvents?.((events) => this.handleSimEvents(events));
    this.offWeatherAction = onWeatherAction((action, payload) => this.handleWeatherAction(action, payload));
    this.offWeatherUserEdit = onWeatherUserEdit((params, on) => this.handleWeatherUserEdit(params, on));
    this.offWindUserEdit = onWindUserEdit((params) => this.handleWindUserEdit(params.strength));
  }

  private handleWeatherUserEdit(params: Readonly<WeatherParams>, on: boolean): void {
    this.hasUserEditedWeather = true;
    const effRain = !on ? 0 : params.rainIntensity, effStorm = on && params.stormActive;
    const rainChanged = Math.abs(effRain - this.lastSentRainIntensity) > 1e-4 || on !== this.lastSentWeatherOn;
    const stormChanged = effStorm !== this.lastSentStormActive;
    if (!rainChanged && !stormChanged) return;
    const elapsed = getNowMs() - this.lastWeatherSendMs;
    if (on !== this.lastSentWeatherOn || stormChanged || elapsed >= USER_EDIT_THROTTLE_MS) this.flushWeatherUserEdit();
    else if (this.weatherEditTimer === null) {
      this.weatherEditTimer = setTimeout(() => this.flushWeatherUserEdit(), Math.max(16, USER_EDIT_THROTTLE_MS - elapsed));
    }
  }

  private flushWeatherUserEdit(): void {
    if (this.weatherEditTimer !== null) { clearTimeout(this.weatherEditTimer); this.weatherEditTimer = null; }
    const params = getWeatherParams(), on = isWeatherOn(), send = this.ctx.services.sendCommand;
    const effRain = !on ? 0 : params.rainIntensity, effStorm = on && params.stormActive;
    const rainChanged = Math.abs(effRain - this.lastSentRainIntensity) > 1e-4 || on !== this.lastSentWeatherOn;
    const stormChanged = effStorm !== this.lastSentStormActive;
    this.lastSentWeatherOn = on; this.lastSentRainIntensity = effRain; this.lastSentStormActive = effStorm;
    this.lastWeatherSendMs = getNowMs();
    if (rainChanged) send?.('dev.rain', { level: !on ? 'none' : getRainLevel(params.rainIntensity), intensity: effRain });
    if (stormChanged) {
      send?.('dev.storm', { active: effStorm, rain: effStorm ? 'heavy' : (!on ? 'none' : getRainLevel(params.rainIntensity)), lightning: effStorm, colonyIndex: ownColonyIndex(this.ctx.services) });
    }
  }

  private handleWindUserEdit(strength: number): void {
    const pct = Math.round(strength * 100);
    if (pct === this.lastSentWindPct && this.windEditTimer === null) return;
    const elapsed = getNowMs() - this.lastWindSendMs;
    if (elapsed >= USER_EDIT_THROTTLE_MS) this.flushWindUserEdit();
    else if (this.windEditTimer === null) {
      this.windEditTimer = setTimeout(() => this.flushWindUserEdit(), Math.max(16, USER_EDIT_THROTTLE_MS - elapsed));
    }
  }

  private flushWindUserEdit(): void {
    if (this.windEditTimer !== null) { clearTimeout(this.windEditTimer); this.windEditTimer = null; }
    const pct = Math.round(getWindParams().strength * 100);
    if (pct === this.lastSentWindPct) return;
    this.lastSentWindPct = pct; this.lastWindSendMs = getNowMs();
    this.ctx.services.sendCommand?.('dev.setwind', { pct });
  }

  private isDuplicate(key: string): boolean {
    const now = getNowMs();
    for (const [k, ts] of [...this.seenEvents]) if (now - ts > DEDUP_WINDOW_MS * 4) this.seenEvents.delete(k);
    const prev = this.seenEvents.get(key);
    if (prev !== undefined && now - prev < DEDUP_WINDOW_MS) return true;
    this.seenEvents.set(key, now);
    return false;
  }

  public projectWorldToScreenPercent(worldPos: THREE.Vector3): { x: number; y: number } | null {
    const camera = resolveCamera(this.ctx);
    if (!camera || typeof camera.matrixWorldInverse === 'undefined') return null;
    const v = worldPos.clone().project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    if (v.z > 1) return { x: -999, y: -999 };
    return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100 };
  }

  public playMeteor(q: number, r: number, tiles?: ReadonlyArray<{ q: number; r: number }>): void {
    if (this.isDuplicate(`meteor:${q},${r}`)) return;
    const heightAt = resolveHeightAt(this.ctx);
    const craterTiles = computeCraterDiscTiles(q, r, tiles);
    this.pendingMeteorClears.push({ tiles: craterTiles, remainingS: 2.05 });
    if (this.meteorFx) this.meteorFx.strikeTile(q, r, heightAt, craterTiles);
    else this.screenOverlay.triggerMeteorScreenSequence();
  }

  public playTwister(q: number, r: number, dirDeg?: number, id?: number, durationTicks?: number): void {
    const dedupKey = id !== undefined ? `twister:id:${id}` : `twister:preview:${q},${r}`;
    if (this.isDuplicate(dedupKey)) return;
    if (id !== undefined) purgeUnsyncedPreviewTwisters(this.twisterFx);
    this.twisterFx?.spawnTwister({
      id, q, r, dirDeg, durationS: durationTicks ? durationTicks * 0.1 + 3 : 14,
      previewVictims: id === undefined, heightAt: resolveHeightAt(this.ctx),
    });
  }

  public playLightning(tiles: ReadonlyArray<{ q: number; r: number }>, hitWaterFlag?: boolean): void {
    const first = tiles[0] ?? { q: 0, r: 0 }, terrain = resolveHexTerrain(this.ctx), heightAt = resolveHeightAt(this.ctx);
    const fourTiles = expandLightningTiles(tiles.length > 0 ? tiles : [first]);
    clearLightningTilesOnTerrain(terrain, fourTiles);
    if (this.isDuplicate(`lightning:${first.q},${first.r}`)) return;
    const isWater = (q: number, r: number): boolean => {
      const lt = this.ctx.services.store?.latestTiles, rad = terrain?.radius ?? this.ctx.services.store?.latest?.planet.radius;
      if (lt?.terrain && rad) { const tc = lt.terrain[hexIndex(rad).indexOf(q, r)]; return tc === HEX_TERRAIN.shallow || tc === HEX_TERRAIN.deep; }
      const [wx, wz] = tileXZ(q, r); return heightAt(wx, wz) < -0.05;
    };
    if (hitWaterFlag || fourTiles.some((t) => isWater(t.q, t.r))) { const [wx, wz] = tileXZ(first.q, first.r); triggerWaterElectrocution(wx, wz, 1.0); }
    if (this.lightningFx) this.lightningFx.strikeFourHexes(fourTiles, heightAt, isWater);
    else this.screenOverlay.triggerLightningScreenFlash(readWeatherParams().lightningFlash);
  }

  private handleSimEvents(events: readonly SimEventWire[]): void {
    for (const ev of events) {
      const d = (ev.data ?? {}) as Record<string, unknown>;
      if (ev.kind === 'meteorImpact') {
        this.playMeteor(typeof d.q === 'number' ? d.q : 0, typeof d.r === 'number' ? d.r : 0, Array.isArray(d.tiles) ? (d.tiles as Array<{ q: number; r: number }>) : undefined);
      } else if (ev.kind === 'lightningStrike') {
        const q = typeof d.q === 'number' ? d.q : 0;
        const r = typeof d.r === 'number' ? d.r : 0;
        this.playLightning(Array.isArray(d.tiles) && d.tiles.length > 0 ? (d.tiles as Array<{ q: number; r: number }>) : [{ q, r }]);
      } else if (ev.kind === 'twisterStarted') {
        const q = typeof d.q === 'number' ? d.q : 0;
        const r = typeof d.r === 'number' ? d.r : 0;
        const dirDeg = typeof d.dirRad === 'number' ? (d.dirRad * 180) / Math.PI : undefined;
        this.playTwister(q, r, dirDeg, typeof d.twisterId === 'number' ? d.twisterId : undefined, typeof d.durationTicks === 'number' ? d.durationTicks : undefined);
      } else if (ev.kind === 'stormStarted') {
        const nextRain = Math.max(0.65, readWeatherParams().rainIntensity);
        this.lastSentStormActive = true;
        this.lastSentRainIntensity = nextRain;
        setWeather(true, 'sync');
        setWeatherParams({ stormActive: true, stormDarkness: 0.75, rainIntensity: nextRain }, 'sync');
      } else if (ev.kind === 'stormEnded') {
        this.lastSentStormActive = false;
        setWeatherParams({ stormActive: false, stormDarkness: 0 }, 'sync');
      }
    }
    this.hqRespawnModal.handleSimEvents(events);
  }

  private applySyncedPreset(rainIntensity: number, stormActive: boolean, windStrength?: number): void {
    this.lastSentWeatherOn = true;
    this.lastSentRainIntensity = rainIntensity;
    this.lastSentStormActive = stormActive;
    setWeather(true, 'sync');
    if (windStrength !== undefined) {
      this.lastSentWindPct = Math.round(windStrength * 100);
      setWindParams({ strength: windStrength }, 'sync');
    }
    setWeatherParams({ rainIntensity, stormActive, ...(stormActive ? { stormDarkness: 0.75 } : { stormDarkness: 0 }) }, 'sync');
  }

  private handleWeatherAction(action: WeatherActionKind, payload?: { q?: number; r?: number }): void {
    const send = this.ctx.services.sendCommand;
    const colonyIndex = ownColonyIndex(this.ctx.services);
    const target = payload?.q !== undefined && payload?.r !== undefined ? { q: payload.q, r: payload.r } : resolveTargetTile([], this.ctx, { dq: 3, dr: -1 });

    switch (action) {
      case 'meteor': send?.('dev.meteor', { q: target.q, r: target.r, hexCount: 37, colonyIndex }); this.playMeteor(target.q, target.r); break;
      case 'twister': {
        if (this.windEditTimer !== null) this.flushWindUserEdit();
        if (this.weatherEditTimer !== null) this.flushWeatherUserEdit();
        const wasAvailable = isWeatherOn() && isTwisterAvailable();
        this.lastSentWeatherOn = true;
        setWeather(true, 'user');
        if (!wasAvailable) {
          const nextStrength = Math.max(1.35, getWindParams().strength);
          const pct = Math.round(nextStrength * 100);
          this.lastSentWindPct = pct; this.lastSentRainIntensity = 0.35; this.lastSentStormActive = false;
          setWindParams({ strength: nextStrength }, 'user');
          setWeatherParams({ rainIntensity: 0.35, stormActive: false }, 'user');
          send?.('dev.setwind', { pct }); send?.('dev.rain', { level: 'minor', intensity: 0.35 });
        }
        const maybePromise = send?.('dev.twister', { q: target.q, r: target.r, colonyIndex });
        if (maybePromise && typeof (maybePromise as Promise<{ ok?: boolean; code?: string }>).then === 'function') {
          void (maybePromise as Promise<{ ok?: boolean; code?: string }>).then((res) => {
            if (res && res.ok === false && res.code === 'weather_conditions_not_met') {
              send?.('dev.setwind', { pct: 135 }); send?.('dev.rain', { level: 'minor', intensity: 0.35 });
              send?.('dev.twister', { q: target.q, r: target.r, colonyIndex });
            }
          });
        }
        this.playTwister(target.q, target.r);
        break;
      }
      case 'lightning': send?.('dev.lightning', { q: target.q, r: target.r, hexCount: 4, colonyIndex }); this.playLightning([{ q: target.q, r: target.r }]); break;
      case 'storm': {
        const nextActive = !readWeatherParams().stormActive;
        this.applySyncedPreset(nextActive ? 0.8 : 0, nextActive);
        send?.('dev.storm', { active: nextActive, rain: nextActive ? 'heavy' : 'none', lightning: nextActive, colonyIndex });
        break;
      }
      case 'rain-minor': this.applySyncedPreset(0.3, false); send?.('dev.rain', { level: 'minor', intensity: 0.3, colonyIndex }); break;
      case 'rain-heavy': this.applySyncedPreset(0.85, false); send?.('dev.rain', { level: 'heavy', intensity: 0.85, colonyIndex }); break;
      case 'twister-ready':
        this.applySyncedPreset(0.3, false, 1.5);
        send?.('dev.setwind', { pct: 150 }); send?.('dev.rain', { level: 'minor', intensity: 0.3, colonyIndex });
        break;
      case 'clear':
        this.applySyncedPreset(0, false);
        send?.('dev.storm', { active: false, rain: 'none', lightning: false, colonyIndex });
        send?.('dev.rain', { level: 'none', intensity: 0, colonyIndex });
        break;
    }
  }

  private syncWeatherBlob(simView: ClientView, weatherBlob: WeatherBlobView, heightAt: (x: number, z: number) => number): void {
    const userEditing = this.hasUserEditedWeather && isUserEditingWeather();
    if (!userEditing) {
      if (!isWeatherOn() && ((typeof weatherBlob.rainIntensity === 'number' && weatherBlob.rainIntensity > 0.01) || weatherBlob.stormActive)) {
        this.lastSentWeatherOn = true;
        setWeather(true, 'sync');
      }
      const patch: Partial<WeatherParams> = {};
      if (typeof weatherBlob.rainIntensity === 'number') {
        patch.rainIntensity = weatherBlob.rainIntensity;
        this.lastSentRainIntensity = weatherBlob.rainIntensity;
      }
      if (typeof weatherBlob.stormActive === 'boolean') {
        patch.stormActive = weatherBlob.stormActive;
        patch.stormDarkness = weatherBlob.stormActive ? 0.75 : 0;
        this.lastSentStormActive = weatherBlob.stormActive;
      }
      if (Object.keys(patch).length > 0) setWeatherParams(patch, 'sync');
    }

    const terrain = resolveHexTerrain(this.ctx);
    if (weatherBlob.lastMeteor && weatherBlob.lastMeteor.tick !== this.lastMeteorTick) {
      this.lastMeteorTick = weatherBlob.lastMeteor.tick;
      this.playMeteor(weatherBlob.lastMeteor.q, weatherBlob.lastMeteor.r, weatherBlob.lastMeteor.tiles);
    }
    if (weatherBlob.lastLightning && weatherBlob.lastLightning.tick !== this.lastLightningTick) {
      this.lastLightningTick = weatherBlob.lastLightning.tick;
      const lTiles = expandLightningTiles(weatherBlob.lastLightning.tiles?.length ? weatherBlob.lastLightning.tiles : [{ q: weatherBlob.lastLightning.q, r: weatherBlob.lastLightning.r }]);
      clearLightningTilesOnTerrain(terrain, lTiles);
      this.playLightning(lTiles, weatherBlob.lastLightning.hitWater);
    }

    const craters = weatherBlob.craters ?? [];
    this.meteorFx?.syncCraters(craters, undefined, heightAt);
    for (const c of craters) {
      if (!this.meteorFx?.hasDescendingStrikeNear(c.q, c.r)) {
        clearMeteorTilesOnTerrain(terrain, computeCraterDiscTiles(c.q, c.r, c.tiles));
      }
    }
    this.lightningFx?.syncLightningSites(weatherBlob.lightningSites, heightAt);
    for (const s of weatherBlob.lightningSites ?? []) {
      clearLightningTilesOnTerrain(terrain, expandLightningTiles(s.tiles?.length ? s.tiles : [{ q: s.q, r: s.r }]));
    }

    if (weatherBlob.activeTwisters) {
      if (weatherBlob.activeTwisters.length > 0) purgeUnsyncedPreviewTwisters(this.twisterFx);
      this.twisterFx?.syncTwisters(weatherBlob.activeTwisters, heightAt, simView.tick);
      clearTwisterTreesOnTerrain(terrain, this.twisterFx, weatherBlob.activeTwisters);
    }
  }

  public update(view: GameView, dt: number): void {
    const step = Math.max(0, dt);
    const simView = view.sim?.view ?? this.ctx.services.store?.latest ?? null;
    const heightAt = resolveHeightAt(this.ctx);
    const terrain = resolveHexTerrain(this.ctx);

    for (let i = this.pendingMeteorClears.length - 1; i >= 0; i--) {
      const p = this.pendingMeteorClears[i]!;
      p.remainingS -= step;
      if (p.remainingS <= 0) { clearMeteorTilesOnTerrain(terrain, p.tiles); this.pendingMeteorClears.splice(i, 1); }
    }

    if (simView) {
      const weatherBlob = simView.blobs?.weather as WeatherBlobView | undefined;
      if (weatherBlob) this.syncWeatherBlob(simView, weatherBlob, heightAt);
      const overloaded = extractOverloadedBuildings(simView, weatherBlob, heightAt, this.ctx.services.scene3d ? (q, r) => this.ctx.services.scene3d!.tileToWorld(q, r) : undefined);
      this.lightningFx?.syncOverloadedBuildings(overloaded);
    }
    this.screenOverlay.update(step);
    this.meteorFx?.update(step);
    this.twisterFx?.update(step);
    if ((this.twisterFx?.getActiveCount() ?? 0) > 0) clearTwisterTreesOnTerrain(terrain, this.twisterFx);
    this.lightningFx?.update(step);
    this.hqRespawnModal.syncAndStep(simView, step);
    const shake = Math.max(this.meteorFx?.getCameraShake() ?? 0, this.lightningFx?.getCameraShake() ?? 0);
    if (shake > 0) this.applyCameraShake(shake);
  }

  private applyCameraShake(amp: number): void {
    const rtsCam = (this.ctx.services as { rtsCamera?: { getShake?(): number; setShake?(a: number): void } | null }).rtsCamera;
    rtsCam?.setShake?.(Math.max(rtsCam.getShake?.() ?? 0, amp));
  }

  public dispose(): void {
    if (this.weatherEditTimer !== null) { clearTimeout(this.weatherEditTimer); this.weatherEditTimer = null; }
    if (this.windEditTimer !== null) { clearTimeout(this.windEditTimer); this.windEditTimer = null; }
    this.offRenderEvents?.(); this.offServerEvents?.();
    this.offWeatherAction(); this.offWeatherUserEdit(); this.offWindUserEdit();
    this.hqRespawnModal.dispose(); this.screenOverlay.dispose();
    this.meteorFx?.dispose(); this.twisterFx?.dispose(); this.lightningFx?.dispose();
  }
}

export const weatherRendererDef: RendererDef = { id: 'weather', mount: (ctx) => new WeatherHazardRenderer(ctx) };
