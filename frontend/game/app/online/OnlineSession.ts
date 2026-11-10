import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexPick, type HexTerrain } from '@terra/render/planets/hex';
import type { ServerMessage } from '@terra/contracts';
import type { CommandBus } from '../../net/commandBus';
import { NOT_YOUR_PLANET } from '../../net/closeCodes';
import type { ConnectionBanner } from '../../net/ConnectionBanner';
import { bindVersionMismatchNotice } from '../../net/VersionMismatchNotice';
import { NetStatsBoard } from '../../net/netStats';
import type { ConnectionState, SessionTarget, Transport } from '../../net/types';
import { warpOfMessage } from '../../net/warpFeed';
import type { WsTransportDeps } from '../../net/WsTransport';
import { LocalHost } from '../../store/local/LocalHost';
import type { WorldStore } from '../../store/WorldStore';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import { createClientFlagsStore, resolveClientFlags, type ClientFlagsStore } from '../../core/flags';
import type { LandfallController } from '../../features/landfall';
import { isTypingTarget } from '../../features/shared/hotkeys';
import type { RTSCamera } from '../RTSCamera';
import type { BootOverlay, BootPhase } from './BootOverlay';
import { createLocalBootFallback, devPlanetTypeOfKind, type BootAuthResult, type FetchLike, type StorageLike } from './bootOnline';
import type { EntityMeshes, MeshFactory } from './EntityMeshes';
import type { FeatureHud } from './featureHud';
import type { GuestBootTarget } from './guestBoot';
import type { OnlineMode } from './onlineMode';
import { createSessionBootRig } from './parts/sessionBoot';
import { applySessionSpacePhase, syncSessionBootOverlayOnView, syncSessionFrameHud } from './parts/sessionViewSync';
import { PauseOverlay } from './PauseOverlay';
import { createUnitControl } from './unitControl';
import type { PodLandingStateName } from './PodTouchdownFx';
import { extractPodDescentStatus } from './podStatus';
import type { PilotBridge } from './pilotBridge';
import { createSessionHud } from './sessionHud';
import { scenarioParam } from './sessionTarget';
import { normalizeSectorIntent, type SectorIntentInput, type SectorIntentV1 } from '../../ui/lobby/orbitalPickerModel';
import { bindStoreCombatEvents, ingestHostMessageCombatEvents } from './combatSync';
import { bindOnlineDayNightSync, type OnlineDayNightSync } from './dayNightSync';
import {
  applyChangedTileList, bindLocalSaveListeners, createSafeViewport, isEscapeBlockedByHudOverlay,
  listSceneEntities, pickTerrainAt, projectTileToScreen, resolveOnlinePlanetLook, resolveSessionPlanetKind,
  syncOrRebuildSessionTerrain, type TileChangePatchItem, writeStoredPlanetKind,
} from './viewportHelper';
import '../../../design/css/tokens.css';
import '../../../design/css/base.css';

export interface OnlineSessionOptions {
  viewport?: ColonyViewport; transport?: Transport; store?: WorldStore; localHost?: LocalHost;
  fetch?: FetchLike; storage?: StorageLike; search?: string; uiParent?: HTMLElement;
  makeMesh?: MeshFactory; wsDeps?: WsTransportDeps; planetKind?: PlanetKind;
  planetId?: string; sectorIntent?: SectorIntentInput;
  pollQueuedHome?: boolean; enqueueOnNew?: boolean; pollIntervalMs?: number;
  wait?: (ms: number) => Promise<void>; onQueueCancelled?: (ticketId: string | null) => void;
  skipDescent?: boolean; fromSpaceDescent?: boolean; onReturnToOrbit?: (kind: PlanetKind) => void;
  /** May an unreachable game server fall back to a browser-local host (FA-06)? Default: dev builds only. */
  allowLocalFallback?: boolean;
}

/** Online play flow (`/play.html` short landing or `/play.html?planet=<kind>` full space-to-surface landing). */
export class OnlineSession {
  readonly viewport: ColonyViewport; readonly transport: Transport; readonly store: WorldStore;
  readonly commandBus: CommandBus; readonly commands: CommandBus; readonly entities: EntityMeshes;
  readonly landfall: LandfallController; readonly flags: ClientFlagsStore; readonly netStats = new NetStatsBoard();
  readonly bootOverlay: BootOverlay | null; readonly pauseOverlay: PauseOverlay;
  readonly whenBooted: Promise<BootAuthResult | null>;

