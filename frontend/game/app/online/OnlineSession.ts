import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { createHexTerrain, specForPlanetType, tileXZ, type HexPick, type HexTerrain, type HexTiles } from '@terra/render/planets/hex';
import { TICK_MS } from '@terra/sim';
import { CommandBus } from '../../net/commandBus';
import { ConnectionBanner } from '../../net/ConnectionBanner';
import { httpDevServer } from '../../net/devServer';
import { withDevLag } from '../../net/LagTransport';
import { createLocalWorker, LocalTransport, workerLink } from '../../net/LocalTransport';
import { NetStatsBoard } from '../../net/netStats';
import type { SessionTarget, Transport } from '../../net/types';
import { warpOfMessage } from '../../net/warpFeed';
import { WsTransport, browserDeps, type WsTransportDeps } from '../../net/WsTransport';
import { LocalHost, WorldStore } from '../../store/WorldStore';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import { createClientFlagsStore, resolveClientFlags, type ClientFlagsStore } from '../../core/flags';
import type { Scene3dService } from '../../features/entities/services';
import { LandfallController } from '../../features/landfall';
import { RTSCamera } from '../RTSCamera';
import { BootOverlay, type BootPhase } from './BootOverlay';
import {
  bootAuthAndHome,
  createLocalBootFallback,
  extractPodDescentStatus,
  type BootAuthResult,
  type FetchLike,
  type StorageLike,
} from './bootOnline';
import { EntityMeshes, type MeshFactory } from './EntityMeshes';
import { FeatureHud } from './featureHud';
import { hexSurface } from './hexSurface';
import { localHostOptions } from './localHost';
import type { OnlineMode } from './onlineMode';
import { createSessionTarget, joinParam, scenarioParam } from './sessionTarget';
import '../../../design/css/tokens.css';
import '../../../design/css/base.css';

export interface OnlineSessionOptions {
  viewport?: ColonyViewport;
  transport?: Transport;
  store?: WorldStore;
  localHost?: LocalHost;
  fetch?: FetchLike;
  storage?: StorageLike;
  search?: string;
  uiParent?: HTMLElement;
  makeMesh?: MeshFactory;
  wsDeps?: WsTransportDeps;
}

/** Tile indices whose height, terrain, prep or deposit differs between two tile snapshots. */
function changedTiles(a: ClientTiles, b: ClientTiles): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (a.height[i] !== b.height[i] || a.terrain[i] !== b.terrain[i] || a.prep[i] !== b.prep[i] || a.deposit?.[i] !== b.deposit?.[i]) {
      out.push(i);
    }
  }
  return out;
}

function createSafeViewport(root: HTMLElement, provided?: ColonyViewport): ColonyViewport {
  if (provided) return provided;
  if (typeof WebGLRenderingContext !== 'undefined') {
    try { return createColonyViewport(root); } catch { /* Headless fallback */ }
  }
  const domElement = document.createElement('canvas');
  root.appendChild(domElement);
  const noop = () => {};
  return {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 1000),
    renderer: { domElement, setPixelRatio: noop } as unknown as THREE.WebGLRenderer,
    composer: {} as unknown as ColonyViewport['composer'],
    bloom: { enabled: true, strength: 0.45 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), environment: new THREE.Texture(),
    setView: noop, applySky: noop, followShadow: noop, setResolution: noop, resize: noop, render: noop,
    dispose() { domElement.remove(); },
  };
}

/**
 * The online play flow (`/play.html` default in W01, or `?scenario=` / `?join=` / `?host=`):
 * - In `'boot'` mode without `?scenario=` / `?join=` (W01-38): shows the Faction Plate orbital splash ("Contacting orbit…")
 *   while guest auth + `/v1/me/home` run, joins `pl_dev` with the returned `accessToken`, conditionally plays the drop-pod
 *   descent overlay while the colony's pod is descending, centers the camera on `(spawn.q, spawn.r)` and transitions to the
 *   interactive colony view once the HQ lands (or immediately if the HQ has already landed).
 * - With `?scenario=` / `?join=` / `?host=local`: connects via `LocalTransport` (browser worker + IndexedDB snapshots) or
 *   `createSessionTarget` (`POST /v1/dev/scenarios/<id>`).
 */
