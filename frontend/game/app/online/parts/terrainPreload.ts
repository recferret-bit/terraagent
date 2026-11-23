import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { enqueueDeferredDispose } from '@terra/render/core/deferredDispose';
import { ArchetypeCatalog, LANDING_PREWARM_ARCHETYPES } from '@terra/render/kitbash';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { HexTerrain, PrecomputedHexTerrainData } from '@terra/render/planets/hex';
import { getSharedTerrainPrep } from '@terra/render/planets/prep';
import type { ClientTiles, ClientView } from '../../../store/replica/viewCodec';
import type { RTSCamera } from '../../RTSCamera';
import { prewarmAllGameplayShaders, type ShaderWarmupRig } from '../../shaderWarmupRig';
import { warmupSubtrees } from '../../warmup';
import type { EntityMeshes } from '../EntityMeshes';
import {
  applyTerrainTileChanges,
  resolveOnlinePlanetLook,
  syncOrRebuildSessionTerrain,
  syncSpaceTerrainOffset,
} from '../viewportHelper';

export interface TerrainPreloadState {
  terrain: HexTerrain | null;
  cam: RTSCamera | null;
  biomeKey: string;
  tiles: ClientTiles | null;
  rebuilt: boolean;
}

/** Detaches and defer-disposes any superseded `HexTerrain` / `RTSCamera` when an async or sync rebuild completes. */
export function retireReplacedSessionTerrain(opts: {
  viewport: ColonyViewport;
  prevTerrain: HexTerrain | null;
  nextTerrain: HexTerrain | null;
  prevCam: RTSCamera | null;
  nextCam: RTSCamera | null;
  rebuilt: boolean;
  inSpace: boolean;
  showSpaceTerrain: boolean;
  isGroundReady: boolean;
  cameraTargetTile: { q: number; r: number };
}): void {
  const { viewport, prevTerrain, nextTerrain, prevCam, nextCam, rebuilt, inSpace, showSpaceTerrain, isGroundReady, cameraTargetTile } = opts;
  if (prevTerrain && prevTerrain !== nextTerrain) {
    viewport.scene.remove(prevTerrain.group);
    if (prevTerrain.disposeDeferred) prevTerrain.disposeDeferred();
    else enqueueDeferredDispose(() => prevTerrain.dispose());
  }
  if (prevCam && prevCam !== nextCam) {
    prevCam.dispose();
  }
  if (rebuilt && inSpace && nextTerrain) {
    syncSpaceTerrainOffset(nextTerrain, true, showSpaceTerrain && isGroundReady, cameraTargetTile);
  }
}

export interface LiveTerrainSyncContext {
  readonly inSpace: boolean;
  readonly showSpaceTerrain: boolean;
  readonly deferLook: boolean;
  readonly cameraTargetTile: { q: number; r: number };
}

/**
 * Coordinates off-thread Web Worker `HexTerrain` preparation, progressive multi-frame chunk/prop assembly, kitbash
 * archetype pre-baking, and sliced GPU shader/VBO warm-up while the drop pod is airborne so mid-descent ground reveal
 * (`tn = 19s`) and surface retro handoff (`tn = 32s`) never drop or freeze frames.
 */
export class SessionTerrainPreloader {
  private readonly archetypeQueue: string[] = [...LANDING_PREWARM_ARCHETYPES];
  private pendingView: ClientView | null = null;
  private pendingTiles: ClientTiles | null = null;
  private workerJobSeq = 0;
  private warmSeq = 0;
  private inFlightKey: string | null = null;
  private gpuWarmState: 'idle' | 'warming' | 'ready' = 'idle';
  private biomeKey = 'forestRock';
  private activeWarmupRig: ShaderWarmupRig | null = null;
  private disposed = false;

  private disposeWarmupRig(): void {
    this.activeWarmupRig?.dispose();
    this.activeWarmupRig = null;
  }

