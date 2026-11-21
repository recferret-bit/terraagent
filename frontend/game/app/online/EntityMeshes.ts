import { InsectSwarmRenderer } from '@terra/render/animation/insects/InsectSwarmRenderer';
import type { EntityMeshRecord } from './EntityMeshRecord';
export type { EntityMeshRecord } from './EntityMeshRecord';
import * as THREE from 'three';
import { syncExtractorAppearance } from './extractorAppearance';
import { updateSelectionPulse, updateGroundSelection } from './selectionPulse';
import { getWindUniforms } from '@terra/render/core/windConfig';
import { rotorClockRate } from '@terra/render/core/rotorSpeed';
import { computeSolarState, getDayNightParams, isDayNightOn, isSceneInDescent } from '@terra/render/core/dayNightConfig';
import { createArchetypeMesh, setArchetypeBuildProgress, tickArchetypeMesh } from '@terra/render/kitbash';
import { getColonyVisionUniforms, isWorldPointInColonyFov } from '@terra/render/lighting';
import { GridCableRenderer } from '@terra/render/lighting/gridCables';
import {
  BugsOrchestrator,
  BuildingsOrchestrator,
  buildBuildingsOrchestratorConfig,
  buildUnitsOrchestratorConfig,
  UnitsOrchestrator,
} from '@terra/render/orchestrators';
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
import { resetColonyVisionAndLights, syncColonyVisionAndProjectors } from './entityVisionSync';
import { POD_EGRESS_DIR, POD_EGRESS_YAW, POD_LAND_OFFSET_M } from './PodImpactRig';
import { derivePowerCableSpans } from './powerCableSpans';
import { PodTouchdownFx, type PodTouchdownState } from './PodTouchdownFx';
import { UnitHealthBars } from './unitHealthBars';
import { syncBiosphereAggressors } from './biosphereAggressorSync';
import { CombatSyncController } from './combatSync';
import {
  archetypeForKind,
  entityWorldXZ,
  is3x3FootprintKind,
  isConstructibleBuilding,
  isTrackedWalkingUnitKind,
} from './entityKinds';
import {
  findOwnedPodMesh,
  makeGroundRing,
  placeMeshOnTrack,
  planetKindForBiome,
  stepPodTouchdownForEntries,
  stepTargetMarker,
} from './parts/entityMarkers';
import {
  acquirePooledEntityMesh,
  collectEntityPoolStats,
  computeEntityMeshVisible,
  normalizeEntityBiomeKey,
  releasePooledEntityMesh,
  resetEntitiesOnPlanetSwitch,
  switchAndPrewarmEntityBiome,
} from './parts/entityPoolRouter';
import {
  buildActiveWorkSites,
  computeWorkTarget,
  entityGroundY,
  hubBuildProgressForState,
  is2x2BuildingKind,
} from './workTargetResolver';

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
  readonly targetMarker: THREE.Mesh;
  readonly podTouchdown: PodTouchdownFx;
  readonly healthBars: UnitHealthBars;
  readonly workParticles: WorkParticleSystem;
  readonly combatSync: CombatSyncController;
  /** Grid cables + lightning between the Hub, pylons and attached buildings (`powerCableSpans.ts`). */
  readonly gridCables: GridCableRenderer;
  isW10Enabled: () => boolean = () => true;
  /** W28-12 staking prestige: HQ uplink beam, dish, gold trim and cyan cutters (off until the session enables it). */
  readonly prestige = new PrestigeDressing();
  private readonly entries = new Map<number, EntityMeshRecord>();
  private readonly deferredSpaceRows = new Map<number, EntityRow>();
  private selectedEntityId: number | null = null;
  private ownerColonyIndex = 0;
  private markerT = 99;
  private markerTile: { q: number; r: number } | null = null;
  private time = 0;
  private windTime = 0;
  private biomeKey = 'forestRock';
  private prewarmedBiomeKey: string | null = null;
  private currentPlanetId: string | null = null;
  private latestTiles: ClientTiles | null = null;
  private latestView: ClientView | null = null;
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
    this.gridCables = new GridCableRenderer(this.scene);
    this.selectionRing = makeGroundRing(0.75, 0.95, 0xff6a13, 'selection-ring');
    this.scene.add(this.selectionRing);
    this.targetMarker = makeGroundRing(0.55, 0.75, 0x00f0ff, 'target-marker');
    this.scene.add(this.targetMarker);
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
    const tdState = this.podTouchdown.computeState(false, 1);
    for (const rec of this.entries.values()) {
      rec.mesh.visible = this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState);
    }
    this.updateSelectionRing();
  }

  setSelectedEntityId(entityId: number | null): void {
    this.selectedEntityId = entityId;
    this.healthBars.setSelectedEntityId(entityId);
    this.updateSelectionRing();
  }

  getSelectedEntityId(): number | null {
    return this.selectedEntityId;
  }

  flashTarget(q: number, r: number, terrain: HexTerrain | null = null, color = 0x00f0ff): void {
    const [wx, wz] = tileXZ(q, r);
    const wy = terrain ? terrain.heightAt(wx, wz) : 0;
    (this.targetMarker.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.targetMarker.position.set(wx, wy + 0.08, wz);
    this.targetMarker.scale.setScalar(1);
    this.targetMarker.visible = true;
    this.markerTile = { q, r };
    this.markerT = 0;
  }

  private computeMeshVisible(kind: number, owner: number, state: number, tdState: PodTouchdownState, wx?: number, wz?: number): boolean {
    return computeEntityMeshVisible(kind, owner, state, this.ownerColonyIndex, this.hasTerrain, this.isW10Enabled(), tdState, wx, wz);
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
      this.clock = new RenderClock(TICK_MS / 1000);
    }
    if (nextPlanetId !== null) this.currentPlanetId = nextPlanetId;
    this.prewarmForBiome(normalizeEntityBiomeKey(biomeKey, view.planet?.type, this.prewarmedBiomeKey ?? this.biomeKey));
    this.latestView = view;
    if (view.tiles) this.latestTiles = view.tiles;
    this.isTileVisible = createMapVisibility({
      simData: data, clientView: view, tiles: this.latestTiles, radius: view.planet.radius, ownColonySlot: this.ownerColonyIndex,
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
      if (!seen.has(id)) {
        const retiredMesh = rec.mesh;
        const retiredArchetype = rec.archetypeId;
        const release = () => this.releaseEntityMesh(id, retiredArchetype, retiredMesh);
        if (!this.combatSync.battle.insects.retire(id, release, rec.hp <= 0 || this.combatSync.confirmedDeaths.has(id))) release();
        this.entries.delete(id);
      }
    }
    if (this.dropPredictedFuture) {
      this.dropPredictedFuture = false;
      for (const rec of this.entries.values()) rec.track.dropAfter(view.tick);
    }
    this.prestige.sync(view, this.entries.values());
    this.syncVisionAndForeignVisibility(terrain, tdState);
    this.swarms.sync(this.biomeKey);
    this.healthBars.sync(this.entries.values());
    this.combatSync.syncView(view, terrain);
    this.updateSelectionRing();
    const ground = terrain ? (x: number, z: number) => terrain.heightAt(x, z) : undefined;
    this.gridCables.setSpans(derivePowerCableSpans(this.entries.values(), view, this.ownerColonyIndex), ground);
  }

  private syncVisionAndForeignVisibility(terrain: HexTerrain | null, tdState: PodTouchdownState): void {
    syncColonyVisionAndProjectors({
      records: this.entries.values(), data: this.simData,
      ownerColonyIndex: this.ownerColonyIndex,
      terrain,
      tiles: this.latestTiles,
      // The session exists from DEPLOY on; hold the colony shroud/night/projectors off through the orbital stage and
      // the descent cinematic (their pod, surface and the offset hex terrain are not in colony coordinates).
      colonyActive: !this.podTouchdown.isSpacePhaseActive() && !isSceneInDescent(this.scene),
    });
    const fogOn = (getColonyVisionUniforms().uFovEnabled.value as number) > 0.001;
    for (const rec of this.entries.values()) {
      const foreign = rec.owner !== this.ownerColonyIndex;
      const ownPod = !foreign && rec.kind === ENTITY_KIND.pod;
      if (!foreign && !(ownPod && fogOn)) continue;
      const spotted = !this.isTileVisible || this.isTileVisible(rec.q, rec.r);
      const inCircle = !this.hasTerrain || isWorldPointInColonyFov(rec.mesh.position.x, rec.mesh.position.z);
      rec.mesh.visible = spotted && inCircle && this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState);
    }
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
    const visible = this.computeMeshVisible(kind, owner, state, tdState);
    const isDaylight = !isDayNightOn() || computeSolarState(getDayNightParams()).daylight > 0.05;
    const tier = e.tier === 2 || e.tier === 3 ? e.tier : e.tier === 1 ? 1 : undefined;
    const archetypeId = archetypeForKind(kind, tier);
    let rec = this.entries.get(id);
    if (!rec) {
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

  private stepPodTouchdown(dt: number, terrain: HexTerrain | null): PodTouchdownState {
    return stepPodTouchdownForEntries(
      this.podTouchdown,
      this.entries.values(),
      this.ownerColonyIndex,
      this.biomeKey,
      dt,
      terrain,
    );
  }

  /** `dt`: animation time (warp-scaled); `realDt`: wall-clock seconds for the render clock (defaults to `dt`). */
  update(dt: number, terrain: HexTerrain | null = null, realDt = dt): void {
    this.time += dt;
    this.windTime += dt * rotorClockRate(getWindUniforms().uWindStrength.value);
    this.hasTerrain = Boolean(terrain);
    const renderTick = this.clock.advance(realDt);
    const posLerp = Math.min(1, 1 - Math.exp(-dt * 12));
    const rotLerp = Math.min(1, 1 - Math.exp(-dt * 10));
    const tdState = this.stepPodTouchdown(dt, terrain);
    const isDaylight = !isDayNightOn() || computeSolarState(getDayNightParams()).daylight > 0.05;

    for (const rec of this.entries.values()) {
      const baseWy = entityGroundY(terrain, rec.kind, rec.q, rec.r, rec.targetPos.x, rec.targetPos.z);
      const isOwnedPod = rec.kind === ENTITY_KIND.pod && rec.owner === this.ownerColonyIndex;
      const isOwnedHq = rec.kind === ENTITY_KIND.hq && rec.owner === this.ownerColonyIndex;
      rec.targetPos.y = baseWy + (isOwnedPod ? tdState.podLift : 0);
      if (rec.kind === ENTITY_KIND.pod) rec.mesh.position.lerp(rec.targetPos, posLerp);
      else placeMeshOnTrack(rec, renderTick, 1 - Math.exp(-realDt * FOLLOW_PER_S));
      if (isOwnedPod && tdState.state !== 'done') {
        rec.mesh.position.y = rec.targetPos.y;
      } else if (!isOwnedPod) {
        rec.mesh.position.y = is2x2BuildingKind(rec.kind) || is3x3FootprintKind(rec.kind)
          ? baseWy
          : terrain ? terrain.heightAt(rec.mesh.position.x, rec.mesh.position.z) : baseWy;
      }
      rec.mesh.visible = this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState);

      if (isOwnedHq && tdState.state === 'egress') {
        const roll = tdState.heroEgressProgress;
        const back = (1 - roll) * POD_LAND_OFFSET_M;
        rec.mesh.position.set(
          rec.targetPos.x - POD_EGRESS_DIR.x * back,
          baseWy + (1 - roll) * 0.38,
          rec.targetPos.z - POD_EGRESS_DIR.z * back,
        );
        rec.mesh.rotation.y = POD_EGRESS_YAW;
        rec.walk = roll < 0.98 ? 1 : 0;
        tickArchetypeMesh(rec.mesh, this.time, rec.walk, 0);
        continue;
      }

      const wantWalk = isTrackedWalkingUnitKind(rec.kind) ? (rec.trackMoving ? 1 : 0) : rec.state === ENTITY_STATE.moving ? 1 : 0;
      updateSelectionPulse(rec.mesh, rec.id === this.selectedEntityId, this.time);
      this.combatSync.battle.insects.track(rec.id, rec.mesh, rec.hp, wantWalk > 0);
      const wantWork = computeWorkTarget(rec.kind, rec.state, isDaylight);
      rec.walk += (wantWalk - rec.walk) * Math.min(1, dt * 10);
      rec.work += (wantWork - rec.work) * Math.min(1, dt * 10);
      if (!syncEntityShadowCaster(rec.mesh, !isConstructibleBuilding(rec.kind))) continue; // off-screen: pose kept, no shader clock / rig upload
      const animTime = isConstructibleBuilding(rec.kind) && wantWork === 0
        ? ((rec.mesh.userData as { uniforms?: { uTime?: { value: number } } })?.uniforms?.uTime?.value ?? 0)
        : this.time;
      tickArchetypeMesh(rec.mesh, rec.kind === ENTITY_KIND.wind && wantWork > 0 ? this.windTime : animTime, rec.walk, rec.work);
    }

    const workSites = this.prestige.tintCutters(buildActiveWorkSites({
      records: this.entries,
      view: this.latestView,
      tiles: this.latestTiles,
      terrain,
      biomeKey: this.biomeKey,
      dt,
    }), this.entries, this.latestView);
    const workingIds = new Set(workSites.map((s) => Number(s.workerId)));
    for (const rec of this.entries.values()) {
      if (rec.kind === ENTITY_KIND.hq && rec.owner === this.ownerColonyIndex && tdState.state === 'egress') continue;
      if (workingIds.has(rec.id)) continue;
      const diff = ((rec.targetYaw - rec.mesh.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rec.mesh.rotation.y += diff * rotLerp;
    }
    this.workParticles.syncSites(workSites);
    syncBiosphereAggressors(terrain, this.entries.values(), workingIds);
    this.workParticles.update(dt);
    this.combatSync.update(dt);
    this.gridCables.update(realDt);

    this.syncVisionAndForeignVisibility(terrain, tdState);
    this.swarms.sync(this.biomeKey);
    this.healthBars.sync(this.entries.values());
    this.updateSelectionRing();
    const sel = this.selectedEntityId !== null ? this.entries.get(this.selectedEntityId) : undefined;
    const markerNext = stepTargetMarker(this.targetMarker, sel, this.markerT, this.markerTile, dt, terrain);
    this.markerT = markerNext.markerT;
    this.markerTile = markerNext.markerTile;
  }

  private acquireEntityMesh(id: number, archetypeId: string, biomeKey: string): THREE.Object3D { return acquirePooledEntityMesh(this, id, archetypeId, biomeKey); }
  private releaseEntityMesh(id: number, archetypeId?: string, expectedMesh?: THREE.Object3D): void { releasePooledEntityMesh(this, id, archetypeId, expectedMesh); }
  private updateSelectionRing(): void { updateGroundSelection(this.selectionRing, this.selectedEntityId !== null ? this.entries.get(this.selectedEntityId) : undefined, this.time); }

  /** Incrementally instantiates deferred off-screen/foreign entities while the drop pod is descending from space. */
  stepSpacePrewarm(terrain: HexTerrain | null, maxCount = 2): boolean {
    if (this.deferredSpaceRows.size === 0 || !this.latestView) return true;
    const view = this.latestView; const tdState = this.podTouchdown.computeState(true, 0); let built = 0;
    for (const [id, row] of this.deferredSpaceRows) {
      this.deferredSpaceRows.delete(id);
      this.upsertEntity(row, terrain, tdState, view.tick, view);
      syncExtractorAppearance(this.entries.get(id)?.mesh, row, view);
      const mesh = this.entries.get(id)?.mesh;
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
    this.deferredSpaceRows.clear(); this.swarms.dispose(); resetColonyVisionAndLights();
    this.podTouchdown.dispose(); this.healthBars.dispose(); this.workParticles.dispose();
    this.combatSync.dispose(); this.gridCables.dispose(); this.entries.clear();
    this.buildingsOrchestrator.dispose(); this.unitsOrchestrator.dispose(); this.bugsOrchestrator.dispose();
    this.scene.remove(this.group); this.scene.remove(this.selectionRing);
    this.selectionRing.geometry.dispose(); (this.selectionRing.material as THREE.Material).dispose();
    this.scene.remove(this.targetMarker); this.targetMarker.geometry.dispose(); (this.targetMarker.material as THREE.Material).dispose();
  }
}
