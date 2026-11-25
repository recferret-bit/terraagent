import { InsectSwarmRenderer } from '@terra/render/animation/insects/InsectSwarmRenderer';
import { InsectCorpseLayer } from '@terra/render/combat/InsectCorpseLayer';
import { WreckageLayer } from '@terra/render/combat/WreckageLayer';
import type { EntityMeshRecord } from './EntityMeshRecord';
export type { EntityMeshRecord } from './EntityMeshRecord';
import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { syncExtractorAppearance } from './extractorAppearance';
import { updateSelectionPulse } from './selectionPulse';
import { getWindUniforms } from '@terra/render/core/windConfig';
import { rotorClockRate } from '@terra/render/core/rotorSpeed';
import { computeSolarState, getDayNightParams, isDayNightOn, isSceneInDescent } from '@terra/render/core/dayNightConfig';
import { createArchetypeMesh, setArchetypeBuildProgress, tickArchetypeMesh } from '@terra/render/kitbash';
import { GridCableRenderer } from '@terra/render/lighting/gridCables';
import { BugsOrchestrator, BuildingsOrchestrator, buildBuildingsOrchestratorConfig, buildUnitsOrchestratorConfig, UnitsOrchestrator } from '@terra/render/orchestrators';
import type { PoolStats } from '@terra/render/pools';
import { WorkParticleSystem } from '@terra/render/particles';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE, TICK_MS, type CompiledDataLike } from '@terra/sim';
import { createMapVisibility } from '../../maps/visibility';
import { forEachEntity, type ClientTiles, type ClientView, type EntityRow } from '../../store/replica/viewCodec';
import { PrestigeDressing } from '../prestige/PrestigeDressing';
import { resolveEntityActivityProgress } from '../../features/landfall/selectionHelpers';
import { syncEntityShadowCaster } from './entityFocus';
import { MotionTrack, RenderClock } from '@terra/render/motion/entityMotion';
import { resetColonyVisionAndLights, syncEntitiesVisionAndForeignVisibility } from './entityVisionSync';
import { POD_EGRESS_DIR, POD_EGRESS_YAW, POD_LAND_OFFSET_M } from './PodImpactRig';
import { derivePowerCableSpans } from './powerCableSpans';
import { PodTouchdownFx, type PodTouchdownState } from './PodTouchdownFx';
import { UnitHealthBars } from './unitHealthBars';
import { syncBiosphereAggressors } from './biosphereAggressorSync';
import { CombatSyncController } from './combatSync';
import { EntityDeathCoordinator } from './parts/entityDeaths';
import { pickEntityAtViewport, type EntityAwareHexPick } from './parts/entityPicking';
import { syncEntityTargetSelection, TargetSelectionMarkers } from './parts/targetSelectionMarkers';
import { RadarFogShadows } from './parts/radarFogShadows';
import { SelectionRingPool, alignGroundRingToTerrain } from './parts/selectionRings';
import { archetypeForKind, entityWorldXZ, isConstructibleBuilding, isTrackedWalkingUnitKind } from './entityKinds';
import { applyEntityTerrainPose, findOwnedPodMesh, makeGroundRing, placeMeshOnTrack, planetKindForBiome, stepPodTouchdownForEntries, stepTargetMarker } from './parts/entityMarkers';
import { acquirePooledEntityMesh, collectEntityPoolStats, computeEntityMeshVisible, normalizeEntityBiomeKey, releasePooledEntityMesh, resetEntitiesOnPlanetSwitch, switchAndPrewarmEntityBiome } from './parts/entityPoolRouter';
import { buildActiveWorkSites, computeWorkTarget, entityGroundY, hubBuildProgressForState } from './workTargetResolver';

export { entityWorldXZ, archetypeForKind };

/**
 * How fast the drawn mesh follows its interpolated pose (1/s). Ordinary walking is followed within ~50 ms; a correction
 * (a rejected prediction, a late ack, an admin teleport) becomes a short glide instead of a snap.
 */
const FOLLOW_PER_S = 20;

/** Rejections the client's own sim cannot predict (decided by the host or the network): the predicted walk was wrong. */
const UNPREDICTABLE_REJECTS: ReadonlySet<string> = new Set([
  'rate_limited', 'timeout', 'not_connected', 'host_unavailable', 'internal', 'unknown_kind', 'wave_disabled',
  'colony_inactive', 'planet_ended', 'not_own_colony',
]);

export type MeshFactory = (archetypeId: string, biomeKey: string) => THREE.Object3D;