  private kickoffGpuWarmup(vp: ColonyViewport, terrain: HexTerrain, entities: EntityMeshes, biomeKey: string): boolean {
    this.disposeWarmupRig();
    if (typeof (vp.renderer as { compile?: unknown }).compile !== 'function') {
      this.gpuWarmState = 'ready';
      return false;
    }
    this.gpuWarmState = 'warming';
    const warmId = ++this.warmSeq;
    const expectedTerrain = terrain;
    const rig = prewarmAllGameplayShaders(vp, vp.scene, biomeKey);
    this.activeWarmupRig = rig;
    const fxRoots = entities.prewarmLandingFx();
    const roots = [terrain.group, entities.group, ...fxRoots, ...rig.roots];
    void warmupSubtrees(vp, roots, () => this.disposed || warmId !== this.warmSeq || expectedTerrain.group.parent === null, 6)
      .then(() => {
        if (!this.disposed && warmId === this.warmSeq && this.gpuWarmState === 'warming') {
          this.gpuWarmState = 'ready';
        }
      })
      .finally(() => {
        rig.dispose();
        if (this.activeWarmupRig === rig) this.activeWarmupRig = null;
      });
    return true;
  }

  constructor(
    private readonly onAsyncBuilt: (res: TerrainPreloadState) => void,
    private readonly getLiveContext?: () => LiveTerrainSyncContext,
  ) {}

  isGpuReadyForGround(vp: ColonyViewport): boolean {
    if (typeof (vp.renderer as { compile?: unknown }).compile !== 'function') return true;
    return this.gpuWarmState === 'ready';
  }

  syncTiles(params: {
    viewport: ColonyViewport;
    prevTerrain: HexTerrain | null;
    prevTiles: ClientTiles | null;
    prevCam: RTSCamera | null;
    prevBiomeKey: string;
    view: ClientView;
    tiles: ClientTiles;
    planetKind: PlanetKind | null;
    inSpace: boolean;
    deferLook: boolean;
    showSpaceTerrain: boolean;
    cameraTargetTile: { q: number; r: number };
  }): TerrainPreloadState | null {
    const {
      viewport, prevTerrain, prevTiles, prevCam, prevBiomeKey,
      view, tiles, planetKind, inSpace, deferLook, showSpaceTerrain, cameraTargetTile,
    } = params;
    const look = resolveOnlinePlanetLook(view.planet.type, planetKind);
    this.biomeKey = look.biomeKey;
    const needsRebuild = !prevTerrain || prevTerrain.radius !== view.planet.radius || prevBiomeKey !== look.biomeKey;
    const canOffloadToWorker =
      needsRebuild &&
      (inSpace || deferLook) &&
      typeof Worker === 'function';

    if (!canOffloadToWorker) {
      this.pendingView = null;
      this.pendingTiles = null;
      this.inFlightKey = null;
      this.workerJobSeq++;
      const res = syncOrRebuildSessionTerrain({
        viewport,
        prevTerrain: needsRebuild ? null : prevTerrain,
        prevTiles: needsRebuild ? null : prevTiles,
        prevCam: needsRebuild ? null : prevCam,
        prevBiomeKey,
        view, tiles, planetKind, inSpace, showSpaceTerrain, deferLook, cameraTargetTile,
      });
      if (res.rebuilt) {
        this.warmSeq++;
        this.gpuWarmState = typeof (viewport.renderer as { compile?: unknown }).compile === 'function' ? 'idle' : 'ready';
      }
      return { ...res, tiles };
    }

    this.pendingView = view;
    this.pendingTiles = tiles;
    const jobKey = `${view.planet.radius}:${look.kind}:${look.seed}`;
    if (this.inFlightKey === jobKey) return null;
    this.inFlightKey = jobKey;
    const seq = ++this.workerJobSeq;

    const finishWorkerBuild = (precomputed?: PrecomputedHexTerrainData) => {
      if (this.disposed || seq !== this.workerJobSeq) return;
      this.inFlightKey = null;
      const latestView = this.pendingView ?? view;
      const latestTiles = this.pendingTiles ?? tiles;
      this.pendingView = null;
      this.pendingTiles = null;
      const live = this.getLiveContext?.() ?? { inSpace, showSpaceTerrain, deferLook, cameraTargetTile };
      const baseTiles = precomputed ? tiles : latestTiles;
      const built = syncOrRebuildSessionTerrain({
        viewport, prevTerrain: null, prevTiles: null, prevCam: null, prevBiomeKey,
        view: latestView, tiles: baseTiles, planetKind,
        inSpace: live.inSpace, showSpaceTerrain: live.showSpaceTerrain,
        deferLook: live.deferLook, cameraTargetTile: live.cameraTargetTile, precomputed, progressive: true,
      });
      if (precomputed && latestTiles !== tiles) {
        applyTerrainTileChanges(built.terrain, tiles, latestTiles, latestView.planet.radius);
      }
      this.warmSeq++;
      this.gpuWarmState = typeof (viewport.renderer as { compile?: unknown }).compile === 'function' ? 'idle' : 'ready';
      this.onAsyncBuilt({ ...built, tiles: latestTiles });
    };

    void getSharedTerrainPrep()
      .preloadHexTerrain(view.planet.radius, look.kind, look.seed, tiles)
      .then((precomputed) => finishWorkerBuild(precomputed))
      .catch(() => finishWorkerBuild(undefined));

    return null;
  }