export class OnlineSession {
  readonly viewport: ColonyViewport;
  readonly transport: Transport;
  readonly store: WorldStore;
  readonly commandBus: CommandBus;
  readonly commands: CommandBus;
  readonly entities: EntityMeshes;
  readonly landfall: LandfallController;
  readonly flags: ClientFlagsStore;
  readonly netStats = new NetStatsBoard();
  readonly bootOverlay: BootOverlay | null;
  readonly whenBooted: Promise<BootAuthResult | null>;

  terrain: HexTerrain | null = null;
  cam: RTSCamera | null = null;
  lastPick: HexPick | null = null;
  planetId = '';
  colonyId: string | null = null;
  colonyIndex = 0;
  spawn: { q: number; r: number } = { q: 0, r: 0 };
  cameraTargetTile: { q: number; r: number } = { q: 0, r: 0 };
  accessToken = '';
  bootResult: BootAuthResult | null = null;

  private biomeKey = 'forestRock';
  private lastHudMs = 0;
  private readonly search: string;
  private readonly skipDescent: boolean;
  private readonly banner: ConnectionBanner | null;
  private readonly hud: FeatureHud;
  private readonly bootTarget: SessionTarget;
  private localHost: LocalHost | null = null;
  private localTimer: ReturnType<typeof setInterval> | null = null;
  private cameraCentered = false;
  private tiles: ClientTiles | null = null;
  private warp = 1;
  private raf = 0;
  private last = typeof performance !== 'undefined' ? performance.now() : Date.now();
  private cleanups: Array<() => void> = [];

