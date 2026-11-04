import * as THREE from 'three';
import { syncExtractorAppearance } from './extractorAppearance';
import { updateSelectionPulse } from './selectionPulse';
import { getWindUniforms } from '@terra/render/core/windConfig';
import { rotorClockRate } from '@terra/render/core/rotorSpeed';
import { computeSolarState, getDayNightParams, isDayNightOn, isSceneInDescent } from '@terra/render/core/dayNightConfig';
import { createArchetypeMesh, setArchetypeBuildProgress, stripBuildingPlinth, tickArchetypeMesh } from '@terra/render/kitbash';
import { attachEntityProjectorRig } from '@terra/render/lighting';
import { GridCableRenderer } from '@terra/render/lighting/gridCables';
import { WorkParticleSystem } from '@terra/render/particles';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE, TICK_MS } from '@terra/sim';
import { forEachEntity, type ClientTiles, type ClientView, type EntityRow } from '../../store/replica/viewCodec';
import { resolveEntityActivityProgress } from '../../features/landfall/selectionHelpers';
import { isEntityInViewFocus } from './entityFocus';
import { MotionTrack, RenderClock } from './entityMotion';
import { isWorldPointInColonyFov, resetColonyVisionAndLights, syncColonyVisionAndProjectors } from './entityVisionSync';
import { POD_EGRESS_DIR, POD_EGRESS_YAW, POD_LAND_OFFSET_M } from './PodImpactRig';
import { derivePowerCableSpans } from './powerCableSpans';
import { PodTouchdownFx, type PodTouchdownState } from './PodTouchdownFx';
import { disposeObject3D, UnitHealthBars } from './unitHealthBars';
import { entityWorldXZ, archetypeForKind, isConstructibleBuilding } from './entityKinds';
import {
  buildActiveWorkSites,
  computeWorkTarget,
  entityGroundY,
  hubBuildProgressForState,
  is2x2BuildingKind,
} from './workTargetResolver';

export { entityWorldXZ, archetypeForKind };

export interface EntityMeshRecord {
  id: number; kind: number; owner: number; q: number; r: number; x: number; y: number; rot: number;
  hp: number; hpMax: number; state: number; progress: number; buildStage: number;
  mesh: THREE.Object3D; targetPos: THREE.Vector3; targetYaw: number; walk: number; work: number;
  /** Poses by tick, drawn at the shared render clock (smooth constant-speed walking, see `entityMotion.ts`). */
  track: MotionTrack;
  /** The drawn pose moved during the last half tick (drives the walk animation, in step with what is drawn). */
  trackMoving: boolean;
}

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


function planetKindForBiome(biomeKey: string): PlanetKind {
  if (biomeKey === 'desert' || biomeKey === 'dune') return 'dune';
  if (biomeKey === 'ocean' || biomeKey === 'oceanForest') return 'oceanForest';
  return 'forestRock';
}

function makeGroundRing(innerR: number, outerR: number, color: number, name: string): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerR, outerR, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
  );
  ring.name = name;
  ring.visible = false;
  return ring;
}

/**
 * Renders sim entities (`devProbe`, `pod`, `hq`, `commandHub`, `metalsExtractor`, `solar`, `harvester`) in the online
 * 3D scene, interpolating continuous axial coordinates `(x, y)` smoothly and driving `aPartAnim` walk/work weights,
 * selection & move-target ground rings, and the drop-pod touchdown + retro-engine stop animation.
 */