/** Online entity meshes: interpolated axial pose, walk/work weights, selection rings, and the drop-pod touchdown. */
export class EntityMeshes {
  readonly group = new THREE.Group();
  readonly buildingsOrchestrator: BuildingsOrchestrator;
  readonly unitsOrchestrator: UnitsOrchestrator;
  readonly bugsOrchestrator: BugsOrchestrator;
  private readonly swarms = new InsectSwarmRenderer(this.group);
  readonly selectionRing: THREE.Mesh;
  private readonly selectionRings: SelectionRingPool;
  readonly targetMarker: THREE.Mesh;
  readonly targetSelection: TargetSelectionMarkers;
  readonly podTouchdown: PodTouchdownFx;
  readonly healthBars: UnitHealthBars;
  readonly workParticles: WorkParticleSystem;
  readonly combatSync: CombatSyncController;
  readonly corpses: InsectCorpseLayer;
  readonly wrecks: WreckageLayer;
  readonly deaths: EntityDeathCoordinator;
  /** Grid cables + lightning between the Hub, pylons and attached buildings (`powerCableSpans.ts`). */
  readonly gridCables: GridCableRenderer;
  /** Shapeless 3D radar echo shadows visible through Fog of War (`parts/radarFogShadows.ts`). */
  readonly radarShadows: RadarFogShadows;
  isW10Enabled: () => boolean = () => true;
  /** W28-12 staking prestige: HQ uplink beam, dish, gold trim and cyan cutters (off until the session enables it). */
  readonly prestige = new PrestigeDressing();
  private readonly entries = new Map<number, EntityMeshRecord>();
  private readonly deferredSpaceRows = new Map<number, EntityRow>();
  private selectedEntityId: number | null = null;
  private selectedLandfallIds: number[] = [];
  private selectedUnitIds: number[] = [];
  private optimisticTargets: ReadonlyMap<number, number> = new Map();
  private ownerColonyIndex = 0;
  private spectatorAllVision = false;
  private fullVision = false;
  private markerT = 99;
  private markerTile: { q: number; r: number } | null = null;
  private time = 0;
  private windTime = 0;
  private biomeKey = 'forestRock';
  private prewarmedBiomeKey: string | null = null;
  private currentPlanetId: string | null = null;
  private latestTiles: ClientTiles | null = null;
  private latestView: ClientView | null = null;
  private lastTerrain: HexTerrain | null = null;
  private hasTerrain = false;
  private simData?: CompiledDataLike;
  private isTileVisible: ((q: number, r: number) => boolean) | null = null;
  private clock = new RenderClock(TICK_MS / 1000);
  private dropPredictedFuture = false;
  /** Called with the largest pose correction (tiles) of a view that moved an already drawn sample (dev net stats). */
  onCorrection: ((tiles: number) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly makeMesh: MeshFactory = (id, biome) => createArchetypeMesh(id, biome),
    playPodTouchdown = false,
    deferPodRig = false,
  ) {
    this.group.name = 'online-entities';
    this.scene.add(this.group);
    const factory: MeshFactory = (id, biome) => this.makeMesh(id, biome);
    this.buildingsOrchestrator = new BuildingsOrchestrator(this.group, JSON.stringify(buildBuildingsOrchestratorConfig(this.biomeKey, { stripConstructiblePlinths: true })), factory);
    this.unitsOrchestrator = new UnitsOrchestrator(this.group, JSON.stringify(buildUnitsOrchestratorConfig(this.biomeKey)), factory);
    this.bugsOrchestrator = new BugsOrchestrator(this.group, JSON.stringify({ biomeKey: this.biomeKey }), factory);
    this.podTouchdown = new PodTouchdownFx(this.scene, playPodTouchdown, undefined, deferPodRig);
    this.healthBars = new UnitHealthBars(this.scene);
    this.workParticles = new WorkParticleSystem(this.scene);
    this.combatSync = new CombatSyncController(this.scene);
    this.combatSync.meshForEntity = id => this.entries.get(id)?.mesh;
    this.corpses = new InsectCorpseLayer(this.scene, this.biomeKey);
    this.wrecks = new WreckageLayer(this.scene, this.biomeKey);
    this.deaths = new EntityDeathCoordinator(this.wrecks, this.combatSync, this.entries);
    this.combatSync.onEntityDestroyed = (id, kind) => this.deaths.onConfirmedDestruction(id, kind, this.lastTerrain);
    this.combatSync.onEntityRevived = (id) => this.deaths.onRevived(id);
    this.gridCables = new GridCableRenderer(this.scene);
    this.radarShadows = new RadarFogShadows(this.scene);
    this.selectionRing = makeGroundRing(0.75, 0.95, 0xff6a13, 'selection-ring');
    this.scene.add(this.selectionRing);
    this.selectionRings = new SelectionRingPool(this.scene, this.selectionRing);
    this.targetMarker = makeGroundRing(0.55, 0.75, 0x00f0ff, 'target-marker');
    this.scene.add(this.targetMarker);
    this.targetSelection = new TargetSelectionMarkers(this.scene);
  }