  terrain: HexTerrain | null = null; cam: RTSCamera | null = null; lastPick: HexPick | null = null;
  private colonyFramed = false;
  planetId = ''; colonyId: string | null = null; colonyIndex = 0; foundingSectorId: string | null = null;
  spawn = { q: 0, r: 0 }; cameraTargetTile = { q: 0, r: 0 };
  bootResult: BootAuthResult | null = null; planetKind: PlanetKind | null;
  readonly sectorIntent: SectorIntentV1;

  private biomeKey = 'forestRock'; private lastHudMs = 0;
  private readonly ownsViewport: boolean; private readonly search: string;
  private readonly skipDescent: boolean; private readonly fromSpaceDescent: boolean; private readonly fastStartLand: boolean;
  private readonly onReturnToOrbit?: (kind: PlanetKind) => void; private readonly allowLocalFallback: boolean;
  private banner: ConnectionBanner | null; private readonly hud: FeatureHud;
  private readonly pilot: PilotBridge;
  private readonly bootTarget: SessionTarget; private readonly guest: GuestBootTarget | null;
  private disposed = false; private localHost: LocalHost | null = null;
  private showSpaceTerrain = false; private cameraCentered = false; private landSent = false; private hqDeployedSynced = false;
  private tiles: ClientTiles | null = null; private warp = 1; private raf = 0;
  private dayNightSync: OnlineDayNightSync | null = null;
  private last = typeof performance !== 'undefined' ? performance.now() : Date.now();
  private cleanups: Array<() => void> = [];

  constructor(root: HTMLElement, readonly mode: OnlineMode = 'boot', opts: OnlineSessionOptions = {}) {
    this.ownsViewport = !opts.viewport;
    this.search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    const q = new URLSearchParams(this.search);
    this.skipDescent = Boolean(opts.skipDescent || q.get('skip') === '1');
    this.fromSpaceDescent = Boolean(opts.fromSpaceDescent);
    this.fastStartLand = Boolean(this.skipDescent || (!opts.wsDeps && !opts.localHost && !scenarioParam(this.search)));
    this.onReturnToOrbit = opts.onReturnToOrbit;
    this.allowLocalFallback = opts.allowLocalFallback ?? import.meta.env.DEV;
    this.planetKind = resolveSessionPlanetKind(q, opts.planetKind);
    this.sectorIntent = normalizeSectorIntent(opts.sectorIntent ?? q.get('sector'));

    this.flags = createClientFlagsStore(this.search);
    const uiParent = opts.uiParent ?? (typeof document !== 'undefined' ? document.body : root);
    this.viewport = createSafeViewport(root, opts.viewport);

    const rig = createSessionBootRig({
      mode, search: this.search, flags: this.flags, planetKind: this.planetKind,
      allowLocalFallback: this.allowLocalFallback, skipDescent: this.skipDescent, fromSpaceDescent: this.fromSpaceDescent,
      uiParent, scene: this.viewport.scene, opts, getBootOverlay: () => this.bootOverlay,
      onBooted: (b) => this.applyBootResult(b), onQueueCancelled: () => this.returnToOrbit(),
    });
    this.guest = rig.guest;
    this.bootTarget = rig.bootTarget;
    this.pilot = rig.pilot;
    this.transport = rig.transport;
    this.banner = rig.banner;
    this.store = rig.store;
    this.cleanups.push(bindVersionMismatchNotice(uiParent, this.store, () => this.store.currentPlanetId() || this.planetId || null));
    this.commandBus = rig.commandBus;
    this.commands = this.commandBus;
    this.entities = rig.entities;
    this.bootOverlay = rig.bootOverlay;

    const control = createUnitControl({
      store: this.store, commandBus: this.commandBus, canvas: this.viewport.renderer.domElement, entities: this.entities,
      pickAt: (cx, cy) => this.pickAt(cx, cy), terrain: () => this.terrain, toast: (m) => this.hud?.toast(m), netStats: this.netStats,
    });
    this.landfall = control.landfall;
    this.cleanups.push(control.dispose);
    this.hud = createSessionHud({
      uiParent, flags: this.flags, local: rig.local, scene: this.viewport.scene, canvas: this.viewport.renderer.domElement,
      store: this.store, commandBus: this.commandBus, netStats: this.netStats, transport: this.transport, landfall: this.landfall,
      terrain: () => this.terrain, biomeKey: () => this.biomeKey, localHost: () => this.localHost, colonyIndex: () => this.colonyIndex,
      homeColonyId: () => this.colonyId,
      planetId: () => this.store.currentPlanetId() || this.planetId || null, pickAt: (cx, cy) => this.pickAt(cx, cy),
      camera: () => this.viewport.camera, rtsCamera: () => this.cam, focusTile: (q, r, s) => this.focusTile(q, r, s),
      pilot: this.pilot, token: () => this.bootTarget.accessToken,
      renderedEntityPosition: (id) => this.entities.getRecord(id)?.mesh.position ?? null,
    });
    this.pauseOverlay = new PauseOverlay(uiParent, { onResume: () => this.setPaused(false), onReturnToOrbit: () => this.returnToOrbit() });
    if (rig.local) this.cleanups.push(bindLocalSaveListeners(rig.local));
    this.bindTransportListeners();
    this.bindKeys();

    const predict = q.get('predict') !== '0';
    this.hud.setVisible(!this.bootOverlay || this.bootOverlay.phase === 'colony');

    if (this.guest) {
      this.whenBooted = this.startBootSequence(this.guest, opts, predict);
    } else {
      this.whenBooted = Promise.resolve(null);
      this.cleanups.push(this.store.onView((v) => this.onView(v)));
      this.store.start([...this.flags.set], { predict });
      if (opts.localHost) this.attachLocalHost(opts.localHost, false, false);
      else this.transport.start();
    }
    this.loop();
  }

