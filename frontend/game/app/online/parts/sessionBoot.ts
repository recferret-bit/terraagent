import { COMMAND_TIMEOUT_MS, CommandBus } from '../../../net/commandBus';
import { ConnectionBanner } from '../../../net/ConnectionBanner';
import { LagTransport, withDevLag } from '../../../net/LagTransport';
import { createLocalWorker, LocalTransport, workerLink } from '../../../net/LocalTransport';
import type { SessionTarget, Transport } from '../../../net/types';
import { WsTransport, browserDeps } from '../../../net/WsTransport';
import { WorldStore } from '../../../store/WorldStore';
import type { ClientFlagsStore } from '../../../core/flags';
import type { ColonyLoadMode } from '../PodTouchdownFx';
import { BootOverlay } from '../BootOverlay';
import { devPlanetTypeOfKind, type BootAuthResult } from '../bootOnline';
import { EntityMeshes } from '../EntityMeshes';
import { GuestBootTarget } from '../guestBoot';
import { localHostOptions } from '../localHost';
import type { OnlineMode } from '../onlineMode';
import type { OnlineSessionOptions } from '../OnlineSession';
import { PilotBridge } from '../pilotBridge';
import { createSessionTarget, joinParam, scenarioParam } from '../sessionTarget';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type * as THREE from 'three';

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
  const skip = Boolean(opts.skipDescent || q.get('skip') === '1');
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
  // `?lag=` adds its round trip to the confirm timeout, so a slow test link does not roll predictions back
  const lagMs = transport instanceof LagTransport ? 2 * transport.ms : 0;
  const commandBus = new CommandBus(
    transport,
    COMMAND_TIMEOUT_MS + lagMs,
    (id, kind, args) => store.notifySent(id, kind, args),
    (id) => store.notifyTimedOut(id),
  );

  const playPodTouchdown = loadMode === 'pod' && !skipDescent;
  const entities = new EntityMeshes(scene, opts.makeMesh, playPodTouchdown);
  entities.healthBars.isEnabled = () => flags.current.flags.has('W02');
  entities.isW10Enabled = () => flags.current.flags.has('W10');
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
