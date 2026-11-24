import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { createFramePacer } from '@terra/render/core/framePacer';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexPick, type HexTerrain } from '@terra/render/planets/hex';
import type { ServerMessage } from '@terra/contracts';
import type { CommandBus } from '../../net/commandBus';
import type { ConnectionBanner } from '../../net/ConnectionBanner';
import { bindVersionMismatchNotice } from '../../net/VersionMismatchNotice';
import { NetStatsBoard } from '../../net/netStats';
import type { ConnectionState, SessionTarget, Transport } from '../../net/types';
import { warpOfMessage } from '../../net/warpFeed';
import type { WsTransportDeps } from '../../net/WsTransport';
import { LocalHost } from '../../store/local/LocalHost';
import type { WorldStore } from '../../store/WorldStore';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import { isProductionBuild } from '../../core/buildEnv';
import { createClientFlagsStore, resolveClientFlags, type ClientFlagsStore } from '../../core/flags';
import type { LandfallController } from '../../features/landfall';
import type { RTSCamera } from '../RTSCamera';
import type { BootOverlay, BootPhase } from './BootOverlay';
import type { BootAuthResult, FetchLike, StorageLike } from './bootOnline';
import type { EntityMeshes, MeshFactory } from './EntityMeshes';
import type { FeatureHud } from './featureHud';
import type { GuestBootTarget } from './guestBoot';
import { isLocalSpectatorAllowed, isSpectatorSearch, stripSpectatorResetFromUrl, type OnlineMode } from './onlineMode';
import {
  applySessionBootResult, attachSessionLocalHost, bindSessionKeys, createSessionBootRig,
  resolveInitialLoadMode, resolveSocketFallback, runGuestBootSequence,
} from './parts/sessionBoot';
import { bindSessionTerrainLoader } from './parts/sessionTerrainLoader';
import { applySessionOrbitalReveal, applySessionSpacePhase, resolveSeatIndexFromSearch, settleArrivalHud, syncSessionBootOverlayOnView, syncSessionFrameHud } from './parts/sessionViewSync';
import { applySpectatorViewSetup, computeNextSessionLoopDelayMs, findColonyFocusTile, stepOnlineSessionFrame } from './parts/sessionSpectator';
import { retireReplacedSessionTerrain, SessionTerrainPreloader, type TerrainPreloadState } from './parts/terrainPreload';
import { PauseOverlay } from './PauseOverlay'; import { createUnitControl } from './unitControl';
import { prewarmSimWorker } from '../../store/worker/simWorkerPrewarm';
import type { ColonyLoadMode, PodLandingStateName } from './PodTouchdownFx';
import { extractPodDescentStatus, isUnplayedFreshColonyLanding } from './podStatus';
import type { PilotBridge } from './pilotBridge'; import { createSessionHud } from './sessionHud';
import { notePlayBooted, setPlayHost } from '../../../design/analytics/play';
import { scenarioParam } from './sessionTarget';
import { normalizeSectorIntent, type SectorIntentInput, type SectorIntentV1 } from '../../ui/lobby/orbitalPickerModel';
import { bindStoreCombatEvents, ingestHostMessageCombatEvents } from './combatSync';
import { bindOnlineDayNightSync, type OnlineDayNightSync } from './dayNightSync';
import {
  acquireSessionViewport, applyChangedTileList, bindLocalSaveListeners,
  listSceneEntities, pickTerrainAt, projectTileToScreen, resolveOnlinePlanetLook, resolveSessionPlanetKind,
  type TileChangePatchItem, writeStoredPlanetKind,
} from './viewportHelper';
import '../../../design/css/tokens.css';
import '../../../design/css/base.css';