  private bindTransportListeners(): void {
    this.cleanups.push(this.transport.onMessage((m) => this.onHostMessage(m)), bindStoreCombatEvents(this.store, this.entities.combatSync, () => this.terrain));
    this.dayNightSync = bindOnlineDayNightSync({
      store: this.store, commandBus: this.commandBus, warp: () => this.warp,
      hasColony: () => Boolean(this.colonyId && this.store.latest?.colonies[this.colonyIndex]?.status !== 'eliminated'),
    });
    this.cleanups.push(() => this.dayNightSync?.dispose());
  }

  /** Warp and welcome bookkeeping, for the transport and for an attached in-process host alike. */
  private onHostMessage(m: ServerMessage): void {
    const k = warpOfMessage(m);
    if (k !== undefined) this.setWarp(k);
    ingestHostMessageCombatEvents(m, this.entities.combatSync, this.terrain);
    if (m.t === 'welcome') {
      this.planetId = m.d.planet.id;
      if (m.d.colonyId && !this.colonyId) this.colonyId = m.d.colonyId;
      this.flags.update(resolveClientFlags({ welcomeFlags: m.d.flags, search: this.search, dev: import.meta.env.DEV }));
      this.hud.activeServices?.awayDigest?.showWelcome(m.d);
    }
  }

  get bootPhase(): BootPhase { return this.bootOverlay?.phase ?? 'colony'; }
  get minimap() { return this.hud.activeServices?.maps?.stats ?? null; }
  setPaused(p: boolean): void { this.pauseOverlay.setPaused(p); if (this.cam) this.cam.enabled = !p; }

  returnToOrbit(): void {
    const kind: PlanetKind = this.planetKind ?? 'forestRock';
    writeStoredPlanetKind(kind);
    if (this.onReturnToOrbit) { this.onReturnToOrbit(kind); return; }
    if (typeof location !== 'undefined') location.href = `/play.html?planet=${kind}`;
  }

  cancelQueuedTicket(ticketId?: string): Promise<boolean> {
    return this.guest ? this.guest.cancelQueue(ticketId) : Promise.resolve(false);
  }

  /** Updates the active space/atmospheric state (`orbit .. approach`) or hands off to surface (`null`). */
  setSpacePhase(phase: PodLandingStateName | null, showTerrain = false): boolean {
    this.showSpaceTerrain = showTerrain;
    return applySessionSpacePhase({
      phase, showTerrain, entities: this.entities, banner: this.banner, terrain: this.terrain,
      cameraTargetTile: this.cameraTargetTile, store: this.store, planetKind: this.planetKind, viewport: this.viewport,
      focusTile: (q, r, instant) => this.focusTile(q, r, instant), onView: (v) => this.onView(v),
    });
  }

