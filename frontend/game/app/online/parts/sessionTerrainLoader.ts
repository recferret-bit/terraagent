import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import {
  BiomeWorkerClient,
  buildBiomeOrchestratorConfig,
  serializeBiomeOrchestratorConfig,
  type BiomeGeneratedPayload,
  type BiomeWorkerLike,
  type BugsOrchestrator,
  type BuildingsOrchestrator,
  type UnitsOrchestrator,
} from '@terra/render/orchestrators';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { HexTerrain } from '@terra/render/planets/hex';
import type { ClientTiles, ClientView } from '../../../store/replica/viewCodec';
import type { RTSCamera } from '../../RTSCamera';
import {
  applyTerrainTileChanges,
  needsSessionTerrainRebuild,
  resolveOnlinePlanetLook,
  syncOrRebuildSessionTerrain,
} from '../viewportHelper';

export interface SessionTerrainHost {
  readonly viewport: ColonyViewport;
  terrain: HexTerrain | null;
  cam: RTSCamera | null;
  readonly planetKind: PlanetKind | null;
  getPlanetSeed(): string | number | null | undefined;
  getBiomeKey(): string;
  setBiomeKey(k: string): void;
  getTiles(): ClientTiles | null;
  setTiles(t: ClientTiles): void;
  isInSpace(): boolean;
  getShowSpaceTerrain(): boolean;
  getDeferReveal(): boolean;
  getCameraTargetTile(): { q: number; r: number };
  getBugsOrchestrator?(): BugsOrchestrator | undefined;
  getBuildingsOrchestrator?(): BuildingsOrchestrator | undefined;
  getUnitsOrchestrator?(): UnitsOrchestrator | undefined;
  prewarmEntityBiome?(biomeKey: string): void;
  onTerrainMounted(latestView: ClientView): void;
}

/**
 * Coordinates off-main-thread Worker generation (`biome.worker.ts`) for `OnlineSession` planet loads:
 * - Initial planet load / planet switch serializes the `BiomeOrchestrator` JSON config and generates
 *   terrain chunks, trees, ground objects, resources, habitat anchors, birds, and animals in a Worker thread.
 * - Subsequent tile deltas apply incrementally in-place on the pooled orchestrators.
 */
export class SessionTerrainLoader {
  private readonly workerClient: BiomeWorkerClient;
  private seq = 0;
  private inFlightKey: string | null = null;
  private pending: { initialView: ClientView; initialTiles: ClientTiles; latestView: ClientView; latestTiles: ClientTiles } | null = null;
  private disposed = false;

  constructor(
    private readonly host: SessionTerrainHost,
    makeWorker?: () => BiomeWorkerLike,
  ) {
    this.workerClient = new BiomeWorkerClient(makeWorker);
  }

  get isLoadingInWorker(): boolean {
    return this.pending !== null;
  }

  onTiles(view: ClientView, tiles: ClientTiles): void {
    if (this.disposed) return;
    const look = resolveOnlinePlanetLook(view.planet.type, this.host.planetKind, view.planet.seed ?? this.host.getPlanetSeed());
    const loadKey = `${view.planet.id}:${view.planet.radius}:${look.kind}:${look.seed}`;
    const needsRebuild = needsSessionTerrainRebuild(
      this.host.terrain,
      view.planet.radius,
      this.host.getBiomeKey(),
      look,
    );

    if (!needsRebuild && this.host.terrain) {
      this.pending = null;
      this.inFlightKey = null;
      const prevTiles = this.host.getTiles();
      if (prevTiles) applyTerrainTileChanges(this.host.terrain, prevTiles, tiles, view.planet.radius);
      this.host.setTiles(tiles);
      return;
    }

    if (this.pending && this.inFlightKey === loadKey) {
      this.pending.latestView = view;
      this.pending.latestTiles = tiles;
      return;
    }

    const reqSeq = ++this.seq;
    this.inFlightKey = loadKey;
    this.pending = { initialView: view, initialTiles: tiles, latestView: view, latestTiles: tiles };
    const jsonConfig = serializeBiomeOrchestratorConfig(buildBiomeOrchestratorConfig(look, view.planet.radius));
    void this.workerClient
      .generate(jsonConfig, tiles)
      .then((payload) => {
        if (this.disposed || reqSeq !== this.seq || !this.pending) return;
        const state = this.pending;
        this.pending = null;
        this.inFlightKey = null;
        this.mount(state.initialView, state.initialTiles, payload, state.latestView, state.latestTiles);
      })
      .catch(() => {
        if (this.disposed || reqSeq !== this.seq || !this.pending) return;
        const state = this.pending;
        this.pending = null;
        this.inFlightKey = null;
        this.mount(state.latestView, state.latestTiles);
      });
  }