  get count(): number { return this.entries.size; }

  /** Rendered (interpolated) mesh of the owned HQ, for camera following. */
  ownHqObject(): THREE.Object3D | null {
    for (const r of this.entries.values()) if (r.kind === ENTITY_KIND.hq && r.owner === this.ownerColonyIndex) return r.mesh;
    return null;
  }

  getRecord(entityId: number): EntityMeshRecord | undefined { return this.entries.get(entityId); }
  hasPodTouchedDown(): boolean { return this.podTouchdown.hasTouchedDown(); }
  isHqDeployed(): boolean { return this.podTouchdown.isHqDeployed(); }
  getCameraShake(): number { return this.podTouchdown.getCameraShake(); }

  setOwnerColonyIndex(colonyIndex: number): void {
    if (this.ownerColonyIndex === colonyIndex) return;
    this.ownerColonyIndex = colonyIndex;
    this.healthBars.setOwnColonyIndex(colonyIndex);
    this.refreshVision(); this.updateSelectionRing();
  }
  setSpectatorAllVision(on: boolean): void {
    if (this.spectatorAllVision !== on) { this.spectatorAllVision = on; this.refreshVision(); }
  }
  setFullVision(on: boolean): void {
    if (this.fullVision !== on) { this.fullVision = on; this.refreshVision(); }
  }
  private refreshVision(): void {
    const td = this.podTouchdown.computeState(false, 1);
    if (!this.latestView) {
      for (const rec of this.entries.values()) rec.mesh.visible = this.computeMeshVisible(rec.kind, rec.owner, rec.state, td);
      this.syncVisionAndForeignVisibility(this.lastTerrain, td);
      return;
    }
    this.isTileVisible = createMapVisibility({ simData: this.simData, clientView: this.latestView, tiles: this.latestTiles, radius: this.latestView.planet.radius, ownColonySlot: this.ownerColonyIndex, spectatorAllVision: this.spectatorAllVision, fullVision: this.fullVision });
    this.syncVisionAndForeignVisibility(this.lastTerrain, td);
    this.radarShadows.sync(this.entries.values(), this.latestView, this.lastTerrain, this.ownerColonyIndex, this.spectatorAllVision || this.fullVision, this.time);
    const ground = this.lastTerrain ? (x: number, z: number) => this.lastTerrain!.heightAt(x, z) : undefined;
    this.gridCables.setSpans(derivePowerCableSpans(this.entries.values(), this.latestView, this.ownerColonyIndex), ground);
  }

  private collectSelectedIdSet(): Set<number> {
    const set = new Set<number>(this.selectedLandfallIds);
    if (this.selectedEntityId !== null) set.add(this.selectedEntityId);
    for (const id of this.selectedUnitIds) set.add(id);
    return set;
  }

  setSelectedEntityId(entityId: number | null): void {
    this.selectedEntityId = entityId;
    this.selectedLandfallIds = entityId !== null ? [entityId] : [];
    this.healthBars.setSelectedEntityIds(this.collectSelectedIdSet()); this.updateSelectionRing();
  }
  setSelectedEntityIds(ids: readonly number[]): void {
    this.selectedLandfallIds = [...ids];
    this.selectedEntityId = ids.length > 0 ? ids[ids.length - 1]! : null;
    this.healthBars.setSelectedEntityIds(this.collectSelectedIdSet()); this.updateSelectionRing();
  }
  setSelectedUnitIds(ids: readonly number[], optimisticTargets?: ReadonlyMap<number, number>): void {
    this.selectedUnitIds = [...ids];
    this.optimisticTargets = optimisticTargets ?? new Map();
    this.healthBars.setSelectedEntityIds(this.collectSelectedIdSet()); this.updateSelectionRing();
  }
  pickAtViewport(vp: ColonyViewport, terrain: HexTerrain | null, cx: number, cy: number): EntityAwareHexPick | null { return pickEntityAtViewport(this.entries.values(), (id) => this.deaths.isWrecked(id), terrain, vp, cx, cy); }
  getSelectedEntityId(): number | null { return this.selectedEntityId; }