  skipLanding(): void {
    this.setSpacePhase(null);
    this.entities.podTouchdown.setEnabled(false);
    this.sendLandOnce();
    this.bootOverlay?.showColony(this.planetId || 'pl_dev');
    this.hud.setVisible(true);
    if (this.store.latest) { this.onView(this.store.latest); this.entities.update(0, this.terrain); }
  }

  /** Fast start (FA-08), once per session: `landPod` opens the own pod once it has descended `podLandMinS`. */
  private sendLandOnce(): void {
    if (this.landSent) return;
    this.landSent = true;
    void this.commandBus.send('landPod', {}, { predict: false });
  }

  selectHq(): number | null { return this.landfall.selectHq(); }
  clickTile(q: number, r: number): boolean { return this.landfall.clickTile(q, r); }
  orderMove(q: number, r: number): boolean { return this.landfall.orderMove(q, r); }
  getSelectedEntityId(): number | null { return this.landfall.getSelectedEntityId(); }
  applyTilePatch(patch: { changedTiles?: readonly TileChangePatchItem[] }): void {
    if (this.terrain && patch.changedTiles) applyChangedTileList(this.terrain, patch.changedTiles);
  }

  /** Centers the RTS camera on axial tile `(q, r)`. */
  focusTile(q: number, r: number, instant = true): void {
    this.cameraTargetTile = { q, r };
    const [wx, wz] = tileXZ(q, r);
    const wy = this.terrain ? this.terrain.heightAt(wx, wz) : 0;
    this.cam?.focus(new THREE.Vector3(wx, wy, wz), instant);
    if (this.cam) this.viewport.followShadow(this.cam.target);
  }

  private async startBootSequence(guest: GuestBootTarget, opts: OnlineSessionOptions, predict: boolean): Promise<BootAuthResult | null> {
    this.store.start([...this.flags.set], { predict });
    const boot = await guest.boot(); // applied through `onBooted`; null: disposed on the error splash
    if (!boot || this.disposed) return boot; // FA-02: Return to orbit / HMR while the HTTP boot ran
    this.cleanups.push(this.store.onView((v) => this.onView(v)));
    if (opts.localHost) this.attachLocalHost(opts.localHost, false, false);
    else if (boot.mode === 'local' && boot.localHost) this.attachLocalHost(boot.localHost, typeof window !== 'undefined', true);
    else {
      this.cleanups.push(this.transport.onState((s) => this.onSocketState(s, boot)));
      this.transport.start();
      if (this.store.latest) this.onView(this.store.latest);
    }
    return boot;
  }

  /** Dev builds: the socket gave up before the first view → a browser-local planet as colony 0 (FA-05); not on `not_your_planet`. */
  private onSocketState(s: ConnectionState, boot: BootAuthResult): void {
    if (s.phase !== 'terminal' || this.disposed || this.store.latest || this.localHost || !this.allowLocalFallback) return;
    if (s.reason === NOT_YOUR_PLANET) return;
    const fb = createLocalBootFallback(boot.deviceSecret, undefined, this.spawn, devPlanetTypeOfKind(this.planetKind));
    this.applyBootResult(fb);
    if (fb.localHost) this.attachLocalHost(fb.localHost, typeof window !== 'undefined', true);
  }

  private applyBootResult(boot: BootAuthResult): void {
    if (this.disposed) return;
    this.bootResult = boot;
    this.pilot.note(boot);
    this.planetId = boot.planet.id;
    this.colonyId = boot.colony.id;
    this.colonyIndex = boot.colony.colonyIndex;
    this.foundingSectorId = boot.colony.foundingSectorId ?? boot.foundingSectorId ?? null;
    this.spawn = boot.colony.spawn;
    this.cameraTargetTile = { q: boot.colony.spawn.q, r: boot.colony.spawn.r };
    this.entities.setOwnerColonyIndex(this.colonyIndex);
    this.landfall.setOwnerColonyIndex(this.colonyIndex);
    this.bootOverlay?.hideQueueStatus();
    this.bootOverlay?.setColonyMeta(this.planetId, this.colonyId, this.colonyIndex);
    if (!this.skipDescent) {
      if (boot.wasQueued) {
        this.bootOverlay?.showDescent({ progress: 0, q: this.spawn.q, r: this.spawn.r, landed: false });
      } else {
        this.bootOverlay?.setSplashStatus('Deploying drop pod…');
      }
    }
  }

