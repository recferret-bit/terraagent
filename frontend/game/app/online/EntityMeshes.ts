import * as THREE from 'three';
import { createArchetypeMesh, setArchetypeBuildProgress, tickArchetypeMesh } from '@terra/render/kitbash';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { ENTITY_STRIDE, type ClientView } from '../../store/replica/viewCodec';
import { POD_EGRESS_DIR, POD_EGRESS_YAW, POD_LAND_OFFSET_M } from './PodImpactRig';
import { PodTouchdownFx, type PodTouchdownState } from './PodTouchdownFx';

export interface EntityMeshRecord {
  id: number;
  kind: number;
  owner: number;
  q: number;
  r: number;
  x: number;
  y: number;
  rot: number;
  hp: number;
  hpMax: number;
  state: number;
  progress: number;
  buildStage: number;
  mesh: THREE.Object3D;
  targetPos: THREE.Vector3;
  targetYaw: number;
  walk: number;
  work: number;
}

export type MeshFactory = (archetypeId: string, biomeKey: string) => THREE.Object3D;

export function archetypeForKind(kind: number): string {
  if (kind === ENTITY_KIND.hq) return 'robot.hero';
  if (kind === ENTITY_KIND.pod) return 'ship.dropPod';
  if (kind === ENTITY_KIND.commandHub) return 'building.commandHub';
  return 'robot.scout';
}

function hubBuildProgressForState(state: number, progress: number): number {
  if (state === ENTITY_STATE.waiting) return 0;
  if (state === ENTITY_STATE.constructing) return progress;
  return 1;
}

function planetKindForBiome(biomeKey: string): PlanetKind {
  if (biomeKey === 'desert' || biomeKey === 'dune') return 'dune';
  if (biomeKey === 'ocean' || biomeKey === 'oceanForest') return 'oceanForest';
  return 'forestRock';
}

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
      else mat?.dispose?.();
    }
  });
}

/**
 * Renders sim entities (`devProbe`, `pod`, `hq`, `commandHub`) in the online 3D scene, interpolating continuous axial
 * coordinates `(x, y)` smoothly and driving `aPartAnim` walk/work weights, selection & move-target ground rings, and
 * the drop-pod touchdown + retro-engine stop animation.
 */