  flashTarget(q: number, r: number, terrain: HexTerrain | null = null, color = 0x00f0ff): void {
    const [wx, wz] = tileXZ(q, r);
    const wy = terrain ? terrain.heightAt(wx, wz) : 0;
    (this.targetMarker.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.targetMarker.position.set(wx, wy + 0.08, wz);
    alignGroundRingToTerrain(this.targetMarker, terrain, wx, wz);
    this.targetMarker.scale.setScalar(1); this.targetMarker.visible = true;
    this.markerTile = { q, r }; this.markerT = 0;
  }

  private computeMeshVisible(kind: number, owner: number, state: number, tdState: PodTouchdownState, wx?: number, wz?: number): boolean {
    return computeEntityMeshVisible(kind, owner, state, this.ownerColonyIndex, this.hasTerrain, this.isW10Enabled(), tdState, wx, wz, this.spectatorAllVision, this.fullVision);
  }

  /**
   * A command was rejected. If the client's sim could not have known (`UNPREDICTABLE_REJECTS`), the poses it predicted
   * past the next view's tick are wrong and are dropped then; otherwise the prediction already rejected it too.
   */
  discardPrediction(code?: string): void {
    if (code === undefined || UNPREDICTABLE_REJECTS.has(code)) this.dropPredictedFuture = true;
  }

  /** Prewarms building, unit, and bug pools once for the active planet biome and prunes any stale biome pools. */
  prewarmForBiome(biomeKey: string): void {
    const target = normalizeEntityBiomeKey(biomeKey, undefined, this.biomeKey);
    if (this.prewarmedBiomeKey === target && this.biomeKey === target) return;
    this.biomeKey = target;
    this.prewarmedBiomeKey = target;
    this.corpses.setBiome(target);
    this.wrecks.setBiome(target);
    switchAndPrewarmEntityBiome(this, this.entries, this.combatSync, target);
  }

  poolStats(): { buildings: PoolStats[]; units: PoolStats[]; bugs: PoolStats[] } {
    return collectEntityPoolStats(this);
  }

  /**
   * `confirmedTick`: the newest server-confirmed tick. The render clock follows it, not the view's tick (which runs
   * ahead while a command is predicted), so walking speed never changes with prediction. Defaults to the view's tick.
   */
  syncView(view: ClientView, terrain: HexTerrain | null, biomeKey?: string, confirmedTick = view.tick, data?: CompiledDataLike): void {
    this.simData = data;
    const nextPlanetId = view.planet?.id ?? null;
    if (this.currentPlanetId !== null && nextPlanetId !== null && nextPlanetId !== this.currentPlanetId) {
      resetEntitiesOnPlanetSwitch(this, this.entries, this.combatSync);
      this.corpses.clear(); this.wrecks.clear(); this.deaths.clear();
      this.combatSync.reset();
      this.clock = new RenderClock(TICK_MS / 1000);
    }
    if (nextPlanetId !== null) this.currentPlanetId = nextPlanetId;
    this.prewarmForBiome(normalizeEntityBiomeKey(biomeKey, view.planet?.type, this.prewarmedBiomeKey ?? this.biomeKey));
    this.latestView = view;
    this.lastTerrain = terrain;
    if (view.tiles) this.latestTiles = view.tiles;
    this.isTileVisible = createMapVisibility({
      simData: data, clientView: view, tiles: this.latestTiles, radius: view.planet.radius,
      ownColonySlot: this.ownerColonyIndex, spectatorAllVision: this.spectatorAllVision, fullVision: this.fullVision,
    });
    this.hasTerrain = Boolean(terrain);
    this.clock.observe(Math.min(confirmedTick, view.tick));
    const seen = new Set<number>();

    let ownedPodId: number | null = null, ownedPodDescending = false, ownedPodProgress = 1;
    forEachEntity(view.entities, view.count, (e) => {
      if (e.kind === ENTITY_KIND.pod && e.owner === this.ownerColonyIndex && (ownedPodId === null || e.state === ENTITY_STATE.descending || e.id > ownedPodId)) {
        ownedPodId = e.id; ownedPodDescending = e.state === ENTITY_STATE.descending; ownedPodProgress = e.progress;
      }
    });
    const tdState = this.podTouchdown.computeState(ownedPodDescending, ownedPodProgress, ownedPodId);
    const deferForeign = this.podTouchdown.isSpacePhaseActive() && typeof requestAnimationFrame === 'function';
    if (!deferForeign && this.deferredSpaceRows.size > 0) this.deferredSpaceRows.clear();

    let correction = 0;
    forEachEntity(view.entities, view.count, (e) => {
      seen.add(e.id);
      if (deferForeign && !this.entries.has(e.id) && e.owner !== this.ownerColonyIndex) {
        this.deferredSpaceRows.set(e.id, { ...e });
        return;
      }
      this.deferredSpaceRows.delete(e.id);
      correction = Math.max(correction, this.upsertEntity(e, terrain, tdState, view.tick, view));
      syncExtractorAppearance(this.entries.get(e.id)?.mesh, e, view);
      const mesh = this.entries.get(e.id)?.mesh;
      if (mesh) this.combatSync.battle.insects.track(e.id, mesh, e.hp, e.state === ENTITY_STATE.moving);
    });
    if (correction > 0) this.onCorrection?.(correction);
    for (const id of [...this.deferredSpaceRows.keys()]) {
      if (!seen.has(id)) this.deferredSpaceRows.delete(id);
    }

    for (const [id, rec] of [...this.entries]) {
      if (seen.has(id)) continue;
      this.deaths.onMeshRemovedFromView(rec, terrain, this.time);
      const retiredMesh = rec.mesh;
      const retiredArchetype = rec.archetypeId;
      const deadConfirmed = rec.hp <= 0 || this.combatSync.confirmedDeaths.has(id);
      const release = () => {
        if (deadConfirmed || this.combatSync.confirmedDeaths.has(id)) {
          const rx = retiredMesh.position.x, rz = retiredMesh.position.z, gy = terrain ? terrain.heightAt(rx, rz) : retiredMesh.position.y;
          const cy = Math.cos(retiredMesh.rotation.y), sy = Math.sin(retiredMesh.rotation.y);
          const off = terrain ? (lx: number, lz: number) => terrain.heightAt(rx + lx * cy + lz * sy, rz - lx * sy + lz * cy) - gy : undefined;
          this.corpses.preserve(retiredMesh, gy, off);
        }
        this.releaseEntityMesh(id, retiredArchetype, retiredMesh);
      };
      if (!this.combatSync.battle.insects.retire(id, release, deadConfirmed)) release();
      this.entries.delete(id);
    }
    if (this.dropPredictedFuture) {
      this.dropPredictedFuture = false;
      for (const rec of this.entries.values()) rec.track.dropAfter(view.tick);
    }
    this.syncVisionAndForeignVisibility(terrain, tdState);
    const alive = [...this.entries.values()].filter(r => !this.deaths.isWrecked(r.id));
    this.radarShadows.sync(alive, view, terrain, this.ownerColonyIndex, this.spectatorAllVision || this.fullVision, this.time);
    this.prestige.sync(view, this.entries.values());
    this.swarms.sync(this.biomeKey);
    this.healthBars.sync(alive);
    this.combatSync.syncView(view, terrain);
    this.deaths.syncViewWrecks(view.blobs);
    this.updateSelectionRing();
    const ground = terrain ? (x: number, z: number) => terrain.heightAt(x, z) : undefined;
    this.gridCables.setSpans(derivePowerCableSpans(alive, view, this.ownerColonyIndex), ground);
  }

  private syncVisionAndForeignVisibility(terrain: HexTerrain | null, tdState: PodTouchdownState): void {
    syncEntitiesVisionAndForeignVisibility({
      data: this.simData, entries: this.entries, ownerColonyIndex: this.ownerColonyIndex,
      terrain, hasTerrain: this.hasTerrain, tiles: this.latestTiles,
      colonyActive: !this.podTouchdown.isSpacePhaseActive() && !isSceneInDescent(this.scene),
      spectatorAllVision: this.spectatorAllVision, fullVision: this.fullVision, isTileVisible: this.isTileVisible,
      isMeshVisible: (rec) => !this.deaths.isWrecked(rec.id) && this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState),
    });
  }

