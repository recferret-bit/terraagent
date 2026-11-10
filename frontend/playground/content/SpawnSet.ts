import * as THREE from 'three';
import {
  ArchetypeCatalog,
  createArchetypeMesh,
  isArchetypeRuin,
  setArchetypeBuildProgress,
  setArchetypeRuin,
  tickArchetypeMesh,
  type ArchetypeCategory,
  type ArchetypeMesh,
  type DepositVisualStage,
} from '@terra/render/kitbash';
import { MAX_COLONY_PROJECTORS, updateColonyProjectorsAndVision, type ColonyProjectorDesc } from '@terra/render/lighting/ColonyVisionAndLights';
import { attachEntityProjectorRig, EntityProjectorRig, type EntityProjectorRigState } from '@terra/render/lighting/EntityProjectorRig';
import { getArchetypeLights, peekArchetypeLights } from '@terra/render/lighting/archetypeLights';
import { projectorCosOuter } from '@terra/render/lighting/projectorCone';
import {
  WorkParticleSystem,
  computeMeshToolOrigins,
  type ActiveWorkSiteInput,
  type InteractionTargetKind,
} from '@terra/render/particles';

export interface Spawn { id: string; mesh: ArchetypeMesh; box: THREE.Box3; }
const footprint = (b: THREE.Box3) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1);
const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _col = new THREE.Color();

/** The archetype meshes currently on the pedestal (one, or a whole category row), their layout and selection ring. */
export class SpawnSet {
  readonly content = new THREE.Group();
  readonly ring: THREE.Mesh;
  readonly workParticles: WorkParticleSystem;
  spawns: Spawn[] = [];

  constructor() {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.position.y = 0.006;
    this.workParticles = new WorkParticleSystem(this.content);
  }