export class EntityMeshes {
  readonly group = new THREE.Group();
  readonly selectionRing: THREE.Mesh;
  readonly targetMarker: THREE.Mesh;
  readonly podTouchdown: PodTouchdownFx;
  private readonly entries = new Map<number, EntityMeshRecord>();
  private selectedEntityId: number | null = null;
  private ownerColonyIndex = 0;
  private markerT = 99;
  private markerTile: { q: number; r: number } | null = null;
  private time = 0;
  private biomeKey = 'forestRock';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly makeMesh: MeshFactory = (id, biome) => createArchetypeMesh(id, biome),
    playPodTouchdown = false,
  ) {
    this.group.name = 'online-entities';
    this.scene.add(this.group);
    this.podTouchdown = new PodTouchdownFx(this.scene, playPodTouchdown);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.95, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xff6a13,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      }),
    );
    this.selectionRing.name = 'selection-ring';
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.targetMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      }),
    );
    this.targetMarker.name = 'target-marker';
    this.targetMarker.visible = false;
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

  private computeMeshVisible(kind: number, owner: number, state: number, tdState: PodTouchdownState): boolean {
    if (kind === ENTITY_KIND.pod) {
      if (owner === this.ownerColonyIndex) return tdState.podVisible;
      return state === ENTITY_STATE.descending;
    }
    if (kind === ENTITY_KIND.hq) {
      if (state === ENTITY_STATE.descending) return false;
      if (owner === this.ownerColonyIndex) return tdState.hqVisible;
      return true;
    }
    if (kind === ENTITY_KIND.commandHub && owner === this.ownerColonyIndex && !tdState.uiVisible) {
      return false;
    }
    return true;
  }

  syncView(view: ClientView, terrain: HexTerrain | null, biomeKey = this.biomeKey): void {
    this.biomeKey = biomeKey;
    const seen = new Set<number>();
    const buf = view.entities;
    const hasEntityLayer = Boolean(this.scene.getObjectByName('entities'));

    let ownedPodDescending = false;
    let ownedPodProgress = 1;
    for (let i = 0; i < view.count; i++) {
      const o = i * ENTITY_STRIDE;
      if (buf[o + 1] === ENTITY_KIND.pod && buf[o + 2] === this.ownerColonyIndex) {
        ownedPodDescending = buf[o + 10] === ENTITY_STATE.descending;
        ownedPodProgress = buf[o + 11] ?? 1;
        break;
      }
    }
    const tdState = this.podTouchdown.computeState(ownedPodDescending, ownedPodProgress);

    for (let i = 0; i < view.count; i++) {
      const o = i * ENTITY_STRIDE;
      const id = buf[o];
      const kind = buf[o + 1];
      if (hasEntityLayer && kind === ENTITY_KIND.devProbe) continue;
      seen.add(id);
      this.upsertEntity(buf, o, terrain, tdState);
    }

    for (const [id, rec] of [...this.entries]) {
      if (!seen.has(id)) {
        this.group.remove(rec.mesh);
        disposeObject3D(rec.mesh);
        this.entries.delete(id);
      }
    }
    this.updateSelectionRing();
  }

  private upsertEntity(
    buf: ArrayLike<number>,
    o: number,
    terrain: HexTerrain | null,
    tdState: PodTouchdownState,
  ): void {
    const id = buf[o]!;
    const kind = buf[o + 1]!;
    const owner = buf[o + 2]!;
    const q = buf[o + 3]!;
    const r = buf[o + 4]!;
    const x = buf[o + 5]!;
    const y = buf[o + 6]!;
    const rot = buf[o + 7]!;
    const hp = buf[o + 8]!;
    const hpMax = buf[o + 9]!;
    const state = buf[o + 10]!;
    const progress = buf[o + 11]!;

    const [tileWx, tileWz] = tileXZ(x, y);
    const isOwnedPod = kind === ENTITY_KIND.pod && owner === this.ownerColonyIndex;
    const wx = isOwnedPod ? tileWx - POD_EGRESS_DIR.x * POD_LAND_OFFSET_M : tileWx;
    const wz = isOwnedPod ? tileWz - POD_EGRESS_DIR.z * POD_LAND_OFFSET_M : tileWz;
    const baseWy = terrain ? terrain.heightAt(wx, wz) : 0;
    const podLift = isOwnedPod ? tdState.podLift : 0;
    const wy = baseWy + podLift;
    const yaw = isOwnedPod ? POD_EGRESS_YAW : Math.PI / 2 - rot;
    const buildProg = kind === ENTITY_KIND.commandHub ? hubBuildProgressForState(state, progress) : 1;
    const visible = this.computeMeshVisible(kind, owner, state, tdState);
    let rec = this.entries.get(id);
    if (!rec) {
      const mesh = this.makeMesh(archetypeForKind(kind), this.biomeKey);
      mesh.position.set(wx, wy, wz);
      mesh.rotation.y = yaw;
      mesh.visible = visible;
      const buildStage = setArchetypeBuildProgress(mesh, buildProg);
      this.group.add(mesh);
      rec = {
        id, kind, owner, q, r, x, y, rot, hp, hpMax, state, progress, buildStage, mesh,
        targetPos: new THREE.Vector3(wx, wy, wz),
        targetYaw: yaw,
        walk: state === ENTITY_STATE.moving ? 1 : 0,
        work: state === ENTITY_STATE.working || state === ENTITY_STATE.constructing ? 1 : 0,
      };
      this.entries.set(id, rec);
    } else {
      const dx = wx - rec.mesh.position.x;
      const dz = wz - rec.mesh.position.z;
      rec.targetYaw = !isOwnedPod && Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : yaw;
      rec.kind = kind;
      rec.owner = owner;
      rec.q = q;
      rec.r = r;
      rec.x = x;
      rec.y = y;
      rec.rot = rot;
      rec.hp = hp;
      rec.hpMax = hpMax;
      rec.state = state;
      rec.progress = progress;
      rec.buildStage = setArchetypeBuildProgress(rec.mesh, buildProg);
      rec.mesh.visible = visible;
      rec.targetPos.set(wx, wy, wz);
    }
  }

  update(dt: number, terrain: HexTerrain | null = null): void {
    this.time += dt;
    const posLerp = Math.min(1, 1 - Math.exp(-dt * 12));
    const rotLerp = Math.min(1, 1 - Math.exp(-dt * 10));

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
        if (
          rec.kind === ENTITY_KIND.commandHub &&
          rec.owner === this.ownerColonyIndex &&
          rec.state !== ENTITY_STATE.waiting &&
          Math.hypot(rec.q - podRec.q, rec.r - podRec.r) <= 3
        ) {
          hubCoversCrater = true;
          break;
        }
      }
    }
    const podGroundY = podRec && terrain ? terrain.heightAt(podRec.targetPos.x, podRec.targetPos.z) : 0;
    const tdState = this.podTouchdown.update(
      dt,
      podRec?.mesh ?? null,
      podGroundY,
      podRec?.state === ENTITY_STATE.descending,
      podRec?.progress ?? 1,
      planetKindForBiome(this.biomeKey),
    );
    if (hubCoversCrater && tdState.state === 'done') {
      this.podTouchdown.impactRig.craterGroup.visible = false;
    }

    for (const rec of this.entries.values()) {
      const baseWy = terrain ? terrain.heightAt(rec.targetPos.x, rec.targetPos.z) : 0;
      const isOwnedPod = rec.kind === ENTITY_KIND.pod && rec.owner === this.ownerColonyIndex;
      const isOwnedHq = rec.kind === ENTITY_KIND.hq && rec.owner === this.ownerColonyIndex;
      const podLift = isOwnedPod ? tdState.podLift : 0;
      rec.targetPos.y = baseWy + podLift;
      rec.mesh.position.lerp(rec.targetPos, posLerp);
      if (isOwnedPod && tdState.state !== 'done') {
        rec.mesh.position.y = rec.targetPos.y;
      } else if (!isOwnedPod) {
        rec.mesh.position.y = terrain ? terrain.heightAt(rec.mesh.position.x, rec.mesh.position.z) : baseWy;
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

      const diff = ((rec.targetYaw - rec.mesh.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rec.mesh.rotation.y += diff * rotLerp;

      const wantWalk = rec.state === ENTITY_STATE.moving ? 1 : 0;
      const wantWork = rec.state === ENTITY_STATE.working || rec.state === ENTITY_STATE.constructing ? 1 : 0;
      rec.walk += (wantWalk - rec.walk) * Math.min(1, dt * 10);
      rec.work += (wantWork - rec.work) * Math.min(1, dt * 10);
      tickArchetypeMesh(rec.mesh, this.time, rec.walk, rec.work);
    }

    this.updateSelectionRing();

    if (this.targetMarker.visible) {
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
  }

  private updateSelectionRing(): void {
    const sel = this.selectedEntityId !== null ? this.entries.get(this.selectedEntityId) : undefined;
    if (!sel || !sel.mesh.visible) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    this.selectionRing.position.set(sel.mesh.position.x, sel.mesh.position.y + 0.06, sel.mesh.position.z);
  }

  dispose(): void {
    this.podTouchdown.dispose();
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