  /** Returns how far (tiles) this view moved the entity's sample at `tick` (0: a new sample). */
  private upsertEntity(e: EntityRow, terrain: HexTerrain | null, tdState: PodTouchdownState, tick: number, view?: ClientView): number {
    const { id, kind, owner, q, r, x, y, rot, hp, hpMax, state, progress } = e;
    const activeProg = resolveEntityActivityProgress(e, view);
    const barProgress = activeProg > 0 && activeProg < 1 ? activeProg : progress;
    const [tileWx, tileWz] = entityWorldXZ(kind, x, y);
    const isOwnedPod = kind === ENTITY_KIND.pod && owner === this.ownerColonyIndex;
    const wx = isOwnedPod ? tileWx - POD_EGRESS_DIR.x * POD_LAND_OFFSET_M : tileWx;
    const wz = isOwnedPod ? tileWz - POD_EGRESS_DIR.z * POD_LAND_OFFSET_M : tileWz;
    const baseWy = entityGroundY(terrain, kind, q, r, wx, wz);
    const wy = baseWy + (isOwnedPod ? tdState.podLift : 0);
    const yaw = isOwnedPod ? POD_EGRESS_YAW : Math.PI / 2 - rot;
    const buildProg = isConstructibleBuilding(kind) ? hubBuildProgressForState(state, progress) : 1;
    const visible = !this.deaths.isWrecked(id) && this.computeMeshVisible(kind, owner, state, tdState);
    const isDaylight = !isDayNightOn() || computeSolarState(getDayNightParams()).daylight > 0.05;
    const tier = e.tier === 2 || e.tier === 3 ? e.tier : e.tier === 1 ? 1 : undefined;
    const archetypeId = archetypeForKind(kind, tier);
    let rec = this.entries.get(id);
    if (!rec) {
      this.deaths.onEntitySpawned(id, wx, wz, kind);
      const mesh = this.acquireEntityMesh(id, archetypeId, this.biomeKey);
      mesh.position.set(wx, wy, wz);
      mesh.rotation.y = yaw;
      mesh.visible = visible;
      const buildStage = setArchetypeBuildProgress(mesh, buildProg);
      rec = {
        id, kind, owner, q, r, x, y, rot, hp, hpMax, state, progress: barProgress, buildStage, tier, archetypeId, mesh,
        targetPos: new THREE.Vector3(wx, wy, wz), targetYaw: yaw,
        track: new MotionTrack(), trackMoving: false,
        walk: state === ENTITY_STATE.moving ? 1 : 0,
        work: computeWorkTarget(kind, state, isDaylight),
      };
      if (!isOwnedPod) applyEntityTerrainPose(rec, terrain, baseWy, 0);
      this.entries.set(id, rec);
    } else {
      if (rec.archetypeId && rec.archetypeId !== archetypeId) {
        this.releaseEntityMesh(id, rec.archetypeId, rec.mesh);
        rec.mesh = this.acquireEntityMesh(id, archetypeId, this.biomeKey);
        rec.archetypeId = archetypeId;
      }
      const dx = wx - rec.mesh.position.x, dz = wz - rec.mesh.position.z;
      rec.targetYaw = !isOwnedPod && Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : yaw;
      rec.kind = kind; rec.owner = owner; rec.q = q; rec.r = r; rec.x = x; rec.y = y; rec.rot = rot;
      rec.hp = hp; rec.hpMax = hpMax; rec.state = state; rec.progress = barProgress; rec.tier = tier;
      rec.buildStage = setArchetypeBuildProgress(rec.mesh, buildProg);
      rec.mesh.visible = visible;
      if (isOwnedPod) {
        rec.mesh.position.x = wx;
        rec.mesh.position.z = wz;
        rec.mesh.rotation.y = yaw;
      }
      rec.targetPos.set(wx, wy, wz);
    }
    return rec.track.push({ tick, x, y, rot });
  }

