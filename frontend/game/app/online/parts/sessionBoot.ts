import type { ServerMessage } from '@terra/contracts';
import { noteBootFailure, notePlayBooted, setPlayHost } from '../../../../design/analytics/play';
import { COMMAND_TIMEOUT_MS, CommandBus } from '../../../net/commandBus';
import { ConnectionBanner } from '../../../net/ConnectionBanner';
import { LagTransport, withDevLag } from '../../../net/LagTransport';
import { createLocalWorker, LocalTransport, workerLink } from '../../../net/LocalTransport';
import type { ConnectionState, SessionTarget, Transport } from '../../../net/types';
import { WsTransport, browserDeps } from '../../../net/WsTransport';
import type { LocalHost } from '../../../store/local/LocalHost';
import { WorldStore } from '../../../store/WorldStore';
import type { ClientFlagsStore } from '../../../core/flags';
import type { ColonyLoadMode } from '../PodTouchdownFx';
import { BootOverlay } from '../BootOverlay';
import { NOT_YOUR_PLANET } from '../../../net/closeCodes';
import { createLocalBootFallback, devPlanetTypeOfKind, type BootAuthResult } from '../bootOnline';
import { EntityMeshes } from '../EntityMeshes';
import { GuestBootTarget } from '../guestBoot';
import { localHostOptions } from '../localHost';
import { isSpectatorSearch, type OnlineMode } from '../onlineMode';
import type { OnlineSessionOptions } from '../OnlineSession';
import { PilotBridge } from '../pilotBridge';
import { createSessionTarget, joinParam, scenarioParam } from '../sessionTarget';
import type { LandfallController } from '../../../features/landfall';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type * as THREE from 'three';

export interface BootResultSummary {
  planetId: string;
  colonyId: string;
  colonyIndex: number;
  foundingSectorId: string | null;
  spawn: { q: number; r: number };
  freshDeployment: boolean;
  loadMode: ColonyLoadMode;
}

function planetKindFromBoot(type: string): 'dune' | 'oceanForest' | 'forestRock' | null {
  if (type === 'desert' || type === 'dune') return 'dune';
  if (type === 'ocean' || type === 'oceanForest') return 'oceanForest';
  if (type === 'temperate' || type === 'forestRock') return 'forestRock';
  return null;
}

export function applySessionBootResult(params: {
  boot: BootAuthResult;
  pilot: PilotBridge;
  entities: EntityMeshes;
  landfall: LandfallController;
  bootOverlay: BootOverlay | null;
  planetKind?: PlanetKind | null;
  skipDescent: boolean;
  fromSpaceDescent: boolean;
  freshDeployment: boolean;
  loadMode: ColonyLoadMode;
}): BootResultSummary {
  const { boot, pilot, entities, landfall, bootOverlay, planetKind, skipDescent, fromSpaceDescent } = params;
  pilot.note(boot);
  const planetId = boot.planet.id;
  const colonyId = boot.colony.id;
  const colonyIndex = boot.colony.colonyIndex;
  const foundingSectorId = boot.colony.foundingSectorId ?? boot.foundingSectorId ?? null;
  const spawn = boot.colony.spawn;
  entities.setOwnerColonyIndex(colonyIndex);
  landfall.setOwnerColonyIndex(colonyIndex);
  bootOverlay?.hideQueueStatus();
  bootOverlay?.setColonyMeta(planetId, colonyId, colonyIndex);
  notePlayBooted(planetKindFromBoot(boot.planet.type) ?? planetKind, boot.mode === 'local' ? 'local' : 'online');
  let { freshDeployment, loadMode } = params;
  if (boot.wasQueued && loadMode !== 'direct') {
    freshDeployment = true;
    loadMode = skipDescent ? 'instant' : 'pod';
  }
  if (!skipDescent) {
    if (boot.wasQueued) bootOverlay?.showDescent({ progress: 0, q: spawn.q, r: spawn.r, landed: fromSpaceDescent });
    else bootOverlay?.setSplashStatus(loadMode === 'pod' ? 'Deploying drop pod…' : 'Linking to colony…');
  }
  return { planetId, colonyId, colonyIndex, foundingSectorId, spawn, freshDeployment, loadMode };
}