  constructor(root: HTMLElement, readonly mode: OnlineMode = 'boot', opts: OnlineSessionOptions = {}) {
    this.search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    this.skipDescent = new URLSearchParams(this.search).get('skip') === '1';
    this.flags = createClientFlagsStore(this.search);
    const uiParent = opts.uiParent ?? (typeof document !== 'undefined' ? document.body : root);

    this.viewport = createSafeViewport(root, opts.viewport);
    const loc =
      typeof location !== 'undefined'
        ? { protocol: location.protocol, host: location.host, search: this.search }
        : { protocol: 'http:', host: '127.0.0.1:5173', search: this.search };

    const useGuestBoot = mode === 'boot' && this.flags.set.has('W01') && !scenarioParam(this.search) && !joinParam(this.search);
    this.bootTarget = useGuestBoot
      ? { url: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`, accessToken: '', resolve: () => this.resolveBootTarget(opts) }
      : createSessionTarget(loc);

    const localOpts = !useGuestBoot && !opts.transport && !opts.localHost ? localHostOptions(this.search) : null;
    const local = localOpts ? new LocalTransport(workerLink(createLocalWorker()), localOpts) : null;
    this.transport = withDevLag(opts.transport ?? local ?? new WsTransport(this.bootTarget, opts.wsDeps ?? browserDeps()), this.search);
    this.banner =
      typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.createTextNode === 'function'
        ? new ConnectionBanner(uiParent, this.transport, () => this.transport.start())
        : null;
    this.store = opts.store ?? new WorldStore(this.transport);
    this.commandBus = new CommandBus(this.transport, undefined, (id, kind, args) => this.store.notifySent(id, kind, args));
    this.commands = this.commandBus;
    this.entities = new EntityMeshes(this.viewport.scene, opts.makeMesh);
    this.landfall = new LandfallController({
      store: this.store, sendCommand: this.commandBus.send,
      pickTile: (cx, cy) => this.pickAt(cx, cy), canvas: this.viewport.renderer.domElement,
      onTargetMove: (q, r) => this.entities.flashTarget(q, r, this.terrain),
    });
    this.cleanups.push(this.landfall.onChange(({ selectedEntityId }) => this.entities.setSelectedEntityId(selectedEntityId)));
    this.hud = this.createHud(uiParent, local);
    if (local) this.keepLocalSaved(local);
    this.bindTransportListeners();

    const predict = new URLSearchParams(this.search).get('predict') !== '0';
    if (useGuestBoot) {
      this.bootOverlay = new BootOverlay(uiParent);
      this.bindBootSkipKey();
      this.whenBooted = this.startBootSequence(opts, predict);
    } else {
      this.bootOverlay = this.flags.set.has('W01') && mode === 'boot' ? new BootOverlay(uiParent) : null;
      if (this.bootOverlay) this.bindBootSkipKey();
      this.whenBooted = Promise.resolve(null);
      this.cleanups.push(this.store.onView((v) => this.onView(v)));
      this.store.start([...this.flags.set], { predict });
      if (opts.localHost) this.attachLocalHost(opts.localHost, false);
      else this.transport.start();
    }
    this.loop();
  }

  private createHud(uiParent: HTMLElement, local: LocalTransport | null): FeatureHud {
    const scene3d: Scene3dService = {
      scene: this.viewport.scene,
      tileToWorld: (x, y) => { const [wx, wz] = tileXZ(x, y); return { x: wx, y: this.terrain?.heightAt(wx, wz) ?? 0, z: wz }; },
      biomeKey: () => this.biomeKey,
    };
    return new FeatureHud(uiParent, this.flags, local ? 'local' : 'server', {
      sendCommand: this.commandBus.send, devServer: local ? local.devServer : httpDevServer(),
      session: { planetId: () => this.store.currentPlanetId() || this.planetId || null },
      scene3d, netStats: this.netStats, transport: this.transport, store: this.store,
      landfall: this.landfall, pickTile: (cx, cy) => this.pickAt(cx, cy), canvas: this.viewport.renderer.domElement,
    });
  }

  private bindTransportListeners(): void {
    this.cleanups.push(this.store.onCommandRejected(() => this.netStats.recordRollback()));
    this.cleanups.push(
      this.transport.onMessage((m) => {
        const k = warpOfMessage(m);
        if (k !== undefined) this.setWarp(k);
        if (m.t === 'welcome') {
          this.planetId = m.d.planet.id;
          this.flags.update(resolveClientFlags({ welcomeFlags: m.d.flags, search: this.search, dev: import.meta.env.DEV }));
        }
      }),
    );
  }

  get bootPhase(): BootPhase {
    return this.bootOverlay?.phase ?? 'colony';
  }

  selectHq(): number | null {
    return this.landfall.selectHq();
  }

  orderMove(q: number, r: number): boolean {
    return this.landfall.orderMove(q, r);
  }

  getSelectedEntityId(): number | null {
    return this.landfall.getSelectedEntityId();
  }

  /** Centers the RTS camera on axial tile `(q, r)`. */
  focusTile(q: number, r: number, instant = true): void {
    this.cameraTargetTile = { q, r };
    const [wx, wz] = tileXZ(q, r);
    const wy = this.terrain ? this.terrain.heightAt(wx, wz) : 0;
    this.cam?.focus(new THREE.Vector3(wx, wy, wz), instant);
  }

  private async startBootSequence(opts: OnlineSessionOptions, predict = true): Promise<BootAuthResult> {
    this.store.start([...this.flags.set], { predict });
    const boot = await bootAuthAndHome({
      fetch: opts.fetch,
      storage: opts.storage,
      search: this.search,
      onStatus: (s) => this.bootOverlay?.setSplashStatus(s),
    });
    this.applyBootResult(boot);
    this.cleanups.push(this.store.onView((v) => this.onView(v)));

    if (opts.localHost) {
      this.attachLocalHost(opts.localHost, false);
    } else if (boot.mode === 'local' && boot.localHost) {
      this.attachLocalHost(boot.localHost, typeof window !== 'undefined');
    } else {
      this.cleanups.push(
        this.transport.onState((s) => {
          if (s.phase === 'terminal' && !this.store.latest && !this.localHost) {
            const fb = createLocalBootFallback(boot.deviceSecret, undefined, this.spawn);
            if (fb.localHost) this.attachLocalHost(fb.localHost, typeof window !== 'undefined');
          }
        }),
      );
      this.transport.start();
      if (this.store.latest) this.onView(this.store.latest);
    }
    return boot;
  }

  private async resolveBootTarget(opts: OnlineSessionOptions): Promise<{ planetId: string }> {
    if (this.bootResult && this.planetId) {
      return { planetId: this.planetId };
    }
    const boot = await bootAuthAndHome({
      fetch: opts.fetch,
      storage: opts.storage,
      search: this.search,
      tryRefresh: true,
      onStatus: (s) => this.bootOverlay?.setSplashStatus(s),
    });
    this.applyBootResult(boot);
    return { planetId: boot.planet.id };
  }

  private applyBootResult(boot: BootAuthResult): void {
    this.bootResult = boot;
    this.accessToken = boot.accessToken;
    this.bootTarget.accessToken = boot.accessToken;
    this.planetId = boot.planet.id;
    this.colonyId = boot.colony.id;
    this.colonyIndex = boot.colony.colonyIndex;
    this.spawn = boot.colony.spawn;
    this.cameraTargetTile = { q: boot.colony.spawn.q, r: boot.colony.spawn.r };
    this.landfall.setOwnerColonyIndex(this.colonyIndex);
    this.bootOverlay?.setColonyMeta(this.planetId, this.colonyId, this.colonyIndex);
    this.bootOverlay?.setSplashStatus('Deploying drop pod…');
  }

  private attachLocalHost(lh: LocalHost, autoStep: boolean): void {
    this.localHost = lh;
    lh.bindStore(this.store);
    if (autoStep && !this.localTimer) {
      this.localTimer = setInterval(() => this.localHost?.step(1), TICK_MS);
    }
  }

  /** The local planet is written to IndexedDB every 10 s by the host; also when the page hides or unloads. */
  private keepLocalSaved(local: LocalTransport): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const save = () => local.saveNow();
    const onVis = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVis);
    });
  }

  private bindBootSkipKey(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === ' ') && this.bootOverlay?.phase === 'descent') {
        e.preventDefault();
        this.bootOverlay.showColony(this.planetId || 'pl_dev');
      }
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  private onView(v: ClientView): void {
    if (v.tiles) this.onTiles(v, v.tiles);
    const biomeKey = specForPlanetType(v.planet.type).biomeKey;
    this.biomeKey = biomeKey;
    this.entities.syncView(v, this.terrain, biomeKey);
    this.landfall.onView(v);
    this.hud.update({ ...v, tick: v.tick, warp: this.warp, net: this.netStats.view(this.store.predictionInfo) });

    if (this.bootOverlay) {
      const status = extractPodDescentStatus(v, this.colonyIndex, this.spawn);
      if (!this.cameraCentered || status.descending) {
        this.focusTile(status.q, status.r, true);
        this.cameraCentered = true;
      }
      if (status.descending && !this.skipDescent) {
        this.bootOverlay.showDescent({ progress: status.progress, q: status.q, r: status.r });
      } else {
        this.bootOverlay.showColony(v.planet.id || this.planetId || 'pl_dev');
        this.focusTile(status.q, status.r, true);
        this.landfall.selectHq();
      }
    } else if (!this.cameraCentered && this.flags.set.has('W01')) {
      const status = extractPodDescentStatus(v, this.colonyIndex, this.spawn);
      if (status.q !== 0 || status.r !== 0 || status.hqLanded || status.descending) {
        this.focusTile(status.q, status.r, true);
        this.cameraCentered = true;
      }
    }
  }

  private setWarp(k: number): void {
    this.warp = k;
    const latest = this.store.latest;
    this.hud.update({ ...(latest ?? {}), tick: latest?.tick, warp: k, net: this.netStats.view(this.store.predictionInfo) });
  }

  private onTiles(v: ClientView, tiles: ClientTiles): void {
    if (!this.terrain || this.terrain.radius !== v.planet.radius) {
      this.terrain?.dispose();
      const look = specForPlanetType(v.planet.type);
      this.biomeKey = look.biomeKey;
      try {
        applyPlanetLook(this.viewport, look);
      } catch {
        // Ignore in headless tests
      }
      const terrain = createHexTerrain({ radius: v.planet.radius, tiles: tiles as HexTiles, look });
      this.terrain = terrain;
      this.viewport.scene.add(terrain.group);
      this.cam?.dispose();
      const surface = hexSurface(terrain, look);
      const [tx, tz] = tileXZ(this.cameraTargetTile.q, this.cameraTargetTile.r);
      const ty = terrain.heightAt(tx, tz);
      const target = new THREE.Vector3(tx, ty, tz);
      this.cam = new RTSCamera(
        this.viewport.camera,
        this.viewport.renderer.domElement,
        surface,
        new THREE.Vector3(tx + 42, ty + 46, tz + 42),
        target,
      );
    } else if (this.tiles) {
      const changed = changedTiles(this.tiles, tiles);
      if (changed.length) this.terrain.updateTiles(tiles as HexTiles, changed);
    }
    this.tiles = tiles;
  }

  /** Tile under a client-space point, or null (also logged; the state inspector arrives later). */
  pickAt(clientX: number, clientY: number): HexPick | null {
    if (!this.terrain) return null;
    const r = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.lastPick = this.terrain.pick(ndc, this.viewport.camera);
    console.log('[pick]', this.lastPick ? `q=${this.lastPick.q} r=${this.lastPick.r} i=${this.lastPick.i}` : 'off-planet');
    return this.lastPick;
  }

  /** Client-space pixel of a tile centre (debug/E2E: `clickTile`), or null before the terrain exists. */
  tileToScreen(q: number, r: number): { x: number; y: number } | null {
    if (!this.terrain) return null;
    const [x, z] = tileXZ(q, r);
    const p = new THREE.Vector3(x, this.terrain.heightAt(x, z), z).project(this.viewport.camera);
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Debug/E2E: the entity meshes as drawn right now (world metres). */
  entityMeshes(): Array<{ id: number; x: number; y: number; z: number }> {
    const g = this.viewport.scene.getObjectByName('entities');
    return (g?.children ?? []).map((m) => ({ id: Number(m.userData.entityId), x: m.position.x, y: m.position.y, z: m.position.z }));
  }

  private loop = () => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    try {
      this.entities.update(dt, this.terrain);
      if (this.cam) {
        this.cam.update(dt);
        this.viewport.followShadow(this.cam.target);
      }
      this.terrain?.tick(dt);
      this.frameHud(now, dt);
      this.viewport.render();
    } catch (e) {
      console.error('frame error', e);
    }
    if (typeof requestAnimationFrame === 'function') {
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  /** Ticks the 3D renderers with the newest view; refreshes the dev overlay numbers a few times a second. */
  private frameHud(now: number, dt: number): void {
    const v = this.store.latest;
    if (!v) return;
    this.hud.frame({ ...v, sim: { view: v, serverTick: this.store.serverTickF(), predicting: this.store.predictionMode === 'on' } }, dt);
    if (now - this.lastHudMs > 250) {
      this.lastHudMs = now;
      this.hud.update({ ...v, tick: v.tick, warp: this.warp, net: this.netStats.view(this.store.predictionInfo) });
    }
  }

  dispose(): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    if (this.localTimer) {
      clearInterval(this.localTimer);
      this.localTimer = null;
    }
    this.cleanups.forEach((f) => f());
    this.bootOverlay?.dispose();
    this.landfall.dispose();
    this.entities.dispose();
    this.commandBus.dispose();
    this.cam?.dispose();
    this.store.dispose();
    this.transport.stop();
    this.hud.dispose();
    this.banner?.dispose();
    this.terrain?.dispose();
    this.viewport.dispose();
  }
}