export class EntityMeshes {
  readonly group = new THREE.Group();
  readonly selectionRing: THREE.Mesh;
  readonly targetMarker: THREE.Mesh;
  readonly podTouchdown: PodTouchdownFx;
  readonly healthBars: UnitHealthBars;
  readonly workParticles: WorkParticleSystem;
  /** Grid cables + lightning between the Hub, pylons and attached buildings (`powerCableSpans.ts`). */
  readonly gridCables: GridCableRenderer;
  isW10Enabled: () => boolean = () => true;
  private readonly entries = new Map<number, EntityMeshRecord>();
  private selectedEntityId: number | null = null;
  private ownerColonyIndex = 0;
  private markerT = 99;
  private markerTile: { q: number; r: number } | null = null;
  private time = 0;
  private windTime = 0;
  private biomeKey = 'forestRock';
  private latestTiles: ClientTiles | null = null;
  private latestView: ClientView | null = null;
  private hasTerrain = false;
  private readonly clock = new RenderClock(TICK_MS / 1000);
  private dropPredictedFuture = false;
  /** Called with the largest pose correction (tiles) of a view that moved an already drawn sample (dev net stats). */
  onCorrection: ((tiles: number) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly makeMesh: MeshFactory = (id, biome) => createArchetypeMesh(id, biome),
    playPodTouchdown = false,
  ) {
    this.group.name = 'online-entities';
    this.scene.add(this.group);
    this.podTouchdown = new PodTouchdownFx(this.scene, playPodTouchdown);
    this.healthBars = new UnitHealthBars(this.scene);
    this.workParticles = new WorkParticleSystem(this.scene);
    this.gridCables = new GridCableRenderer(this.scene);
    this.selectionRing = makeGroundRing(0.75, 0.95, 0xff6a13, 'selection-ring');
    this.scene.add(this.selectionRing);
    this.targetMarker = makeGroundRing(0.55, 0.75, 0x00f0ff, 'target-marker');
    this.scene.add(this.targetMarker);
  }

  get count(): number {
    return this.entries.size;
  }

  /** Rendered (interpolated) mesh of the owned HQ, for camera following. */
  ownHqObject(): THREE.Object3D | null {
    for (const r of this.entries.values()) if (r.kind === ENTITY_KIND.hq && r.owner === this.ownerColonyIndex) return r.mesh;
    return null;
  }

  getRecord(entityId: number): EntityMeshRecord | undefined {
    return this.entries.get(entityId);
  }

  hasPodTouchedDown(): boolean {
    return this.podTouchdown.hasTouchedDown();
  }

  isHqDeployed(): boolean {
    return this.podTouchdown.isHqDeployed();
  }

  getCameraShake(): number {
    return this.podTouchdown.getCameraShake();
  }