export function attachSessionLocalHost(params: {
  lh: LocalHost;
  autoStep: boolean;
  offline: boolean;
  transport: Transport;
  store: WorldStore;
  commandBus: CommandBus;
  bootOverlay: BootOverlay | null;
  banner: ConnectionBanner | null;
  getActiveLocalHost: () => LocalHost | null;
  onHostMessage: (m: ServerMessage) => void;
}): { cleanup: () => void; banner: ConnectionBanner | null } {
  const { lh, autoStep, offline, transport, store, commandBus, bootOverlay, getActiveLocalHost, onHostMessage } = params;
  const cleanup = lh.onMessage((m) => { commandBus.handleMessage(m); onHostMessage(m); });
  const origSend = transport.send.bind(transport);
  transport.send = (m) => {
    const active = getActiveLocalHost();
    if (active) active.send(m);
    else origSend(m);
  };
  lh.bindStore(store);
  if (autoStep) lh.start();
  if (!offline) return { cleanup, banner: params.banner };
  setPlayHost('local');
  bootOverlay?.setOffline(true);
  params.banner?.dispose();
  return { cleanup, banner: null };
}

import { isTypingTarget } from '../../../features/shared/hotkeys';
import { isEscapeBlockedByHudOverlay } from '../viewportHelper';
import type { RTSCamera } from '../../RTSCamera';