export interface OnlineSessionOptions {
  viewport?: ColonyViewport; transport?: Transport; store?: WorldStore; localHost?: LocalHost;
  fetch?: FetchLike; storage?: StorageLike; search?: string; uiParent?: HTMLElement;
  makeMesh?: MeshFactory; wsDeps?: WsTransportDeps; planetKind?: PlanetKind;
  planetId?: string; colonyId?: string; newColony?: boolean; sectorIntent?: SectorIntentInput;
  pollQueuedHome?: boolean; enqueueOnNew?: boolean; pollIntervalMs?: number;
  wait?: (ms: number) => Promise<void>; onQueueCancelled?: (ticketId: string | null) => void;
  skipDescent?: boolean; fromSpaceDescent?: boolean; freshDeployment?: boolean; orbitalCameraDrop?: boolean; deferReveal?: boolean; loadMode?: ColonyLoadMode; onReturnToOrbit?: (kind: PlanetKind) => void;
  /** When true, caller (`Game.ts`) drives `stepFrame(dt, now)` from its own paced rAF loop so both never drift out of VSync phase. */
  externalFrameLoop?: boolean;
  /** May an unreachable game server fall back to a browser-local host (FA-06)? Default: dev builds only. */
  allowLocalFallback?: boolean;
  /** When false, skip `/v1/auth/refresh` on initial boot and log in with `deviceSecret` directly. */
  tryRefresh?: boolean;
}

/** Online play flow (`/play.html` short landing or `/play.html?planet=<kind>` full space-to-surface landing). */
export class OnlineSession {
  readonly viewport: ColonyViewport; readonly transport: Transport; readonly store: WorldStore;
  readonly commandBus: CommandBus; readonly commands: CommandBus; readonly entities: EntityMeshes;
  readonly landfall: LandfallController; readonly flags: ClientFlagsStore; readonly netStats = new NetStatsBoard();
  readonly bootOverlay: BootOverlay | null; readonly pauseOverlay: PauseOverlay;
  readonly whenBooted: Promise<BootAuthResult | null>;

  terrain: HexTerrain | null = null; cam: RTSCamera | null = null; lastPick: HexPick | null = null;
  private colonyFramed = false; private readonly arrival = { hold: false, quiet: true, noSelect: true, started: false };
  planetId = ''; colonyId: string | null = null; colonyIndex = 0; foundingSectorId: string | null = null;
  spawn = { q: 0, r: 0 }; cameraTargetTile = { q: 0, r: 0 };
  bootResult: BootAuthResult | null = null; planetKind: PlanetKind | null;
  readonly sectorIntent: SectorIntentV1;

  private biomeKey = 'forestRock'; private terrainBiomeKey = ''; private lastHudMs = 0;
  private readonly ownsViewport: boolean; private readonly externalFrameLoop: boolean; private readonly search: string;
  private skipDescent: boolean; private readonly fromSpaceDescent: boolean; private readonly fastStartLand: boolean;
  private readonly onReturnToOrbit?: (kind: PlanetKind) => void; private readonly allowLocalFallback: boolean;
  private banner: ConnectionBanner | null; private readonly hud: FeatureHud;
  private readonly pilot: PilotBridge;
  private readonly bootTarget: SessionTarget; private readonly guest: GuestBootTarget | null;
  private disposed = false; private localHost: LocalHost | null = null;
  private showSpaceTerrain = false; private cameraCentered = false; private landSent = false; private hqDeployedSynced = false;
  spectator: boolean; private spectatorVisionAll = true; private spectatorAutoFocused = false;
  private freshDeployment: boolean; private orbitalCameraDrop: boolean; private deferReveal: boolean;
  loadMode: ColonyLoadMode; private readonly explicitLoadMode: boolean;
  private sawPodDescending = false; private firstObservedTick: number | null = null;
  private tiles: ClientTiles | null = null; private warp = 1; private raf = 0;
  private dayNightSync: OnlineDayNightSync | null = null;
  private readonly pacer = createFramePacer({ maxDt: 0.05 });
  private readonly terrainLoader = bindSessionTerrainLoader(this, {
    getPlanetSeed: () => this.bootResult?.planet.seed, getBiomeKey: () => this.biomeKey, setBiomeKey: (k) => { this.biomeKey = k; },
    getTiles: () => this.tiles, setTiles: (t) => { this.tiles = t; },
    isInSpace: () => this.entities.podTouchdown.isSpacePhaseActive(), getShowSpaceTerrain: () => this.showSpaceTerrain,
    getDeferReveal: () => this.deferReveal, getCameraTargetTile: () => this.cameraTargetTile,
    onTerrainMounted: (v) => { this.colonyFramed = false; this.onView({ ...(this.store.latest ?? v), tiles: undefined }); },
  });
  private readonly preloader = new SessionTerrainPreloader((res) => this.applyTerrainState(res, true), () => ({
    inSpace: this.entities.podTouchdown.isSpacePhaseActive(), showSpaceTerrain: this.showSpaceTerrain, deferLook: this.deferReveal, cameraTargetTile: this.cameraTargetTile,
  }));
  private last = typeof performance !== 'undefined' ? performance.now() : Date.now(); private cleanups: Array<() => void> = [];

