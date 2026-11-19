import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { ClientFlagsStore } from '../../../core/flags';
import type { LandfallController } from '../../../features/landfall';
import type { ConnectionBanner } from '../../../net/ConnectionBanner';
import type { NetStatsBoard } from '../../../net/netStats';
import type { ClientView } from '../../../store/replica/viewCodec';
import type { WorldStore } from '../../../store/WorldStore';
import type { RTSCamera } from '../../RTSCamera';
import type { BootOverlay } from '../BootOverlay';
import type { OnlineDayNightSync } from '../dayNightSync';
import type { EntityMeshes } from '../EntityMeshes';
import type { FeatureHud } from '../featureHud';
import { extractPodDescentStatus, type PodDescentStatus } from '../podStatus';
import { POD_TOUCHDOWN_DESCENT_S, type ColonyLoadMode, type PodLandingStateName } from '../PodTouchdownFx';
import { applySpaceVoidBackground, resolveOnlinePlanetLook, syncSpaceTerrainOffset } from '../viewportHelper';

const tmpHqPos = new THREE.Vector3();

/** Camera dive onto an existing base. `hold` keeps the HUD hidden until the dive ends. */
export interface ArrivalHud {
  hold: boolean;
  /** When the HUD appears, clear selection and fold the Build pane. */
  quiet: boolean;
  /** Do not auto-select the HQ for this arrival. */
  noSelect: boolean;
  /** The orbital drop has been started at least once (a later terrain rebuild must not replay it). */
  started: boolean;
}

type ArrivalHudHost = {
  setVisible(visible: boolean): void;
  collapseCommandDock(): void;
};

/** Shows the gameplay HUD once the returning-colony camera drop has finished. */
export function settleArrivalHud(
  arrival: ArrivalHud,
  cam: { isOrbitalDropping(): boolean } | null,
  landfall: { deselect(): void },
  hud: ArrivalHudHost,
): void {
  if (!arrival.hold || cam?.isOrbitalDropping()) return;
  releaseArrivalHud(arrival, landfall, hud);
}

function releaseArrivalHud(arrival: ArrivalHud, landfall: { deselect(): void }, hud: ArrivalHudHost): void {
  const quiet = arrival.quiet;
  arrival.hold = false;
  arrival.quiet = false;
  if (quiet) landfall.deselect();
  hud.setVisible(true);
  if (quiet) hud.collapseCommandDock();
}

function beginOrbitalDrop(cam: RTSCamera, terrain: HexTerrain | null, hqObj: THREE.Object3D | null, q: number, r: number): void {
  if (hqObj) {
    cam.follow(hqObj);
    cam.startOrbitalDrop(hqObj.getWorldPosition(tmpHqPos), { duration: 1.55, followObj: hqObj });
    return;
  }
  const [tx, tz] = tileXZ(q, r);
  const ty = terrain ? terrain.heightAt(tx, tz) : 0;
  cam.startOrbitalDrop(tmpHqPos.set(tx, ty, tz), { duration: 1.55, followObj: null });
}

/** Frames the colony. A drop onto an existing base hides the HUD until the camera is on the HQ. */
function syncColonyArrival(deps: ViewOverlaySyncDeps, mode: ColonyLoadMode, status: PodDescentStatus): void {
  const hqObj = deps.entities.ownHqObject();
  const dropping = mode === 'direct' && Boolean(deps.orbitalCameraDrop) && !deps.sawPodDescending;
  if (!deps.colonyFramed && deps.cam) {
    deps.setColonyFramed(true);
    deps.focusTile(status.q, status.r, true);
    if (dropping && (!deps.arrival.started || deps.arrival.hold)) {
      beginOrbitalDrop(deps.cam, deps.terrain, hqObj, status.q, status.r);
      deps.arrival.started = true;
      deps.arrival.hold = true;
      deps.arrival.quiet = true;
      deps.arrival.noSelect = true;
    } else if (hqObj) {
      deps.cam.follow(hqObj);
    }
  } else if (deps.cam && hqObj && !deps.cam.followTarget) {
    deps.cam.follow(hqObj);
  }
  if (deps.arrival.hold && deps.cam?.isOrbitalDropping()) {
    deps.landfall.deselect();
    deps.hud.setVisible(false);
    return;
  }
  if (deps.arrival.hold || deps.arrival.quiet) {
    releaseArrivalHud(deps.arrival, deps.landfall, deps.hud);
    return;
  }
  deps.hud.setVisible(true);
}

export function resolveSeatIndexFromSearch(search: string, v: ClientView): number | null {
  const asParam = new URLSearchParams(search).get('as')?.trim().toLowerCase() ?? '';
  const asIdx = /^[a-e]$/.test(asParam) ? asParam.charCodeAt(0) - 97 : 0;
  if (asIdx > 0 && Array.isArray(v.colonies) && v.colonies.some((c) => c && c.index === asIdx)) {
    return asIdx;
  }
  return null;
}

