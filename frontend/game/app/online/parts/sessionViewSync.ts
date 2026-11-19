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
import { resolveOnlinePlanetLook, syncSpaceTerrainOffset } from '../viewportHelper';

const tmpHqPos = new THREE.Vector3();

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
  syncSpaceTerrainOffset(opts.terrain, opts.phase !== null, opts.showTerrain, opts.cameraTargetTile);
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
      if (opts.viewport.scene.background instanceof THREE.Color) opts.viewport.scene.background.setHex(0x03060c);
      else opts.viewport.scene.background = new THREE.Color(0x03060c);
      if (opts.viewport.scene.fog instanceof THREE.FogExp2) opts.viewport.scene.fog.color.setHex(0x03060c);
    }
    opts.focusTile(opts.cameraTargetTile.q, opts.cameraTargetTile.r, true);
    if (opts.store.latest) {
      opts.onView(opts.store.latest);
      opts.entities.update(0, opts.terrain);
    }
  }
  return Boolean(opts.terrain);
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
    deps.hud.setVisible(true);
    const hqObj = deps.entities.ownHqObject();
    if (!deps.colonyFramed && deps.cam) {
      deps.setColonyFramed(true);
      deps.focusTile(status.q, status.r, true);
      if (hqObj) {
        deps.landfall.selectHq();
        deps.cam.follow(hqObj);
      }
      if (mode === 'direct' && deps.orbitalCameraDrop && !deps.sawPodDescending) {
        if (hqObj) {
          const pos = hqObj.getWorldPosition(tmpHqPos);
          deps.cam.startOrbitalDrop(pos, { duration: 1.55, followObj: hqObj });
        } else {
          const [tx, tz] = tileXZ(status.q, status.r);
          const ty = deps.terrain ? deps.terrain.heightAt(tx, tz) : 0;
          deps.cam.startOrbitalDrop(tmpHqPos.set(tx, ty, tz), { duration: 1.55, followObj: null });
        }
      }
    } else if (deps.cam && hqObj && !deps.cam.followTarget) {
      deps.landfall.selectHq();
      deps.cam.follow(hqObj);
    }
    return;
  }

  if (!deps.cameraCentered && deps.flags.set.has('W01')) {
    if (status.q !== 0 || status.r !== 0 || status.hqLanded || status.descending) {
      deps.focusTile(status.q, status.r, true);
      deps.setCameraCentered(true);
    }
  }
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