  private stepPodTouchdown(dt: number, terrain: HexTerrain | null): PodTouchdownState { return stepPodTouchdownForEntries(this.podTouchdown, this.entries.values(), this.ownerColonyIndex, this.biomeKey, dt, terrain); }

  /** `dt`: animation time (warp-scaled); `realDt`: wall-clock seconds for the render clock (defaults to `dt`). */
  update(dt: number, terrain: HexTerrain | null = null, realDt = dt): void {
    this.time += dt;
    this.windTime += dt * rotorClockRate(getWindUniforms().uWindStrength.value);
    if (terrain) this.lastTerrain = terrain;
    this.hasTerrain = Boolean(terrain);
    this.deaths.pruneExpired(this.time);
    const renderTick = this.clock.advance(realDt);
    const posLerp = Math.min(1, 1 - Math.exp(-dt * 12));
    const rotLerp = Math.min(1, 1 - Math.exp(-dt * 10));
    const tdState = this.stepPodTouchdown(dt, terrain);
    const isDaylight = !isDayNightOn() || computeSolarState(getDayNightParams()).daylight > 0.05;

    for (const rec of this.entries.values()) {
      const baseWy = entityGroundY(terrain, rec.kind, rec.q, rec.r, rec.targetPos.x, rec.targetPos.z);
      const isOwnedPod = rec.kind === ENTITY_KIND.pod && rec.owner === this.ownerColonyIndex;
      rec.targetPos.y = baseWy + (isOwnedPod ? tdState.podLift : 0);
      if (rec.kind === ENTITY_KIND.pod) rec.mesh.position.lerp(rec.targetPos, posLerp);
      else placeMeshOnTrack(rec, renderTick, 1 - Math.exp(-realDt * FOLLOW_PER_S));
      if (isOwnedPod && tdState.state !== 'done') rec.mesh.position.y = rec.targetPos.y;
      rec.mesh.visible = !this.deaths.isWrecked(rec.id) && this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState);
    }
    this.syncVisionAndForeignVisibility(terrain, tdState);
    const workSites = this.prestige.tintCutters(buildActiveWorkSites({ records: this.entries, view: this.latestView, tiles: this.latestTiles, terrain, biomeKey: this.biomeKey, dt }), this.entries, this.latestView);
    const workingIds = new Set(workSites.map((s) => Number(s.workerId)));
    const selectedSet = this.collectSelectedIdSet();
    for (const rec of this.entries.values()) {
      if (rec.kind === ENTITY_KIND.hq && rec.owner === this.ownerColonyIndex && tdState.state === 'egress') {
        const baseWy = entityGroundY(terrain, rec.kind, rec.q, rec.r, rec.targetPos.x, rec.targetPos.z);
        const roll = tdState.heroEgressProgress, back = (1 - roll) * POD_LAND_OFFSET_M;
        rec.mesh.position.set(rec.targetPos.x - POD_EGRESS_DIR.x * back, baseWy + (1 - roll) * 0.38, rec.targetPos.z - POD_EGRESS_DIR.z * back);
        rec.mesh.rotation.set(0, POD_EGRESS_YAW, 0, 'YXZ'); rec.walk = roll < 0.98 ? 1 : 0;
        tickArchetypeMesh(rec.mesh, this.time, rec.walk, 0);
        continue;
      }
      if (!workingIds.has(rec.id)) {
        const dYaw = rec.targetYaw - rec.mesh.rotation.y;
        rec.mesh.rotation.y = Math.atan2(Math.sin(rec.mesh.rotation.y + Math.atan2(Math.sin(dYaw), Math.cos(dYaw)) * rotLerp), Math.cos(rec.mesh.rotation.y + Math.atan2(Math.sin(dYaw), Math.cos(dYaw)) * rotLerp));
      }
      const isOwnedPod = rec.kind === ENTITY_KIND.pod && rec.owner === this.ownerColonyIndex;
      const baseWy = entityGroundY(terrain, rec.kind, rec.q, rec.r, rec.targetPos.x, rec.targetPos.z);
      const suspTime = isOwnedPod ? null : applyEntityTerrainPose(rec, terrain, baseWy, dt);
      if (!rec.mesh.visible) { rec.walk = 0; rec.work = 0; continue; }
      const wantWalk = isTrackedWalkingUnitKind(rec.kind) ? (rec.trackMoving ? 1 : 0) : rec.state === ENTITY_STATE.moving ? 1 : 0;
      updateSelectionPulse(rec.mesh, selectedSet.has(rec.id), this.time);
      this.combatSync.battle.insects.track(rec.id, rec.mesh, rec.hp, wantWalk > 0);
      const wantWork = computeWorkTarget(rec.kind, rec.state, isDaylight);
      rec.walk += (wantWalk - rec.walk) * Math.min(1, dt * 10);
      rec.work += (wantWork - rec.work) * Math.min(1, dt * 10);
      if (!syncEntityShadowCaster(rec.mesh, !isConstructibleBuilding(rec.kind))) continue;
      const animTime = isConstructibleBuilding(rec.kind) && wantWork === 0
        ? ((rec.mesh.userData as { uniforms?: { uTime?: { value: number } } })?.uniforms?.uTime?.value ?? 0)
        : (suspTime ?? this.time);
      tickArchetypeMesh(rec.mesh, rec.kind === ENTITY_KIND.wind && wantWork > 0 ? this.windTime : animTime, rec.walk, rec.work);
    }
    this.workParticles.syncSites(workSites);
    syncBiosphereAggressors(terrain, this.entries.values(), workingIds);
    this.workParticles.update(dt);
    this.combatSync.update(dt);
    this.gridCables.update(realDt);
    const alive = [...this.entries.values()].filter(r => !this.deaths.isWrecked(r.id));
    this.radarShadows.sync(alive, this.latestView, terrain, this.ownerColonyIndex, this.spectatorAllVision || this.fullVision, this.time);
    this.swarms.sync(this.biomeKey);
    this.healthBars.sync(alive);
    this.updateSelectionRing();
    const anyMoving = [...selectedSet].map((id) => this.entries.get(id)).find((r) => r?.state === ENTITY_STATE.moving) ?? (this.selectedEntityId !== null ? this.entries.get(this.selectedEntityId) : undefined);
    const markerNext = stepTargetMarker(this.targetMarker, anyMoving, this.markerT, this.markerTile, dt, terrain);
    this.markerT = markerNext.markerT; this.markerTile = markerNext.markerTile;
  }

  private acquireEntityMesh(id: number, archetypeId: string, biomeKey: string): THREE.Object3D { return acquirePooledEntityMesh(this, id, archetypeId, biomeKey); }
  private releaseEntityMesh(id: number, archetypeId?: string, expectedMesh?: THREE.Object3D): void { releasePooledEntityMesh(this, id, archetypeId, expectedMesh); }
  private updateSelectionRing(): void {
    this.selectionRings.sync(this.collectSelectedIdSet(), this.entries, this.lastTerrain, this.time);
    syncEntityTargetSelection(this.targetSelection, this.latestView, this.selectedEntityId, this.selectedUnitIds, this.ownerColonyIndex, this.entries, (id) => this.deaths.isWrecked(id), this.optimisticTargets, this.lastTerrain, this.time);
  }
  stepSpacePrewarm(terrain: HexTerrain | null, maxCount = 2): boolean {
    if (this.deferredSpaceRows.size === 0 || !this.latestView) return true;
    const view = this.latestView; const tdState = this.podTouchdown.computeState(true, 0); let built = 0;
    for (const [id, row] of this.deferredSpaceRows) {
      this.deferredSpaceRows.delete(id); this.upsertEntity(row, terrain, tdState, view.tick, view);
      const mesh = this.entries.get(id)?.mesh; syncExtractorAppearance(mesh, row, view);
      if (mesh) this.combatSync.battle.insects.track(id, mesh, row.hp, row.state === ENTITY_STATE.moving);
      if (++built >= maxCount) break;
    }
    if (this.deferredSpaceRows.size === 0) { this.syncVisionAndForeignVisibility(terrain, tdState); this.healthBars.sync(this.entries.values()); }
    return this.deferredSpaceRows.size === 0;
  }
  stepLandingFxPrewarm(): boolean { return this.podTouchdown.stepPrewarm(planetKindForBiome(this.biomeKey), findOwnedPodMesh(this.entries.values(), this.ownerColonyIndex)); }
  prewarmLandingFx(): THREE.Object3D[] { return this.podTouchdown.prewarm(planetKindForBiome(this.biomeKey), findOwnedPodMesh(this.entries.values(), this.ownerColonyIndex)); }
  flushSpacePrewarm(terrain: HexTerrain | null): void { if (this.deferredSpaceRows.size > 0) this.stepSpacePrewarm(terrain, Number.MAX_SAFE_INTEGER); }
  dispose(): void {
    this.deferredSpaceRows.clear(); this.swarms.dispose(); resetColonyVisionAndLights(); this.podTouchdown.dispose();
    this.healthBars.dispose(); this.workParticles.dispose(); this.combatSync.dispose(); this.corpses.dispose(); this.wrecks.dispose(); this.deaths.clear(); this.gridCables.dispose(); this.radarShadows.dispose(); this.targetSelection.dispose(); this.selectionRings.dispose();
    this.entries.clear(); this.buildingsOrchestrator.dispose(); this.unitsOrchestrator.dispose(); this.bugsOrchestrator.dispose();
    this.scene.remove(this.group, this.selectionRing, this.targetMarker);
    this.selectionRing.geometry.dispose(); (this.selectionRing.material as THREE.Material).dispose(); this.targetMarker.geometry.dispose(); (this.targetMarker.material as THREE.Material).dispose();
  }
}