export function applySessionSpacePhase(opts: {
  readonly phase: PodLandingStateName | null;
  readonly showTerrain: boolean;
  readonly isGroundReady?: boolean;
  readonly entities: EntityMeshes;
  readonly banner: ConnectionBanner | null;
  readonly terrain: HexTerrain | null;
  readonly cameraTargetTile: { readonly q: number; readonly r: number };
  readonly store: WorldStore;
  readonly planetKind: PlanetKind | null;
  readonly viewport: ColonyViewport;
  readonly dayNightSync?: OnlineDayNightSync | null;
  readonly focusTile: (q: number, r: number, instant?: boolean) => void;
  readonly onView: (v: ClientView) => void;
}): boolean {
  const wasActive = opts.entities.podTouchdown.isSpacePhaseActive();
  opts.entities.podTouchdown.setSpacePhase(opts.phase);
  opts.entities.group.visible = opts.phase === null;
  if (opts.banner) opts.banner.el.style.display = opts.phase === null ? '' : 'none';
  const groundReady = opts.phase === null || (opts.isGroundReady ?? true);
  syncSpaceTerrainOffset(opts.terrain, opts.phase !== null, opts.showTerrain && groundReady, opts.cameraTargetTile);
  if (opts.phase === null && wasActive) {
    opts.dayNightSync?.syncFrame();
    if (opts.terrain) {
      const look = resolveOnlinePlanetLook(opts.store.latest?.planet.type ?? 'temperate', opts.planetKind);
      try {
        applyPlanetLook(opts.viewport, look);
      } catch {
        /* Ignore in headless tests */
      }
    } else {
      applySpaceVoidBackground(opts.viewport.scene);
    }
    opts.focusTile(opts.cameraTargetTile.q, opts.cameraTargetTile.r, true);
    if (opts.store.latest) {
      opts.onView(opts.store.latest);
      opts.entities.update(0, opts.terrain);
    }
  }
  return Boolean(opts.terrain && groundReady);
}

export interface ViewOverlaySyncDeps {
  readonly view: ClientView;
  readonly status: PodDescentStatus;
  readonly hqReady: boolean;
  readonly entities: EntityMeshes;
  readonly terrain: HexTerrain | null;
  readonly showSpaceTerrain: boolean;
  readonly bootOverlay: BootOverlay | null;
  readonly hud: FeatureHud;
  readonly cam: RTSCamera | null;
  readonly landfall: LandfallController;
  readonly flags: ClientFlagsStore;
  readonly planetId: string;
  readonly fastStartLand: boolean;
  readonly loadMode?: ColonyLoadMode;
  readonly skipDescent: boolean;
  readonly fromSpaceDescent: boolean;
  readonly deferReveal?: boolean;
  readonly orbitalCameraDrop?: boolean;
  readonly sawPodDescending?: boolean;
  readonly cameraCentered: boolean;
  readonly colonyFramed: boolean;
  /** Returning-colony orbital arrival: hold the HUD until the camera drop finishes, then show it quietly. */
  readonly arrival: ArrivalHud;
  readonly sendLandOnce: () => void;
  readonly focusTile: (q: number, r: number, instant?: boolean) => void;
  readonly setCameraTargetTile: (q: number, r: number) => void;
  readonly setCameraCentered: (v: boolean) => void;
  readonly setColonyFramed: (v: boolean) => void;
}

export function syncSessionBootOverlayOnView(deps: ViewOverlaySyncDeps): void {
  const { status, view } = deps;
  if (deps.entities.podTouchdown.isSpacePhaseActive()) {
    deps.setCameraTargetTile(status.q, status.r);
    syncSpaceTerrainOffset(deps.terrain, true, deps.showSpaceTerrain, { q: status.q, r: status.r });
    deps.bootOverlay?.showDescent({ progress: status.progress, q: status.q, r: status.r, landed: true });
    deps.hud.setVisible(false);
    return;
  }

  if (deps.deferReveal) {
    deps.setCameraTargetTile(status.q, status.r);
    deps.hud.setVisible(false);
    return;
  }

  const mode: ColonyLoadMode = deps.loadMode ?? (deps.skipDescent ? 'instant' : 'pod');
  const isDirectOrInstant = mode === 'direct' || mode === 'instant';
  if (deps.bootOverlay) {
    if (status.descending && (isDirectOrInstant || (deps.fastStartLand && deps.entities.hasPodTouchedDown()))) {
      deps.sendLandOnce();
    }
    if (!deps.cameraCentered || (status.descending && mode === 'pod')) {
      deps.focusTile(status.q, status.r, true);
      deps.setCameraCentered(true);
    }
    if ((status.descending || !deps.hqReady) && mode === 'pod') {
      const landed = deps.fromSpaceDescent || deps.entities.hasPodTouchedDown();
      const td = deps.entities.podTouchdown.peekSurfaceState();
      const smoothProg = Math.max(status.progress, Math.min(1, td.elapsed / POD_TOUCHDOWN_DESCENT_S));
      deps.bootOverlay.showDescent({ progress: smoothProg, q: status.q, r: status.r, landed, planetType: view.planet.type });
      deps.hud.setVisible(false);
      return;
    }
    deps.bootOverlay.showColony(view.planet.id || deps.planetId || 'pl_dev');
    syncColonyArrival(deps, mode, status);
    return;
  }

  if (!deps.cameraCentered && deps.flags.set.has('W01')) {
    if (status.q !== 0 || status.r !== 0 || status.hqLanded || status.descending) {
      deps.focusTile(status.q, status.r, true);
      deps.setCameraCentered(true);
    }
  }
  const showHud = !((status.descending || !deps.hqReady) && mode === 'pod');
  if (showHud && (deps.arrival.hold || deps.arrival.quiet)) {
    releaseArrivalHud(deps.arrival, deps.landfall, deps.hud);
    return;
  }
  deps.hud.setVisible(showHud);
}