export function bindSessionKeys(params: {
  entities: EntityMeshes;
  cam: () => RTSCamera | null;
  isDeferringReveal?: () => boolean;
  landingSkippable: () => boolean;
  skipLanding: () => void;
  togglePaused: () => void;
}): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (params.entities.podTouchdown.isSpacePhaseActive() || params.isDeferringReveal?.() || isTypingTarget(e)) return;
    const c = params.cam();
    if ((e.key === 'Escape' || e.key === ' ') && c?.isOrbitalDropping()) {
      e.preventDefault();
      c.completeOrbitalDrop();
      return;
    }
    if ((e.key === 'Escape' || e.key === ' ') && params.landingSkippable()) {
      e.preventDefault();
      params.skipLanding();
      return;
    }
    if (e.key === 'Escape' && !e.defaultPrevented && !isEscapeBlockedByHudOverlay()) {
      params.togglePaused();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export function resolveSocketFallback(params: {
  state: ConnectionState;
  boot: BootAuthResult;
  disposed: boolean;
  hasLatestView: boolean;
  hasLocalHost: boolean;
  allowLocalFallback: boolean;
  spawn: { q: number; r: number };
  planetKind: PlanetKind | null;
}): BootAuthResult | null {
  const { state, boot, disposed, hasLatestView, hasLocalHost, allowLocalFallback, spawn, planetKind } = params;
  if (state.phase !== 'terminal' || disposed || hasLatestView || hasLocalHost || !allowLocalFallback) return null;
  if (state.reason === NOT_YOUR_PLANET) return null;
  return createLocalBootFallback(boot.deviceSecret, undefined, spawn, devPlanetTypeOfKind(planetKind));
}

import type { ClientView } from '../../../store/replica/viewCodec';

export async function runGuestBootSequence(params: {
  guest: GuestBootTarget;
  opts: OnlineSessionOptions;
  predict: boolean;
  flags: readonly string[];
  store: WorldStore;
  transport: Transport;
  entities: EntityMeshes;
  getBanner: () => ConnectionBanner | null;
  isDisposed: () => boolean;
  onCleanup: (fn: () => void) => void;
  onView: (v: ClientView) => void;
  attachLocalHost: (lh: LocalHost, autoStep: boolean, offline: boolean) => void;
  onSocketState: (s: ConnectionState, boot: BootAuthResult) => void;
}): Promise<BootAuthResult | null> {
  const { guest, opts, predict, flags, store, transport, entities, getBanner, isDisposed, onCleanup, onView, attachLocalHost, onSocketState } = params;
  store.start([...flags], { predict });
  const boot = await guest.boot(); // applied through `onBooted`; null: disposed on the error splash
  if (!boot || isDisposed()) return boot; // FA-02: Return to orbit / HMR while the HTTP boot ran
  onCleanup(store.onView((v) => onView(v)));
  if (opts.localHost) attachLocalHost(opts.localHost, false, false);
  else if (boot.mode === 'local' && boot.localHost) attachLocalHost(boot.localHost, typeof window !== 'undefined', true);
  else {
    const banner = getBanner();
    if (banner && !entities.podTouchdown.isSpacePhaseActive()) banner.el.style.display = '';
    onCleanup(transport.onState((s) => onSocketState(s, boot)));
    transport.start();
    if (store.latest) onView(store.latest);
  }
  return boot;
}

export interface SessionBootRig {
  guest: GuestBootTarget | null;
  bootTarget: SessionTarget;
  pilot: PilotBridge;
  local: LocalTransport | null;
  transport: Transport;
  banner: ConnectionBanner | null;
  store: WorldStore;
  commandBus: CommandBus;
  entities: EntityMeshes;
  bootOverlay: BootOverlay | null;
}

export function resolveInitialLoadMode(
  opts: OnlineSessionOptions,
  search: string,
  mode: OnlineMode,
): { readonly loadMode: ColonyLoadMode; readonly explicit: boolean } {
  const q = new URLSearchParams(search);
  const skip = Boolean(opts.skipDescent || q.get('skip') === '1' || isSpectatorSearch(search));
  if (opts.loadMode) return { loadMode: opts.loadMode, explicit: true };
  if (skip) return { loadMode: 'instant', explicit: true };
  if (opts.fromSpaceDescent || opts.freshDeployment) return { loadMode: 'pod', explicit: true };
  if (opts.orbitalCameraDrop === true && opts.freshDeployment === false) return { loadMode: 'direct', explicit: true };
  return {
    loadMode: mode === 'scenario' ? 'instant' : 'pod',
    explicit: false,
  };
}

export function createSessionBootRig(params: {
  mode: OnlineMode;
  loadMode: ColonyLoadMode;
  search: string;
  flags: ClientFlagsStore;
  planetKind: PlanetKind | null;
  allowLocalFallback: boolean;
  skipDescent: boolean;
  fromSpaceDescent: boolean;
  deferReveal?: boolean;
  uiParent: HTMLElement;
  scene: THREE.Scene;
  opts: OnlineSessionOptions;
  getBootOverlay: () => BootOverlay | null;
  onBooted: (boot: BootAuthResult) => void;
  onQueueCancelled: () => void;
}): SessionBootRig {
  const {
    mode, loadMode, search, flags, planetKind, allowLocalFallback,
    skipDescent, fromSpaceDescent, uiParent, scene, opts,
    getBootOverlay, onBooted, onQueueCancelled,
  } = params;

  const loc = typeof location !== 'undefined'
    ? { protocol: location.protocol, host: location.host, search }
    : { protocol: 'http:', host: '127.0.0.1:5173', search };

  const useGuestBoot = mode === 'boot' && flags.set.has('W01') && !scenarioParam(search) && !joinParam(search);
  const guest = useGuestBoot
    ? new GuestBootTarget(`${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`, {
      fetch: opts.fetch,
      storage: opts.storage,
      search,
      planetType: devPlanetTypeOfKind(planetKind),
      planetId: opts.planetId,
      sectorIntent: opts.sectorIntent,
      pollQueuedHome: opts.pollQueuedHome ?? flags.set.has('W11'),
      enqueueOnNew: opts.enqueueOnNew ?? Boolean(opts.sectorIntent),
      pollIntervalMs: opts.pollIntervalMs,
      wait: opts.wait,
      allowLocalFallback,
      tryRefresh: opts.tryRefresh,
      onStatus: (s) => getBootOverlay()?.setSplashStatus(s),
      onQueueStatus: (status, cancel) => getBootOverlay()?.showQueueStatus(status, cancel),
      onQueueCancelled: (ticketId) => {
        getBootOverlay()?.hideQueueStatus();
        opts.onQueueCancelled?.(ticketId);
        onQueueCancelled();
      },
      onError: (m) => {
        const bo = getBootOverlay();
        if (!bo) noteBootFailure(m);
        return bo ? bo.showError(m) : Promise.reject(new Error(m));
      },
      onBooted,
    })
    : null;

  const bootTarget = guest ?? createSessionTarget(loc);
  const pilot = new PilotBridge({ fetch: opts.fetch, target: () => guest, sessionToken: () => bootTarget.accessToken });

  const localOpts = !useGuestBoot && !opts.transport && !opts.localHost ? localHostOptions(search) : null;
  const local = localOpts ? new LocalTransport(workerLink(createLocalWorker()), localOpts) : null;
  const transport = withDevLag(opts.transport ?? local ?? new WsTransport(bootTarget, opts.wsDeps ?? browserDeps()), search);
  const banner = typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.createTextNode === 'function'
    ? new ConnectionBanner(uiParent, transport, () => transport.start())
    : null;
  const store = opts.store ?? new WorldStore(transport);
  if (isSpectatorSearch(search)) store.setSpectator(true);
  // `?lag=` adds its round trip to the confirm timeout, so a slow test link does not roll predictions back
  const lagMs = transport instanceof LagTransport ? 2 * transport.ms : 0;
  const commandBus = new CommandBus(
    transport,
    COMMAND_TIMEOUT_MS + lagMs,
    (id, kind, args) => store.notifySent(id, kind, args),
    (id) => store.notifyTimedOut(id),
  );

  const playPodTouchdown = loadMode === 'pod' && !skipDescent;
  const deferPodRig = !playPodTouchdown || Boolean(fromSpaceDescent && !skipDescent);
  const entities = new EntityMeshes(scene, opts.makeMesh, playPodTouchdown, deferPodRig);
  entities.healthBars.isEnabled = () => flags.current.flags.has('W02');
  entities.isW10Enabled = () => flags.current.flags.has('W10');
  // W28-12 prestige: cosmetic and server-fed, so never for an in-browser host (`?host=local` shows tier 0)
  entities.prestige.isEnabled = () => flags.current.flags.has('W28') && !local && !opts.localHost;
  if (loadMode !== 'pod') {
    entities.podTouchdown.setSkipLocked(true);
  } else if (fromSpaceDescent && !skipDescent) {
    entities.podTouchdown.setMode('full');
    entities.podTouchdown.setSpacePhase('orbit');
    entities.group.visible = false;
    if (banner) banner.el.style.display = 'none';
  }

  const bootOverlay = createBootOverlay({ useGuestBoot, hasW01: flags.set.has('W01'), mode, loadMode, skipDescent, fromSpaceDescent, deferReveal: params.deferReveal, uiParent, banner });
  return { guest, bootTarget, pilot, local, transport, banner, store, commandBus, entities, bootOverlay };
}

function createBootOverlay(opts: {
  useGuestBoot: boolean;
  hasW01: boolean;
  mode: OnlineMode;
  loadMode: ColonyLoadMode;
  skipDescent: boolean;
  fromSpaceDescent: boolean;
  deferReveal?: boolean;
  uiParent: HTMLElement;
  banner: ConnectionBanner | null;
}): BootOverlay | null {
  const bootOverlay = opts.useGuestBoot || (opts.hasW01 && opts.mode === 'boot') ? new BootOverlay(opts.uiParent) : null;
  if (bootOverlay && (opts.skipDescent || opts.loadMode !== 'pod')) bootOverlay.showColony('pl_dev');
  else if (bootOverlay && opts.fromSpaceDescent) bootOverlay.showDescent({ progress: 0.9, q: 0, r: 0, landed: true });
  if (opts.deferReveal) {
    if (bootOverlay) {
      bootOverlay.splashEl.hidden = true;
      bootOverlay.descentEl.hidden = true;
      bootOverlay.colonyEl.hidden = true;
    }
    if (opts.banner) opts.banner.el.style.display = 'none';
  }
  return bootOverlay;
}