  /**
   * An in-process host takes the commands and feeds the store (FA-07: the `LocalHostCore` of `?host=local`, its colony
   * is 0). `autoStep`: it steps on its own scheduler (5 TPS, dev warp). `offline`: a fallback for a missing server:
   * badge on, connection banner (and its Retry) gone (FA-06).
   */
  private attachLocalHost(lh: LocalHost, autoStep: boolean, offline: boolean): void {
    this.localHost = lh;
    // Route commands to the local host before bindStore: its first view may send `landPod` synchronously.
    this.cleanups.push(lh.onMessage((m) => { this.commandBus.handleMessage(m); this.onHostMessage(m); }));
    const origSend = this.transport.send.bind(this.transport);
    this.transport.send = (m) => (this.localHost ? this.localHost.send(m) : origSend(m));
    lh.bindStore(this.store);
    if (autoStep) lh.start();
    if (!offline) return;
    this.bootOverlay?.setOffline(true);
    this.banner?.dispose();
    this.banner = null;
  }

  private bindKeys(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onKey = (e: KeyboardEvent) => {
      if (this.entities.podTouchdown.isSpacePhaseActive() || isTypingTarget(e)) return;
      if ((e.key === 'Escape' || e.key === ' ') && this.landingSkippable()) {
        e.preventDefault();
        this.skipLanding();
        return;
      }
      if (e.key === 'Escape' && !isEscapeBlockedByHudOverlay()) this.setPaused(!this.pauseOverlay.paused);
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  /** FA-11: only while the own pod is descending (or the descent overlay still shows its touchdown). */
  private landingSkippable(): boolean {
    if (this.bootOverlay?.phase === 'descent') return true;
    return extractPodDescentStatus(this.store.latest, this.colonyIndex, this.spawn).descending;
  }

  private onView(v: ClientView): void {
    if (!this.guest && this.colonyIndex === 0) {
      const asParam = new URLSearchParams(this.search).get('as')?.trim().toLowerCase() ?? '';
      const asIdx = /^[a-e]$/.test(asParam) ? asParam.charCodeAt(0) - 97 : 0;
      if (asIdx > 0 && Array.isArray(v.colonies) && v.colonies.some((c) => c && c.index === asIdx)) {
        this.colonyIndex = asIdx;
        this.entities.setOwnerColonyIndex(asIdx);
        this.landfall.setOwnerColonyIndex(asIdx);
      }
    }
    if (v.tiles) this.onTiles(v, v.tiles);
    if (!this.entities.podTouchdown.isSpacePhaseActive()) this.dayNightSync?.syncFrame();
    const look = resolveOnlinePlanetLook(v.planet.type, this.planetKind);
    this.biomeKey = look.biomeKey;
    const status = extractPodDescentStatus(v, this.colonyIndex, this.spawn);
    if (!this.cameraCentered && !this.landSent && !this.fromSpaceDescent && !status.descending && status.hqLanded) {
      this.entities.podTouchdown.setEnabled(false);
    }
    this.entities.syncView(v, this.terrain, this.biomeKey, this.store.confirmedTick, this.store.simData() ?? undefined);
    const hqReady = this.entities.isHqDeployed();
    this.hqDeployedSynced = hqReady;
    this.landfall.onView(v);
    this.hud.update({ ...v, tick: v.tick, warp: this.warp, net: this.netStats.view(this.store.predictionInfo) });

    syncSessionBootOverlayOnView({
      view: v, status, hqReady, entities: this.entities, terrain: this.terrain, showSpaceTerrain: this.showSpaceTerrain,
      bootOverlay: this.bootOverlay, hud: this.hud, cam: this.cam, landfall: this.landfall, flags: this.flags,
      planetId: this.planetId, fastStartLand: this.fastStartLand, skipDescent: this.skipDescent,
      fromSpaceDescent: this.fromSpaceDescent, cameraCentered: this.cameraCentered, colonyFramed: this.colonyFramed,
      sendLandOnce: () => this.sendLandOnce(), focusTile: (q, r, instant) => this.focusTile(q, r, instant),
      setCameraTargetTile: (q, r) => { this.cameraTargetTile = { q, r }; },
      setCameraCentered: (val) => { this.cameraCentered = val; },
      setColonyFramed: (val) => { this.colonyFramed = val; },
    });
  }

  private setWarp(k: number): void {
    this.warp = k;
    const latest = this.store.latest;
    this.hud.update({ ...(latest ?? {}), tiles: undefined, tick: latest?.tick, warp: k, net: this.netStats.view(this.store.predictionInfo) });
  }

  private onTiles(v: ClientView, tiles: ClientTiles): void {
    const res = syncOrRebuildSessionTerrain({
      viewport: this.viewport, prevTerrain: this.terrain, prevTiles: this.tiles, prevCam: this.cam,
      prevBiomeKey: this.biomeKey, view: v, tiles, planetKind: this.planetKind,
      inSpace: this.entities.podTouchdown.isSpacePhaseActive(), showSpaceTerrain: this.showSpaceTerrain,
      cameraTargetTile: this.cameraTargetTile,
    });
    this.terrain = res.terrain;
    this.cam = res.cam;
    this.biomeKey = res.biomeKey;
    if (res.rebuilt) this.colonyFramed = false;
    this.tiles = tiles;
  }

  pickAt(clientX: number, clientY: number): HexPick | null {
    this.lastPick = pickTerrainAt(this.terrain, this.viewport, clientX, clientY);
    return this.lastPick;
  }

  tileToScreen(q: number, r: number): { x: number; y: number } | null {
    return projectTileToScreen(this.terrain, this.viewport, q, r);
  }

  entityMeshes(): Array<{ id: number; x: number; y: number; z: number }> {
    return listSceneEntities(this.viewport.scene);
  }

  private loop = () => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const rawDt = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(rawDt, 0.05);
    const animDt = Math.min(rawDt, 0.4) * Math.max(1, this.warp);
    this.last = now;
    try {
      if (!this.entities.podTouchdown.isSpacePhaseActive()) {
        this.entities.update(animDt, this.terrain, Math.min(rawDt, 0.4));
        this.cam?.setShake(this.entities.getCameraShake());
        this.terrain?.tick(animDt);
        this.frameHud(now, dt);
        if (this.cam) {
          this.cam.update(dt);
          this.viewport.followShadow(this.cam.target);
        }
      }
      if (this.ownsViewport && !this.store.isAwaitingPrediction(now)) this.viewport.render();
    } catch (e) { console.error('frame error', e); }
    if (typeof requestAnimationFrame === 'function') { if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.loop); }
  };