  /** Synchronously mounts pending tiles if a caller skips descent before the Worker finishes. */
  flushPendingSync(): void {
    if (this.disposed || !this.pending) return;
    const { latestView, latestTiles } = this.pending;
    this.seq++;
    this.pending = null;
    this.inFlightKey = null;
    this.mount(latestView, latestTiles);
  }

  private mount(
    view: ClientView,
    tiles: ClientTiles,
    pregenerated?: BiomeGeneratedPayload,
    latestView: ClientView = view,
    latestTiles: ClientTiles = tiles,
  ): void {
    const res = syncOrRebuildSessionTerrain({
      viewport: this.host.viewport,
      prevTerrain: this.host.terrain,
      prevTiles: this.host.getTiles(),
      prevCam: this.host.cam,
      prevBiomeKey: this.host.getBiomeKey(),
      view,
      tiles,
      planetKind: this.host.planetKind,
      planetSeed: view.planet.seed ?? this.host.getPlanetSeed(),
      inSpace: this.host.isInSpace(),
      showSpaceTerrain: this.host.getShowSpaceTerrain(),
      deferLook: this.host.getDeferReveal(),
      cameraTargetTile: this.host.getCameraTargetTile(),
      bugsOrchestrator: this.host.getBugsOrchestrator?.(),
      buildingsOrchestrator: this.host.getBuildingsOrchestrator?.(),
      unitsOrchestrator: this.host.getUnitsOrchestrator?.(),
      onBiomePrewarm: (biomeKey) => this.host.prewarmEntityBiome?.(biomeKey),
      pregenerated,
    });
    if (latestTiles !== tiles) {
      applyTerrainTileChanges(res.terrain, tiles, latestTiles, latestView.planet.radius);
    }
    this.host.terrain = res.terrain;
    this.host.cam = res.cam;
    this.host.setBiomeKey(res.biomeKey);
    this.host.setTiles(latestTiles);
    this.host.onTerrainMounted(latestView);
  }

  dispose(): void {
    this.disposed = true;
    this.seq++;
    this.pending = null;
    this.inFlightKey = null;
    this.workerClient.dispose();
  }
}

export function createSessionTerrainLoader(host: SessionTerrainHost): SessionTerrainLoader {
  return new SessionTerrainLoader(host);
}

export function bindSessionTerrainLoader(
  session: {
    readonly viewport: ColonyViewport;
    terrain: HexTerrain | null;
    cam: RTSCamera | null;
    readonly planetKind: PlanetKind | null;
    readonly entities?: {
      readonly bugsOrchestrator: BugsOrchestrator;
      readonly buildingsOrchestrator: BuildingsOrchestrator;
      readonly unitsOrchestrator: UnitsOrchestrator;
      prewarmForBiome(biomeKey: string): void;
    };
  },
  hooks: Omit<SessionTerrainHost, 'viewport' | 'terrain' | 'cam' | 'planetKind'>,
): SessionTerrainLoader {
  return new SessionTerrainLoader({
    get viewport() { return session.viewport; },
    get terrain() { return session.terrain; },
    set terrain(t) { session.terrain = t; },
    get cam() { return session.cam; },
    set cam(c) { session.cam = c; },
    get planetKind() { return session.planetKind; },
    getBugsOrchestrator: () => session.entities?.bugsOrchestrator,
    getBuildingsOrchestrator: () => session.entities?.buildingsOrchestrator,
    getUnitsOrchestrator: () => session.entities?.unitsOrchestrator,
    prewarmEntityBiome: (k) => session.entities?.prewarmForBiome(k),
    ...hooks,
  });
}