  dispose() {
    this.workParticles.clear();
    for (const s of this.spawns) {
      this.content.remove(s.mesh);
      // every robot / building mesh carries a projector rig (cones, pools, lenses, halo): free it with the model
      (s.mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig?.dispose();
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.spawns = [];
  }

  /** Spawn `ids` side by side, centred on the origin. */
  rebuild(ids: string[], biomeKey: string, wire: boolean, depositStage: DepositVisualStage = 'full') {
    this.dispose();
    const widths: number[] = [];
    for (const id of ids) {
      let mesh: ArchetypeMesh;
      try { mesh = createArchetypeMesh(id, biomeKey, depositStage); } catch (e) { console.error('archetype build failed', id, e); continue; }
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone();
      widths.push(footprint(box));
      this.spawns.push({ id, mesh, box });
      this.content.add(mesh);
    }
    const gap = 0.9;
    let x = -(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)) / 2;
    this.spawns.forEach((s, i) => { s.mesh.position.set(x + widths[i] / 2, 0, 0); x += widths[i] + gap; });
    this.applyWire(wire);
    this.refreshLights();
    this.content.rotation.y = 0;
  }

  idsFor(row: ArchetypeCategory | null, id: string): string[] {
    return row ? ArchetypeCatalog.list(row).map((e) => e.id) : id ? [id] : [];
  }

  applyWire(wire: boolean) { for (const s of this.spawns) (s.mesh.material as THREE.MeshStandardMaterial).wireframe = wire; }

  /** Construction scaffold stage of every shown archetype (1 = complete). */
  applyBuild(stage: number) { for (const s of this.spawns) setArchetypeBuildProgress(s.mesh, stage); }

  /** Ruin variant (W18-22: charred, cracked, unlit) of every shown archetype. */
  applyRuin(ruin: boolean) { for (const s of this.spawns) setArchetypeRuin(s.mesh, ruin); }

  find(id: string) { return this.spawns.find((s) => s.id === id); }

  updateRing(id: string, row: ArchetypeCategory | null) {
    const s = this.find(id);
    this.ring.visible = !!s && row !== null;
    if (!s) return;
    this.ring.scale.setScalar(footprint(s.box) * 0.62);
    this.ring.position.set(s.mesh.position.x, 0.006, s.mesh.position.z);
  }

  minX() { return this.spawns.length ? Math.min(...this.spawns.map((s) => s.mesh.position.x + s.box.min.x)) : 0; }

  bounds(id: string, row: ArchetypeCategory | null) {
    const box = new THREE.Box3();
    if (!this.spawns.length) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
    for (const s of row ? this.spawns : this.spawns.filter((s) => s.id === id)) box.union(s.box.clone().translate(s.mesh.position));
    return box;
  }

  /** Rebuild 3D projector rigs on spawned meshes after light source edits. */
  refreshLights(archetypeId?: string) {
    for (const s of this.spawns) {
      if (archetypeId && archetypeId !== '*' && s.id !== archetypeId) continue;
      const existing = (s.mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig;
      if (existing) {
        existing.rebuild();
      } else if (getArchetypeLights(s.id).length > 0) {
        const rig = attachEntityProjectorRig(s.mesh, s.id) ?? new EntityProjectorRig(s.id);
        if (!rig.group.parent) s.mesh.add(rig.group);
        (s.mesh.userData as Record<string, unknown>).projectorRig = rig;
      }
    }
  }

  private syncProjectors(selectedId: string, lightsMode: boolean, nightMode: boolean) {
    this.content.updateMatrixWorld(true);
    const ordered = selectedId
      ? [...this.spawns.filter((s) => s.id === selectedId), ...this.spawns.filter((s) => s.id !== selectedId)]
      : this.spawns;
    const projectors: ColonyProjectorDesc[] = [];
    const boost = nightMode ? 1.35 : lightsMode ? 1.0 : 0.35;
    for (const s of ordered) {
      if (isArchetypeRuin(s.mesh)) continue;
      const lights = peekArchetypeLights(s.id); // per frame: no copy
      for (const l of lights) {
        if (projectors.length >= MAX_COLONY_PROJECTORS) break;
        _pos.set(l.pos[0], l.pos[1], l.pos[2]).applyMatrix4(s.mesh.matrixWorld);
        _tgt.set(l.target[0], l.target[1], l.target[2]).applyMatrix4(s.mesh.matrixWorld);
        _dir.copy(_tgt).sub(_pos);
        const dist = _dir.length();
        if (dist > 1e-4) _dir.divideScalar(dist);
        else _dir.set(0, -1, 0);
        const cosAngle = projectorCosOuter(l); // the game's cone, which the beam mesh draws too
        _col.setHex(l.color);
        projectors.push({
          x: _pos.x, y: _pos.y, z: _pos.z, range: l.range,
          dirX: _dir.x, dirY: _dir.y, dirZ: _dir.z, cosAngle,
          r: _col.r, g: _col.g, b: _col.b, intensity: l.intensity * boost,
        });
      }
      if (projectors.length >= MAX_COLONY_PROJECTORS) break;
    }
    const nightFactor = nightMode ? 1.35 : lightsMode ? 0.95 : 0.25;
    updateColonyProjectorsAndVision({ projectors, visionSources: [], fovEnabled: false, nightFactor });
  }

  /** `work` = biped work-pose weight (`uWorkWeight`, 0..1). */
  tick(time: number, dt: number, turntable: boolean, row: boolean, work = 0, selectedId = '', lightsMode = false, nightMode = false, workTarget: InteractionTargetKind = 'tree') {
    if (turntable) this.content.rotation.y = row ? 0 : this.content.rotation.y + dt * 0.5; // rotate object(s), grid stays calibrated; rows stay readable
    this.syncProjectors(selectedId, lightsMode, nightMode);
    for (const s of this.spawns) tickArchetypeMesh(s.mesh, time, undefined, work);

    if (work > 0) {
      const sites: ActiveWorkSiteInput[] = this.spawns
        .filter((s) => s.id.startsWith('robot.') || !row)
        .map((s) => {
          const { x, y, z } = s.mesh.position;
          return {
            workerId: `pg:${s.id}`,
            targetKind: workTarget,
            botOrigin: [x, y, z],
            toolOrigins: computeMeshToolOrigins(s.mesh, s.id, 0, work),
            targetPos: [x, y + 0.36, z + 1.08],
            groundY: y,
            intensity: work,
          };
        });
      this.workParticles.syncSites(sites);
    } else {
      this.workParticles.syncSites([]);
    }
    this.workParticles.update(dt);
  }
}