  private frameHud(now: number, dt: number): void {
    syncSessionFrameHud({
      now, dt, store: this.store, entities: this.entities, dayNightSync: this.dayNightSync,
      bootOverlay: this.bootOverlay, hud: this.hud, netStats: this.netStats,
      colonyIndex: this.colonyIndex, spawn: this.spawn, warp: this.warp,
      fastStartLand: this.fastStartLand, landSent: this.landSent, hqDeployedSynced: this.hqDeployedSynced,
      lastHudMs: this.lastHudMs, sendLandOnce: () => this.sendLandOnce(),
      onHqDeployedSync: (v) => { this.hqDeployedSynced = true; this.onView(v); },
      setLastHudMs: (ms) => { this.lastHudMs = ms; },
    });
  }

  dispose(): void {
    this.disposed = true;
    this.guest?.dispose();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.localHost?.stop();
    this.cleanups.forEach((f) => f());
    this.pauseOverlay.dispose();
    this.bootOverlay?.dispose();
    this.landfall.dispose();
    this.entities.dispose();
    this.commandBus.dispose();
    this.cam?.dispose();
    this.store.dispose();
    if (this.transport.dispose) this.transport.dispose(); else this.transport.stop();
    this.hud.dispose();
    this.banner?.dispose();
    if (this.terrain) { this.viewport.scene.remove(this.terrain.group); this.terrain.dispose(); this.terrain = null; }
    if (this.ownsViewport) this.viewport.dispose();
  }
}