  constructor(root: HTMLElement, readonly mode: OnlineMode = 'boot', opts: OnlineSessionOptions = {}) {
    this.externalFrameLoop = Boolean(opts.externalFrameLoop);
    this.search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    const q = new URLSearchParams(this.search);
    this.spectator = isSpectatorSearch(this.search);
    const lm = resolveInitialLoadMode(opts, this.search, mode);
    this.loadMode = lm.loadMode; this.explicitLoadMode = lm.explicit;
    this.skipDescent = Boolean(opts.skipDescent || q.get('skip') === '1' || this.loadMode === 'instant' || this.spectator);
    this.fromSpaceDescent = Boolean(!this.spectator && opts.fromSpaceDescent && this.loadMode === 'pod');
    this.freshDeployment = Boolean(!this.spectator && opts.freshDeployment && this.loadMode === 'pod');
    const devBuild = !isProductionBuild();
    const devScenario = devBuild ? scenarioParam(this.search) : null;
    this.orbitalCameraDrop = opts.orbitalCameraDrop ?? (!this.spectator && this.loadMode !== 'instant' && !this.fromSpaceDescent && mode === 'boot' && !devScenario);
    this.deferReveal = Boolean(!this.spectator && opts.deferReveal);
    this.fastStartLand = Boolean(!this.spectator && (this.skipDescent || this.loadMode === 'direct' || (!opts.wsDeps && !opts.localHost && !devScenario)));
    this.onReturnToOrbit = opts.onReturnToOrbit;
    this.allowLocalFallback = devBuild && (opts.allowLocalFallback ?? Boolean(import.meta.env?.DEV));
    this.planetKind = resolveSessionPlanetKind(q, opts.planetKind);
    this.sectorIntent = normalizeSectorIntent(opts.sectorIntent ?? q.get('sector'));
    if (devBuild && q.get('host') === 'local') setPlayHost('local');
    notePlayBooted(this.planetKind, devBuild && q.get('host') === 'local' ? 'local' : 'online');
    this.flags = createClientFlagsStore(this.search);
    const uiParent = opts.uiParent ?? (typeof document !== 'undefined' ? document.body : root);
    if (!opts.store) prewarmSimWorker();
    const acquired = acquireSessionViewport(root, opts.viewport, this.cleanups);
    this.viewport = acquired.viewport; this.ownsViewport = acquired.ownsViewport;

    const rig = createSessionBootRig({
      mode, loadMode: this.loadMode, search: this.search, flags: this.flags, planetKind: this.planetKind,
      allowLocalFallback: this.allowLocalFallback, skipDescent: this.skipDescent, fromSpaceDescent: this.fromSpaceDescent, deferReveal: this.deferReveal,
      uiParent, scene: this.viewport.scene, opts, getBootOverlay: () => this.bootOverlay,
      onBooted: (b) => this.applyBootResult(b), onQueueCancelled: () => this.returnToOrbit(),
    });
    if (this.spectator && opts.search === undefined) stripSpectatorResetFromUrl();
    this.guest = rig.guest; this.bootTarget = rig.bootTarget; this.pilot = rig.pilot;
    this.transport = rig.transport; this.banner = rig.banner; this.store = rig.store;
    this.cleanups.push(bindVersionMismatchNotice(uiParent, this.store, () => this.store.currentPlanetId() || this.planetId || null));
    this.commandBus = rig.commandBus; this.commands = this.commandBus; this.entities = rig.entities; this.bootOverlay = rig.bootOverlay;
    const control = createUnitControl({
      store: this.store, commandBus: this.commandBus, canvas: this.viewport.renderer.domElement, entities: this.entities,
      pickAt: (cx, cy) => this.pickAt(cx, cy), terrain: () => this.terrain, toast: (m) => this.hud?.toast(m), netStats: this.netStats,
      spectator: () => this.spectator, onColonyInspected: (idx) => this.inspectColony(idx, false),
    });
    this.landfall = control.landfall; this.landfall.deselect(); this.cleanups.push(control.dispose);
    this.hud = createSessionHud({
      uiParent, flags: this.flags, local: rig.local, scene: this.viewport.scene, canvas: this.viewport.renderer.domElement,
      store: this.store, commandBus: this.commandBus, netStats: this.netStats, transport: this.transport, landfall: this.landfall,
      terrain: () => this.terrain, biomeKey: () => this.biomeKey, localHost: () => this.localHost, colonyIndex: () => this.colonyIndex,
      homeColonyId: () => this.colonyId, planetId: () => this.store.currentPlanetId() || this.planetId || null, pickAt: (cx, cy) => this.pickAt(cx, cy),
      camera: () => this.viewport.camera, rtsCamera: () => this.cam, focusTile: (q, r, s) => this.focusTile(q, r, s), pilot: this.pilot, token: () => this.bootTarget.accessToken,
      renderedEntityPosition: (id) => this.entities.getRecord(id)?.mesh.position ?? null,
      deferInitialMount: Boolean(opts.externalFrameLoop && ((this.fromSpaceDescent && !this.skipDescent) || this.deferReveal)),
      isLocalHost: Boolean(rig.local || opts.localHost || (devBuild && q.get('host') === 'local')),
      isSpectator: () => this.spectator, isSpectatorVisionAll: () => this.spectatorVisionAll, setSpectatorVisionAll: (on) => this.setSpectatorVisionAll(on),
      inspectColony: (idx, focus) => this.inspectColony(idx, focus), onReadOnlyReject: () => this.hud.toast('Spectator mode is read-only'),
    });
    this.pauseOverlay = new PauseOverlay(uiParent, { onResume: () => this.setPaused(false), onReturnToOrbit: () => this.returnToOrbit() });
    if (rig.local) this.cleanups.push(bindLocalSaveListeners(rig.local));
    this.bindTransportListeners(); this.bindKeys();
    const predict = !devBuild || q.get('predict') !== '0';
    const hideInitialHud = (this.fromSpaceDescent && !this.skipDescent) || this.deferReveal || Boolean(this.bootOverlay && this.bootOverlay.phase !== 'colony');
    this.hud.setVisible(!hideInitialHud); this.hud.collapseCommandDock();
    if (this.guest) { this.whenBooted = this.startBootSequence(this.guest, opts, predict); }
    else {
      this.whenBooted = Promise.resolve(null); this.cleanups.push(this.store.onView((v) => this.onView(v)));
      this.store.start([...this.flags.set], { predict });
      if (opts.localHost) this.attachLocalHost(opts.localHost, false, false); else this.transport.start();
    }
    if (!opts.externalFrameLoop) this.loop();
  }

