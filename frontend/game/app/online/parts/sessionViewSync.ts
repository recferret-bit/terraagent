import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import type { HexTerrain } from '@terra/render/planets/hex';
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
import type { PodLandingStateName } from '../PodTouchdownFx';
import { resolveOnlinePlanetLook, syncSpaceTerrainOffset } from '../viewportHelper';

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
  readonly focusTile: (q: number, r: number, instant?: boolean) => void;
  readonly onView: (v: ClientView) => void;
}): boolean {
  const wasActive = opts.entities.podTouchdown.isSpacePhaseActive();
  opts.entities.podTouchdown.setSpacePhase(opts.phase);
  opts.entities.group.visible = opts.phase === null;
  if (opts.banner) opts.banner.el.style.display = opts.phase === null ? '' : 'none';
  syncSpaceTerrainOffset(opts.terrain, opts.phase !== null, opts.showTerrain, opts.cameraTargetTile);
  if (opts.phase === null && wasActive) {
    if (opts.terrain) {
      const look = resolveOnlinePlanetLook(opts.store.latest?.planet.type ?? 'temperate', opts.planetKind);
      try {
        applyPlanetLook(opts.viewport, look);
      } catch {
        /* Ignore in headless tests */
      }
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
  readonly skipDescent: boolean;
  readonly fromSpaceDescent: boolean;
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

  if (deps.bootOverlay) {
    if (status.descending && deps.fastStartLand && (deps.skipDescent || deps.entities.hasPodTouchedDown())) {
      deps.sendLandOnce();
    }
    if (!deps.cameraCentered || status.descending) {
      deps.focusTile(status.q, status.r, true);
      deps.setCameraCentered(true);
    }
    if ((status.descending || !deps.hqReady) && !deps.skipDescent) {
      const landed = deps.fromSpaceDescent || deps.entities.hasPodTouchedDown();
      deps.bootOverlay.showDescent({ progress: status.progress, q: status.q, r: status.r, landed });
      deps.hud.setVisible(false);
      return;
    }
    deps.bootOverlay.showColony(view.planet.id || deps.planetId || 'pl_dev');
    deps.hud.setVisible(true);
    if (!deps.colonyFramed && deps.cam && deps.entities.ownHqObject()) {
      deps.setColonyFramed(true);
      deps.focusTile(status.q, status.r, true);
      deps.landfall.selectHq();
      deps.cam?.follow(deps.entities.ownHqObject());
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
  if (deps.bootOverlay?.phase === 'descent' && deps.entities.hasPodTouchedDown() && !deps.bootOverlay.descentEl.hidden) {
    const status = extractPodDescentStatus(v, deps.colonyIndex, deps.spawn);
    deps.bootOverlay.showDescent({ progress: status.progress, q: status.q, r: status.r, landed: true });
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