  setOwnerColonyIndex(colonyIndex: number): void {
    if (this.ownerColonyIndex === colonyIndex) return;
    this.ownerColonyIndex = colonyIndex;
    const tdState = this.podTouchdown.computeState(false, 1);
    for (const rec of this.entries.values()) {
      rec.mesh.visible = this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState);
    }
    this.updateSelectionRing();
  }

  setSelectedEntityId(entityId: number | null): void {
    this.selectedEntityId = entityId;
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

  private computeMeshVisible(
    kind: number,
    owner: number,
    state: number,
    tdState: PodTouchdownState,
    wx?: number,
    wz?: number,
  ): boolean {
    if (owner !== this.ownerColonyIndex && this.hasTerrain && wx !== undefined && wz !== undefined) {
      if (!isWorldPointInColonyFov(wx, wz)) return false;
    }
    if (kind === ENTITY_KIND.pod) {
      return owner === this.ownerColonyIndex ? tdState.podVisible : state === ENTITY_STATE.descending;
    }
    if (kind === ENTITY_KIND.hq) {
      if (state === ENTITY_STATE.descending) return false;
      return owner === this.ownerColonyIndex ? tdState.hqVisible : true;
    }
    if (kind === ENTITY_KIND.commandHub && owner === this.ownerColonyIndex && !tdState.uiVisible) {
      return false;
    }
    if (kind === ENTITY_KIND.tradeHub && (state === ENTITY_STATE.inert || !this.isW10Enabled())) return false;
    return true;
  }

  /**
   * A command was rejected. If the client's sim could not have known (`UNPREDICTABLE_REJECTS`), the poses it predicted
   * past the next view's tick are wrong and are dropped then; otherwise the prediction already rejected it too.
   */
  discardPrediction(code?: string): void {
    if (code === undefined || UNPREDICTABLE_REJECTS.has(code)) this.dropPredictedFuture = true;
  }

  /**
   * `confirmedTick`: the newest server-confirmed tick. The render clock follows it, not the view's tick (which runs
   * ahead while a command is predicted), so walking speed never changes with prediction. Defaults to the view's tick.
   */
  syncView(view: ClientView, terrain: HexTerrain | null, biomeKey = this.biomeKey, confirmedTick = view.tick): void {
    this.biomeKey = biomeKey;
    this.latestView = view;
    if (view.tiles) this.latestTiles = view.tiles;
    this.hasTerrain = Boolean(terrain);
    this.clock.observe(Math.min(confirmedTick, view.tick));
    const seen = new Set<number>();

    let ownedPodDescending = false;
    let ownedPodProgress = 1;
    forEachEntity(view.entities, view.count, (e) => {
      if (e.kind !== ENTITY_KIND.pod || e.owner !== this.ownerColonyIndex) return;
      ownedPodDescending = e.state === ENTITY_STATE.descending;
      ownedPodProgress = e.progress;
      return false;
    });
    const tdState = this.podTouchdown.computeState(ownedPodDescending, ownedPodProgress);

    let correction = 0;
    forEachEntity(view.entities, view.count, (e) => {
      seen.add(e.id);
      correction = Math.max(correction, this.upsertEntity(e, terrain, tdState, view.tick, view));
      syncExtractorAppearance(this.entries.get(e.id)?.mesh, e, view);
    });
    if (correction > 0) this.onCorrection?.(correction);

    for (const [id, rec] of [...this.entries]) {
      if (!seen.has(id)) {
        this.group.remove(rec.mesh);
        disposeObject3D(rec.mesh);
        this.entries.delete(id);
      }
    }
    if (this.dropPredictedFuture) {
      this.dropPredictedFuture = false;
      for (const rec of this.entries.values()) rec.track.dropAfter(view.tick);
    }
    this.syncVisionAndForeignVisibility(terrain, tdState);
    this.healthBars.sync(this.entries.values());
    this.updateSelectionRing();
    const ground = terrain ? (x: number, z: number) => terrain.heightAt(x, z) : undefined;
    this.gridCables.setSpans(derivePowerCableSpans(this.entries.values(), view, this.ownerColonyIndex), ground);
  }

  private syncVisionAndForeignVisibility(terrain: HexTerrain | null, tdState: PodTouchdownState): void {
    syncColonyVisionAndProjectors({
      records: this.entries.values(),
      ownerColonyIndex: this.ownerColonyIndex,
      terrain,
      tiles: this.latestTiles,
      // The session exists from DEPLOY on; hold the colony shroud/night/projectors off through the orbital stage and
      // the descent cinematic (their pod, surface and the offset hex terrain are not in colony coordinates).
      colonyActive: !this.podTouchdown.isSpacePhaseActive() && !isSceneInDescent(this.scene),
    });
    for (const rec of this.entries.values()) {
      if (rec.owner !== this.ownerColonyIndex) {
        rec.mesh.visible = this.computeMeshVisible(rec.kind, rec.owner, rec.state, tdState, rec.mesh.position.x, rec.mesh.position.z);
      }
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
    let rec = this.entries.get(id);
    if (!rec) {
      const archetypeId = archetypeForKind(kind);
      const mesh = this.makeMesh(archetypeId, this.biomeKey);
      if (isConstructibleBuilding(kind)) stripBuildingPlinth(mesh);
      attachEntityProjectorRig(mesh, archetypeId);
      mesh.userData.entityId = id; // `__online.entityMeshes()` (listSceneEntities)
      mesh.position.set(wx, wy, wz);
      mesh.rotation.y = yaw;
      mesh.visible = visible;
      const buildStage = setArchetypeBuildProgress(mesh, buildProg);
      this.group.add(mesh);
      rec = {
        id, kind, owner, q, r, x, y, rot, hp, hpMax, state, progress: barProgress, buildStage, mesh,
        targetPos: new THREE.Vector3(wx, wy, wz), targetYaw: yaw,
        track: new MotionTrack(), trackMoving: false,
        walk: state === ENTITY_STATE.moving ? 1 : 0,
        work: computeWorkTarget(kind, state, isDaylight),
      };
      this.entries.set(id, rec);
    } else {
      const dx = wx - rec.mesh.position.x, dz = wz - rec.mesh.position.z;
      rec.targetYaw = !isOwnedPod && Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : yaw;
      rec.kind = kind; rec.owner = owner; rec.q = q; rec.r = r; rec.x = x; rec.y = y; rec.rot = rot;
      rec.hp = hp; rec.hpMax = hpMax; rec.state = state; rec.progress = barProgress;
      rec.buildStage = setArchetypeBuildProgress(rec.mesh, buildProg);
      rec.mesh.visible = visible;
      rec.targetPos.set(wx, wy, wz);
    }
    return rec.track.push({ tick, x, y, rot });
  }

  private stepPodTouchdown(dt: number, terrain: HexTerrain | null): PodTouchdownState {
    let podRec: EntityMeshRecord | undefined;
    for (const rec of this.entries.values()) {
      if (rec.kind === ENTITY_KIND.pod && rec.owner === this.ownerColonyIndex) {
        podRec = rec;
        break;
      }
    }
    let hubCoversCrater = false;
    if (podRec) {
      for (const rec of this.entries.values()) {
        if (isConstructibleBuilding(rec.kind) && rec.state !== ENTITY_STATE.waiting) {
          const coverRadius = rec.kind === ENTITY_KIND.commandHub ? 4.2 : 3.2;
          if (Math.hypot(rec.targetPos.x - podRec.targetPos.x, rec.targetPos.z - podRec.targetPos.z) <= coverRadius) {
            hubCoversCrater = true;
            break;
          }
        }
      }
    }
    const podGroundY = podRec && terrain ? terrain.heightAt(podRec.targetPos.x, podRec.targetPos.z) : 0;
    const tdState = this.podTouchdown.update(
      dt, podRec?.mesh ?? null, podGroundY,
      podRec?.state === ENTITY_STATE.descending, podRec?.progress ?? 1,
      planetKindForBiome(this.biomeKey),
    );
    if (hubCoversCrater && tdState.state === 'done') {
      this.podTouchdown.impactRig.craterGroup.visible = false;
      this.podTouchdown.impactRig.egressGroup.visible = false;
    }
    return tdState;
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
      else this.placeOnTrack(rec, renderTick, 1 - Math.exp(-realDt * FOLLOW_PER_S));
      if (isOwnedPod && tdState.state !== 'done') {
        rec.mesh.position.y = rec.targetPos.y;
      } else if (!isOwnedPod) {
        rec.mesh.position.y = is2x2BuildingKind(rec.kind)
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

      const isTrackedUnit = rec.kind === ENTITY_KIND.hq || rec.kind === ENTITY_KIND.harvester || rec.kind === ENTITY_KIND.builder;
      const wantWalk = isTrackedUnit ? (rec.trackMoving ? 1 : 0) : rec.state === ENTITY_STATE.moving ? 1 : 0;
      updateSelectionPulse(rec.mesh, rec.id === this.selectedEntityId, this.time);
      const wantWork = computeWorkTarget(rec.kind, rec.state, isDaylight);
      rec.walk += (wantWalk - rec.walk) * Math.min(1, dt * 10);
      rec.work += (wantWork - rec.work) * Math.min(1, dt * 10);
      if (!isEntityInViewFocus(rec.mesh)) continue; // off-screen: pose kept, no shader clock / rig upload
      const animTime = isConstructibleBuilding(rec.kind) && wantWork === 0
        ? ((rec.mesh.userData as { uniforms?: { uTime?: { value: number } } })?.uniforms?.uTime?.value ?? 0)
        : this.time;
      tickArchetypeMesh(rec.mesh, rec.kind === ENTITY_KIND.wind && wantWork > 0 ? this.windTime : animTime, rec.walk, rec.work);
    }

    const workSites = buildActiveWorkSites({
      records: this.entries,
      view: this.latestView,
      tiles: this.latestTiles,
      terrain,
      biomeKey: this.biomeKey,
      dt,
    });
    const workingIds = new Set(workSites.map((s) => Number(s.workerId)));
    for (const rec of this.entries.values()) {
      if (rec.kind === ENTITY_KIND.hq && rec.owner === this.ownerColonyIndex && tdState.state === 'egress') continue;
      if (workingIds.has(rec.id)) continue;
      const diff = ((rec.targetYaw - rec.mesh.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rec.mesh.rotation.y += diff * rotLerp;
    }
    this.workParticles.syncSites(workSites);
    this.workParticles.update(dt);
    this.gridCables.update(realDt);

    this.syncVisionAndForeignVisibility(terrain, tdState);
    this.healthBars.sync(this.entries.values());
    this.updateSelectionRing();
    this.updateTargetMarker(dt, terrain);
  }

  private updateTargetMarker(dt: number, terrain: HexTerrain | null): void {
    if (!this.targetMarker.visible) return;
    this.markerT += dt;
    this.targetMarker.scale.setScalar(1 + 0.22 * Math.sin(this.markerT * 8));
    const sel = this.selectedEntityId !== null ? this.entries.get(this.selectedEntityId) : undefined;
    const stillMoving = sel?.state === ENTITY_STATE.moving;
    if (!stillMoving && this.markerT > 0.6) {
      this.targetMarker.visible = false;
      this.markerTile = null;
    } else if (terrain && this.markerTile) {
      const [wx, wz] = tileXZ(this.markerTile.q, this.markerTile.r);
      this.targetMarker.position.set(wx, terrain.heightAt(wx, wz) + 0.08, wz);
    }
  }

  /** Draws a unit / building at its interpolated pose for `t`, facing where it walks (or its sim heading at rest). */
  private placeOnTrack(rec: EntityMeshRecord, t: number, follow: number): void {
    const pose = rec.track.at(t) ?? { x: rec.x, y: rec.y, rot: rec.rot };
    const [wx, wz] = entityWorldXZ(rec.kind, pose.x, pose.y);
    const p = rec.mesh.position;
    p.x += (wx - p.x) * follow;
    p.z += (wz - p.z) * follow;
    const before = rec.track.at(t - 0.5);
    const [bx, bz] = before ? entityWorldXZ(rec.kind, before.x, before.y) : [wx, wz];
    rec.trackMoving = Math.hypot(wx - bx, wz - bz) > 0.02;
    rec.targetYaw = rec.trackMoving ? Math.atan2(wx - bx, wz - bz) : Math.PI / 2 - pose.rot;
  }

  private updateSelectionRing(): void {
    const sel = this.selectedEntityId !== null ? this.entries.get(this.selectedEntityId) : undefined;
    if (!sel || !sel.mesh.visible) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    const geometry = (sel.mesh as THREE.Mesh).geometry;
    if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry?.boundingBox;
    const radius = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * sel.mesh.scale.x * 0.65 : 1;
    this.selectionRing.scale.setScalar(Math.max(1, radius) * (1 + 0.06 * Math.sin(this.time * 4)));
    (this.selectionRing.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(this.time * 4);
    this.selectionRing.position.set(sel.mesh.position.x, sel.mesh.position.y + 0.06, sel.mesh.position.z);
  }

  dispose(): void {
    resetColonyVisionAndLights();
    this.podTouchdown.dispose();
    this.healthBars.dispose();
    this.workParticles.dispose();
    this.gridCables.dispose();
    for (const rec of this.entries.values()) {
      this.group.remove(rec.mesh);
      disposeObject3D(rec.mesh);
    }
    this.entries.clear();
    this.scene.remove(this.group);
    this.scene.remove(this.selectionRing);
    this.selectionRing.geometry.dispose();
    (this.selectionRing.material as THREE.Material).dispose();
    this.scene.remove(this.targetMarker);
    this.targetMarker.geometry.dispose();
    (this.targetMarker.material as THREE.Material).dispose();
  }
}