  private bindTransportListeners(): void {
    this.cleanups.push(this.transport.onMessage((m) => this.onHostMessage(m)), bindStoreCombatEvents(this.store, this.entities.combatSync, () => this.terrain));
    this.dayNightSync = bindOnlineDayNightSync({
      store: this.store, commandBus: this.commandBus, warp: () => this.warp,
      hasColony: () => Boolean(!this.spectator && this.colonyId && this.store.latest?.colonies[this.colonyIndex]?.status !== 'eliminated'),
    });
    this.cleanups.push(() => this.dayNightSync?.dispose());
  }

  private onHostMessage(m: ServerMessage): void {
    const k = warpOfMessage(m);
    if (k !== undefined) this.setWarp(k);
    ingestHostMessageCombatEvents(m, this.entities.combatSync, this.terrain);
    if (m.t === 'welcome') {
      this.planetId = m.d.planet.id;
      if (m.d.mode === 'spectator' && isLocalSpectatorAllowed()) this.spectator = true;
      if (!this.spectator && m.d.colonyId && !this.colonyId) this.colonyId = m.d.colonyId;
      this.flags.update(resolveClientFlags({ welcomeFlags: m.d.flags, search: this.search, dev: !isProductionBuild() && Boolean(import.meta.env?.DEV) }));
      this.hud.showWelcome(m.d);
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
    if (phase === null) this.flushTerrainPreload();
    const isGroundReady = Boolean(this.terrain?.isBuildComplete() && this.preloader.isGpuReadyForGround(this.viewport));
    const ready = applySessionSpacePhase({
      phase, showTerrain, isGroundReady, entities: this.entities, banner: this.banner, terrain: this.terrain,
      cameraTargetTile: this.cameraTargetTile, store: this.store, planetKind: this.planetKind, planetSeed: this.bootResult?.planet.seed,
      viewport: this.viewport, dayNightSync: this.dayNightSync,
      focusTile: (q, r, instant) => this.focusTile(q, r, instant), onView: (v) => this.onView(v),
    });
    if (phase === null && this.guest && (!this.bootResult || !this.store.latest)) {
      if (this.banner && !this.bootResult) this.banner.el.style.display = 'none';
      if (this.bootOverlay?.phase === 'descent') this.bootOverlay.showSplash('Contacting orbit…');
      this.hud.setVisible(false);
    }
    return ready;
  }

  isColonyReady(): boolean { return Boolean(this.store.latest && this.terrain?.isBuildComplete() && this.cam); }

  revealFromOrbitalDive(skipCameraDrop = false): void {
    if (!this.deferReveal) return;
    this.deferReveal = false; this.arrival.quiet = true; this.arrival.noSelect = true;
    this.flushTerrainPreload();
    if (skipCameraDrop) { this.orbitalCameraDrop = false; this.loadMode = 'instant'; }
    applySessionOrbitalReveal({
      terrain: this.terrain, store: this.store, planetKind: this.planetKind, planetSeed: this.bootResult?.planet.seed,
      viewport: this.viewport, dayNightSync: this.dayNightSync, banner: this.banner, hasBootResult: Boolean(this.bootResult),
      isLocalHost: Boolean(this.localHost), bootOverlay: this.bootOverlay, entities: this.entities,
      onView: (v) => this.onView(v),
    });
  }

  skipLanding(): void {
    this.skipDescent = true;
    this.loadMode = 'instant';
    this.arrival.quiet = true;
    this.setSpacePhase(null);
    this.entities.podTouchdown.setSkipLocked(true);
    const ready = !this.guest || (this.bootResult !== null && this.store.latest !== null);
    this.hud.ensureMounted();
    if (!ready) {
      this.hud.setVisible(false);
      return;
    }
    this.sendLandOnce();
    this.bootOverlay?.showColony(this.planetId || 'pl_dev');
    this.hud.setVisible(true);
    if (this.store.latest) { this.onView(this.store.latest); this.entities.update(0, this.terrain); }
  }

  /** Fast start (FA-08), once per session: `landPod` opens the own pod once it has descended `podLandMinS`. */
  private sendLandOnce(): void {
    if (this.spectator || this.landSent) return;
    this.landSent = true;
    void this.commandBus.send('landPod', {}, { predict: false });
  }

  setSpectatorVisionAll(on: boolean): void {
    this.spectatorVisionAll = on;
    this.entities.setSpectatorAllVision(on);
    if (this.store.latest) this.hud.update({ ...this.store.latest, tick: this.store.latest.tick, warp: this.warp, net: this.netStats.view(this.store.predictionInfo) });
  }

  inspectColony(colonyIndex: number, focusCamera = false): void {
    this.colonyIndex = colonyIndex;
    this.entities.setOwnerColonyIndex(colonyIndex);
    this.landfall.setOwnerColonyIndex(colonyIndex);
    if (focusCamera) {
      const tile = findColonyFocusTile(this.store.latest, colonyIndex);
      if (tile) { this.cameraTargetTile = tile; this.focusTile(tile.q, tile.r, true); }
    }
    if (this.store.latest) this.hud.update({ ...this.store.latest, tick: this.store.latest.tick, warp: this.warp, net: this.netStats.view(this.store.predictionInfo) });
  }

  selectHq(): number | null { return this.landfall.selectHq(); }
  clickTile(q: number, r: number): boolean { return this.landfall.clickTile(q, r); }
  orderMove(q: number, r: number): boolean { return this.landfall.orderMove(q, r); }
  getSelectedEntityId(): number | null { return this.landfall.getSelectedEntityId(); }
  pickAt(cx: number, cy: number): HexPick | null { return (this.lastPick = pickTerrainAt(this.terrain, this.viewport, cx, cy)); }
  tileToScreen(q: number, r: number): { x: number; y: number } | null { return projectTileToScreen(this.terrain, this.viewport, q, r); }
  entityMeshes(): Array<{ id: number; x: number; y: number; z: number }> { return listSceneEntities(this.viewport.scene); }
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

  private startBootSequence(guest: GuestBootTarget, opts: OnlineSessionOptions, predict: boolean): Promise<BootAuthResult | null> {
    return runGuestBootSequence({
      guest, opts, predict, flags: [...this.flags.set], store: this.store, transport: this.transport,
      entities: this.entities, getBanner: () => this.banner, isDisposed: () => this.disposed,
      onCleanup: (fn) => this.cleanups.push(fn), onView: (v) => this.onView(v),
      attachLocalHost: (lh, auto, off) => this.attachLocalHost(lh, auto, off), onSocketState: (s, b) => this.onSocketState(s, b),
    });
  }
  private onSocketState(s: ConnectionState, boot: BootAuthResult): void {
    const fb = resolveSocketFallback({
      state: s, boot, disposed: this.disposed, hasLatestView: Boolean(this.store.latest),
      hasLocalHost: Boolean(this.localHost), allowLocalFallback: this.allowLocalFallback, spawn: this.spawn, planetKind: this.planetKind,
    });
    if (!fb) return;
    this.applyBootResult(fb);
    if (fb.localHost) this.attachLocalHost(fb.localHost, typeof window !== 'undefined', true);
  }
  private applyBootResult(boot: BootAuthResult): void {
    if (this.disposed) return;
    this.bootResult = boot;
    const s = applySessionBootResult({
      boot, pilot: this.pilot, entities: this.entities, landfall: this.landfall, bootOverlay: this.bootOverlay,
      planetKind: this.planetKind, skipDescent: this.skipDescent, fromSpaceDescent: this.fromSpaceDescent,
      freshDeployment: this.freshDeployment, loadMode: this.loadMode,
    });
    this.planetId = s.planetId; this.colonyId = s.colonyId; this.colonyIndex = s.colonyIndex; this.foundingSectorId = s.foundingSectorId;
    this.spawn = s.spawn; this.cameraTargetTile = { q: s.spawn.q, r: s.spawn.r }; this.freshDeployment = s.freshDeployment; this.loadMode = s.loadMode;
  }

  /** In-process host (`?host=local` or offline fallback): routes commands, binds store, and hides banner when offline. */
  private attachLocalHost(lh: LocalHost, autoStep: boolean, offline: boolean): void {
    this.localHost = lh; this.entities.prestige.isEnabled = () => false; this.hud.setHost('local');
    const r = attachSessionLocalHost({
      lh, autoStep, offline, transport: this.transport, store: this.store, commandBus: this.commandBus,
      bootOverlay: this.bootOverlay, banner: this.banner, getActiveLocalHost: () => this.localHost,
      onHostMessage: (m) => this.onHostMessage(m),
    });
    this.cleanups.push(r.cleanup); this.banner = r.banner;
  }

  private bindKeys(): void {
    this.cleanups.push(bindSessionKeys({
      entities: this.entities, cam: () => this.cam, isDeferringReveal: () => this.deferReveal, landingSkippable: () => this.landingSkippable(),
      skipLanding: () => this.skipLanding(), togglePaused: () => this.setPaused(!this.pauseOverlay.paused),
    }));
  }

  /** FA-11: only while the own pod is descending (or the descent overlay still shows its touchdown). */
  private landingSkippable(): boolean {
    if (this.skipDescent) return false;
    if (this.bootOverlay?.phase === 'descent') return true;
    return extractPodDescentStatus(this.store.latest, this.colonyIndex, this.spawn).descending;
  }

  private onView(v: ClientView): void {
    if (this.spectator || (this.store.isSpectator() && isLocalSpectatorAllowed())) {
      this.spectator = true;
      this.spectatorAutoFocused = applySpectatorViewSetup({
        view: v, entities: this.entities, landfall: this.landfall,
        spectatorVisionAll: this.spectatorVisionAll, colonyIndex: this.colonyIndex,
        autoFocused: this.spectatorAutoFocused, inspectColony: (idx, focus) => this.inspectColony(idx, focus),
      });
    } else if (!this.guest && this.colonyIndex === 0) {
      const asIdx = resolveSeatIndexFromSearch(this.search, v);
      if (asIdx !== null) {
        this.colonyIndex = asIdx; this.entities.setOwnerColonyIndex(asIdx); this.landfall.setOwnerColonyIndex(asIdx);
      }
    }
    this.dayNightSync?.syncFrame();
    const status = extractPodDescentStatus(v, this.colonyIndex, this.spawn);
    if (this.entities.podTouchdown.isSpacePhaseActive() || this.deferReveal) this.cameraTargetTile = { q: status.q, r: status.r };
    if (v.tiles) this.onTiles(v, v.tiles);
    this.biomeKey = resolveOnlinePlanetLook(v.planet.type, this.planetKind, v.planet.seed ?? this.bootResult?.planet.seed).biomeKey;
    if (this.firstObservedTick === null) this.firstObservedTick = v.tick;
    if (!this.explicitLoadMode && this.loadMode === 'pod' && !status.descending && status.hqLanded) this.loadMode = 'direct';
    if (this.loadMode !== 'pod') {
      this.entities.podTouchdown.setSkipLocked(true);
      if (status.descending) this.sendLandOnce();
    } else {
      if (status.descending || (this.freshDeployment && isUnplayedFreshColonyLanding(v, this.colonyIndex, this.spawn, this.firstObservedTick))) this.sawPodDescending = true;
      if (!this.entities.podTouchdown.isSpacePhaseActive() && !this.sawPodDescending && !this.landSent && !status.descending && status.hqLanded && this.entities.podTouchdown.peekSurfaceState().elapsed === 0) {
        this.entities.podTouchdown.setEnabled(false);
      }
    }
    this.entities.syncView(v, this.terrain, this.biomeKey, this.store.confirmedTick, this.store.simData() ?? undefined);
    const hqReady = this.entities.isHqDeployed();
    this.hqDeployedSynced = hqReady;
    this.landfall.onView(v);
    this.hud.update({ ...v, tick: v.tick, warp: this.warp, net: this.netStats.view(this.store.predictionInfo) });

    syncSessionBootOverlayOnView({
      view: v, status, hqReady, entities: this.entities, terrain: this.terrain, showSpaceTerrain: this.showSpaceTerrain,
      bootOverlay: this.bootOverlay, hud: this.hud, cam: this.cam, landfall: this.landfall, flags: this.flags,
      planetId: this.planetId, fastStartLand: this.fastStartLand, loadMode: this.loadMode, skipDescent: this.skipDescent,
      fromSpaceDescent: this.fromSpaceDescent, deferReveal: this.deferReveal, orbitalCameraDrop: this.orbitalCameraDrop,
      sawPodDescending: this.sawPodDescending, cameraCentered: this.cameraCentered, colonyFramed: this.colonyFramed, arrival: this.arrival,
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

  private applyTerrainState(res: TerrainPreloadState | null, syncEntities = false): void {
    if (!res) return;
    const isGroundReady = Boolean(res.terrain?.isBuildComplete() && this.preloader.isGpuReadyForGround(this.viewport));
    retireReplacedSessionTerrain({
      viewport: this.viewport, prevTerrain: this.terrain, nextTerrain: res.terrain, prevCam: this.cam, nextCam: res.cam,
      rebuilt: res.rebuilt, inSpace: this.entities.podTouchdown.isSpacePhaseActive(),
      showSpaceTerrain: this.showSpaceTerrain, isGroundReady, cameraTargetTile: this.cameraTargetTile,
    });
    this.terrain = res.terrain; this.cam = res.cam; this.terrainBiomeKey = res.biomeKey; this.biomeKey = res.biomeKey; this.tiles = res.tiles;
    if (res.rebuilt) this.colonyFramed = false;
    if (syncEntities && this.store.latest) this.entities.syncView(this.store.latest, this.terrain, this.biomeKey, this.store.confirmedTick, this.store.simData() ?? undefined);
  }
  private flushTerrainPreload(): void {
    this.applyTerrainState(this.preloader.flushForSurface({
      viewport: this.viewport, terrain: this.terrain, tiles: this.tiles, cam: this.cam,
      biomeKey: this.terrainBiomeKey, planetKind: this.planetKind, cameraTargetTile: this.cameraTargetTile, entities: this.entities,
    }));
  }
  private onTiles(v: ClientView, tiles: ClientTiles): void {
    if (!this.externalFrameLoop) return this.terrainLoader.onTiles(v, tiles);
    this.applyTerrainState(this.preloader.syncTiles({
      viewport: this.viewport, prevTerrain: this.terrain, prevTiles: this.tiles, prevCam: this.cam, prevBiomeKey: this.terrainBiomeKey,
      view: v, tiles, planetKind: this.planetKind, inSpace: this.entities.podTouchdown.isSpacePhaseActive(),
      showSpaceTerrain: this.showSpaceTerrain, deferLook: this.deferReveal, cameraTargetTile: this.cameraTargetTile,
    }));
  }

  /** Advances one frame of session interpolation, terrain/entity prewarm, HUD, and camera (driven by `Game` or `this.loop`). */
  stepFrame(dt: number, nowMs?: number): void {
    const now = nowMs ?? (this.last + dt * 1000);
    const rawDt = nowMs !== undefined ? Math.max(0, (now - this.last) / 1000) : Math.max(0, dt);
    const animDt = Math.min(rawDt, 0.4) * Math.max(1, this.warp);
    this.last = now;
    stepOnlineSessionFrame({
      dt, now, rawDt, animDt, skipDescent: this.skipDescent, loadMode: this.loadMode,
      hqDeployedSynced: this.hqDeployedSynced, deferReveal: this.deferReveal, externalFrameLoop: this.externalFrameLoop, ownsViewport: this.ownsViewport,
      viewport: this.viewport, terrain: this.terrain, cam: this.cam, entities: this.entities,
      preloader: this.preloader, store: this.store, arrival: this.arrival, landfall: this.landfall, hud: this.hud,
      ensureHud: () => { if (this.flags.current.source === 'welcome' || (!this.guest && !this.localHost)) this.hud.ensureMounted(); },
      syncDayNight: (t) => this.dayNightSync?.syncFrame(t),
      frameHud: (t, stepDt) => this.frameHud(t, stepDt),
      settleArrival: settleArrivalHud,
    });
  }

  private loop = (now = typeof performance !== 'undefined' ? performance.now() : Date.now()) => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.pacer.next(now);
    if (dt !== null) { try { this.stepFrame(dt, now); } catch (e) { console.error('frame error', e); } }
    const delayMs = computeNextSessionLoopDelayMs(this.viewport, this.search, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    if (typeof requestAnimationFrame === 'function' && !this.disposed) {
      if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
      if (delayMs > 0 && typeof setTimeout === 'function') setTimeout(() => { if (!this.disposed) this.raf = requestAnimationFrame(this.loop); }, delayMs);
      else this.raf = requestAnimationFrame(this.loop);
    }
  };

  private frameHud(now: number, dt: number): void {
    syncSessionFrameHud({ now, dt, store: this.store, entities: this.entities, dayNightSync: this.dayNightSync, bootOverlay: this.bootOverlay, hud: this.hud, netStats: this.netStats, colonyIndex: this.colonyIndex, spawn: this.spawn, warp: this.warp, fastStartLand: this.fastStartLand, landSent: this.landSent, hqDeployedSynced: this.hqDeployedSynced, lastHudMs: this.lastHudMs, sendLandOnce: () => this.sendLandOnce(), onHqDeployedSync: (v) => { this.hqDeployedSynced = true; this.onView(v); }, setLastHudMs: (ms) => { this.lastHudMs = ms; } });
  }

  dispose(): void {
    this.disposed = true; this.terrainLoader.dispose(); this.preloader.dispose(); this.guest?.dispose();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.localHost?.stop(); this.cleanups.forEach((f) => f());
    this.pauseOverlay.dispose(); this.bootOverlay?.dispose(); this.landfall.dispose(); this.entities.dispose();
    this.commandBus.dispose(); this.cam?.dispose(); this.store.dispose();
    if (this.transport.dispose) this.transport.dispose(); else this.transport.stop();
    this.hud.dispose(); this.banner?.dispose();
    if (this.terrain) { this.viewport.scene.remove(this.terrain.group); this.terrain.dispose(); this.terrain = null; }
    if (this.ownsViewport) this.viewport.dispose();
  }
}