export function applySessionOrbitalReveal(opts: {
  readonly terrain: HexTerrain | null;
  readonly store: WorldStore;
  readonly planetKind: PlanetKind | null;
  readonly viewport: ColonyViewport;
  readonly dayNightSync: OnlineDayNightSync | null;
  readonly banner: ConnectionBanner | null;
  readonly hasBootResult: boolean;
  readonly isLocalHost: boolean;
  readonly bootOverlay: BootOverlay | null;
  readonly entities: EntityMeshes;
  readonly onView: (v: ClientView) => void;
}): void {
  if (opts.terrain) {
    const look = resolveOnlinePlanetLook(opts.store.latest?.planet.type ?? 'temperate', opts.planetKind);
    try {
      applyPlanetLook(opts.viewport, look);
    } catch {
      /* Ignore in headless tests */
    }
  }
  opts.dayNightSync?.syncFrame();
  if (opts.banner && opts.hasBootResult && !opts.isLocalHost) {
    opts.banner.el.style.display = '';
  }
  if (opts.store.latest) {
    opts.onView(opts.store.latest);
    opts.entities.update(0, opts.terrain);
  } else if (opts.bootOverlay) {
    opts.bootOverlay.splashEl.hidden = false;
    if (opts.bootOverlay.splashEl.dataset.error !== 'true') {
      opts.bootOverlay.showSplash('Linking to colony…');
    }
  }
}

export interface FrameHudSyncDeps {
  readonly now: number;
  readonly dt: number;
  readonly store: WorldStore;
  readonly entities: EntityMeshes;
  readonly dayNightSync: OnlineDayNightSync | null;
  readonly bootOverlay: BootOverlay | null;
  readonly hud: FeatureHud;
  readonly netStats: NetStatsBoard;
  readonly colonyIndex: number;
  readonly spawn: { readonly q: number; readonly r: number };
  readonly warp: number;
  readonly fastStartLand: boolean;
  readonly landSent: boolean;
  readonly hqDeployedSynced: boolean;
  readonly lastHudMs: number;
  readonly sendLandOnce: () => void;
  readonly onHqDeployedSync: (v: ClientView) => void;
  readonly setLastHudMs: (ms: number) => void;
}

export function syncSessionFrameHud(deps: FrameHudSyncDeps): void {
  const v = deps.store.latest;
  if (!v || deps.entities.podTouchdown.isSpacePhaseActive()) return;
  deps.dayNightSync?.syncFrame();
  if (deps.bootOverlay?.phase === 'descent' && !deps.bootOverlay.descentEl.hidden) {
    const status = extractPodDescentStatus(v, deps.colonyIndex, deps.spawn);
    if (deps.entities.hasPodTouchedDown()) {
      deps.bootOverlay.showDescent({ progress: status.progress, q: status.q, r: status.r, landed: true, planetType: v.planet.type });
    } else {
      const td = deps.entities.podTouchdown.computeState(status.descending, status.progress);
      const smoothProg = Math.max(status.progress, Math.min(1, td.elapsed / 1.75));
      deps.bootOverlay.updateDescent({ progress: smoothProg, q: status.q, r: status.r, planetType: v.planet.type });
    }
  }
  if (deps.fastStartLand && !deps.landSent && deps.entities.hasPodTouchedDown()) {
    if (extractPodDescentStatus(v, deps.colonyIndex, deps.spawn).descending) deps.sendLandOnce();
  }
  if (!deps.hqDeployedSynced && deps.entities.isHqDeployed()) {
    deps.onHqDeployedSync(v);
  }
  deps.hud.frame(
    { ...v, sim: { view: v, serverTick: deps.store.serverTickF(), predicting: deps.store.predictionMode === 'on' } },
    deps.dt,
  );
  if (deps.now - deps.lastHudMs > 250) {
    deps.setLastHudMs(deps.now);
    deps.hud.update({
      ...v,
      tiles: undefined,
      tick: v.tick,
      warp: deps.warp,
      net: deps.netStats.view(deps.store.predictionInfo),
    });
  }
}