  /** Advances frame-sliced kitbash prewarm, progressive chunk assembly, deferred entities, landing FX, and GPU upload. */
  stepAirborneFrame(vp: ColonyViewport, terrain: HexTerrain | null, entities: EntityMeshes, onIdleStep?: () => void): void {
    if (this.disposed) return;
    ArchetypeCatalog.prewarmStep(this.archetypeQueue, 1.0);
    const chunksDone = terrain ? terrain.stepProgressiveBuild(2.0) : false;
    const entitiesDone = entities.stepSpacePrewarm(terrain, 2);
    const fxDone = entities.stepLandingFxPrewarm();
    if (!terrain || !chunksDone || !entitiesDone || !fxDone) return;
    if (this.gpuWarmState === 'idle') {
      if (this.kickoffGpuWarmup(vp, terrain, entities, this.biomeKey)) return;
    }
    if (this.gpuWarmState === 'ready' && this.archetypeQueue.length === 0) {
      onIdleStep?.();
    }
  }

  /** Synchronously completes any pending worker terrain build, progressive chunks, and deferred entities on handoff/skip. */
  flushForSurface(params: {
    viewport: ColonyViewport;
    terrain: HexTerrain | null;
    tiles: ClientTiles | null;
    cam: RTSCamera | null;
    biomeKey: string;
    planetKind: PlanetKind | null;
    cameraTargetTile: { q: number; r: number };
    entities: EntityMeshes;
  }): TerrainPreloadState | null {
    const needsWarmup = this.gpuWarmState !== 'ready';
    this.biomeKey = params.biomeKey;
    this.workerJobSeq++;
    this.warmSeq++;
    this.disposeWarmupRig();
    this.inFlightKey = null;
    let out: TerrainPreloadState | null = null;
    if (this.pendingView && this.pendingTiles) {
      const v = this.pendingView;
      const t = this.pendingTiles;
      this.pendingView = null;
      this.pendingTiles = null;
      const built = syncOrRebuildSessionTerrain({
        viewport: params.viewport,
        prevTerrain: null,
        prevTiles: null,
        prevCam: null,
        prevBiomeKey: params.biomeKey,
        view: v,
        tiles: t,
        planetKind: params.planetKind,
        inSpace: false,
        showSpaceTerrain: true,
        deferLook: false,
        cameraTargetTile: params.cameraTargetTile,
      });
      out = { ...built, tiles: t };
    } else {
      this.pendingView = null;
      this.pendingTiles = null;
      params.terrain?.finishProgressiveBuild();
    }
    const activeTerrain = out ? out.terrain : params.terrain;
    activeTerrain?.finishProgressiveBuild();
    params.entities.flushSpacePrewarm(activeTerrain);
    params.entities.prewarmLandingFx();
    if (needsWarmup && activeTerrain && !this.disposed) {
      this.kickoffGpuWarmup(params.viewport, activeTerrain, params.entities, this.biomeKey);
    } else {
      this.gpuWarmState = 'ready';
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.workerJobSeq++;
    this.warmSeq++;
    this.disposeWarmupRig();
    this.inFlightKey = null;
    this.pendingView = null;
    this.pendingTiles = null;
    this.archetypeQueue.length = 0;
  }
}
