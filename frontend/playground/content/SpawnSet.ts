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
import { updateColonyProjectorsAndVision } from '@terra/render/lighting/ColonyVisionAndLights';
import {
  attachEntityProjectorRig,
  collectEntityProjectors,
  EntityProjectorRig,
  type EntityProjectorRigState,
} from '@terra/render/lighting/EntityProjectorRig';
import { getArchetypeLights } from '@terra/render/lighting/archetypeLights';
import { applyBuildingLight } from '@terra/render/lighting/buildingLights';
import {
  WorkParticleSystem,
  computeMeshToolOrigins,
  type ActiveWorkSiteInput,
  type InteractionTargetKind,
} from '@terra/render/particles';
import { applyHubPrestige, defaultHubTierForArchetype, hubUplinkBeam, isHubMesh } from '@terra/render/prestige/hubPrestige';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { VertebratePoseMode } from '../state';
import {
  createFloraMesh,
  getFloraEntry,
  isFloraId,
  listFloraEntries,
  type FloraGroup,
  type GroundObjectFamily,
} from './floraCatalog';

const GROUND_FAMILY_ORDER: readonly GroundObjectFamily[] = [
  'grassTuft', 'wildflower', 'bush', 'saguaro', 'barrelCactus', 'reeds', 'boulder', 'spire',
];
const TREE_BIOME_ORDER: readonly (PlanetKind | 'all')[] = ['forestRock', 'oceanForest', 'dune'];

function layoutGridLines(lines: Spawn[][], colPitch: number, rowPitch: number) {
  const halfRows = (lines.length - 1) / 2;
  lines.forEach((line, rowIdx) => {
    const z = (rowIdx - halfRows) * rowPitch;
    const halfCols = (line.length - 1) / 2;
    line.forEach((s, colIdx) => {
      s.mesh.position.set((colIdx - halfCols) * colPitch, 0, z);
    });
  });
}

function layoutSpawns(spawns: Spawn[], widths: number[]) {
  if (spawns.length > 1 && spawns.every((s) => getFloraEntry(s.id)?.group === 'ground')) {
    const lines = GROUND_FAMILY_ORDER
      .map((kind) => spawns.filter((s) => getFloraEntry(s.id)?.groundKind === kind))
      .filter((line) => line.length > 0);
    layoutGridLines(lines, 3.6, 3.2);
    return;
  }
  if (spawns.length > 1 && spawns.every((s) => getFloraEntry(s.id)?.group === 'tree')) {
    const lines = TREE_BIOME_ORDER
      .map((biome) => spawns.filter((s) => getFloraEntry(s.id)?.biomeHint === biome))
      .filter((line) => line.length > 0);
    layoutGridLines(lines, 5.8, 5.8);
    return;
  }
  const gap = 0.9;
  let x = -(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)) / 2;
  spawns.forEach((s, i) => {
    s.mesh.position.set(x + widths[i]! / 2, 0, 0);
    x += widths[i]! + gap;
  });
}

export interface Spawn {
  id: string;
  mesh: ArchetypeMesh;
  box: THREE.Box3;
  floraTimeU?: { value: number };
  floraDispose?: () => void;
}
const biomeToPlanet = (b: string): PlanetKind =>
  b === 'dune' || b === 'oceanForest' || b === 'forestRock'
    ? b
    : b === 'arid' ? 'dune' : b === 'tropical' ? 'oceanForest' : 'forestRock';
const footprint = (b: THREE.Box3) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1);

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
      if (s.floraDispose) {
        s.floraDispose();
        continue;
      }
      // every robot / building mesh carries a projector rig (cones, pools, lenses, halo): free it with the model
      (s.mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig?.dispose();
      hubUplinkBeam(s.mesh)?.dispose();
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.spawns = [];
  }

  /** Spawn `ids` side by side, centred on the origin. */
  rebuild(ids: string[], biomeKey: string, wire: boolean, depositStage: DepositVisualStage = 'full') {
    this.dispose();
    const widths: number[] = [];
    const planet = biomeToPlanet(biomeKey);
    for (const id of ids) {
      if (isFloraId(id)) {
        try {
          const built = createFloraMesh(id, planet, 17);
          built.mesh.geometry.computeBoundingBox();
          const box = built.mesh.geometry.boundingBox!.clone();
          widths.push(footprint(box));
          this.spawns.push({ id, mesh: built.mesh as unknown as ArchetypeMesh, box, floraTimeU: built.timeU, floraDispose: built.dispose });
          this.content.add(built.mesh);
        } catch (e) { console.error('flora build failed', id, e); }
        continue;
      }
      let mesh: ArchetypeMesh;
      try { mesh = createArchetypeMesh(id, biomeKey, depositStage); } catch (e) { console.error('archetype build failed', id, e); continue; }
      const defaultTier = defaultHubTierForArchetype(id);
      if (defaultTier > 0) applyHubPrestige(mesh, defaultTier);
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone();
      widths.push(footprint(box));
      this.spawns.push({ id, mesh, box });
      this.content.add(mesh);
    }
    layoutSpawns(this.spawns, widths);
    this.applyWire(wire);
    this.refreshLights();
    this.content.rotation.y = 0;
  }

  idsFor(row: ArchetypeCategory | null, id: string, floraRow: FloraGroup | null = null): string[] {
    if (floraRow) return listFloraEntries(floraRow).map((e) => e.id);
    if (!row) return id ? [id] : [];
    const base = ArchetypeCatalog.list(row).map((e) => e.id);
    return row === 'fauna' ? [...base, ...ArchetypeCatalog.listBiosphere().map((e) => e.id)] : base;
  }

  applyWire(wire: boolean) { for (const s of this.spawns) (s.mesh.material as THREE.MeshStandardMaterial).wireframe = wire; }

  /** Construction scaffold stage of every shown archetype (1 = complete). */
  applyBuild(stage: number) { for (const s of this.spawns) if (!s.floraDispose) setArchetypeBuildProgress(s.mesh, stage); }

  /** Ruin variant (W18-22: charred, cracked, unlit) of every shown archetype. */
  applyRuin(ruin: boolean) { for (const s of this.spawns) if (!s.floraDispose) setArchetypeRuin(s.mesh, ruin); }

  /** Staking prestige (W28-12): dress every shown Command Hub for `tier` (dish, gold trim, uplink beam). Null: restore each hub's default tier. */
  applyStakeTier(tier: number | null) {
    for (const s of this.spawns) {
      if (!isHubMesh(s.mesh)) continue;
      applyHubPrestige(s.mesh, tier ?? defaultHubTierForArchetype(s.id));
      s.mesh.geometry.computeBoundingBox();
      s.box = s.mesh.geometry.boundingBox!.clone();
    }
  }

  /** Actual catalog id currently worn by the spawned mesh for `id` (reflects hub stake-tier swaps). */
  resolvedId(id: string): string {
    const s = this.find(id);
    const active = s && !s.floraDispose ? (s.mesh.userData as { archetypeId?: string }).archetypeId : undefined;
    return active ?? id;
  }

  find(id: string) { return this.spawns.find((s) => s.id === id); }

  updateRing(id: string, row: ArchetypeCategory | boolean | null) {
    const s = this.find(id);
    this.ring.visible = !!s && !!row;
    if (!s) return;
    this.ring.scale.setScalar(footprint(s.box) * 0.62);
    this.ring.position.set(s.mesh.position.x, 0.006, s.mesh.position.z);
  }

  minX() { return this.spawns.length ? Math.min(...this.spawns.map((s) => s.mesh.position.x + s.box.min.x)) : 0; }

  bounds(id: string, row: ArchetypeCategory | boolean | null) {
    const box = new THREE.Box3();
    if (!this.spawns.length) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
    for (const s of row ? this.spawns : this.spawns.filter((s) => s.id === id)) box.union(s.box.clone().translate(s.mesh.position));
    return box;
  }

  /** Rebuild 3D projector rigs on spawned meshes after light source edits. */
  refreshLights(archetypeId?: string) {
    for (const s of this.spawns) {
      if (s.floraDispose) continue;
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

  /** Bulbs and beams follow the day/night switch. A ruin stays dark. */
  private applyNightLights(nightMode: boolean): void {
    const level = nightMode ? 1 : 0;
    const power = nightMode ? 1.35 : 0;
    for (const s of this.spawns) {
      applyBuildingLight(s.mesh, isArchetypeRuin(s.mesh) ? 0 : level, isArchetypeRuin(s.mesh) ? 0 : power);
    }
  }

  private syncProjectors(selectedId: string, nightMode: boolean) {
    this.applyNightLights(nightMode);
    if (!nightMode) {
      updateColonyProjectorsAndVision({ projectors: [], visionSources: [], fovEnabled: false, nightFactor: 0 });
      return;
    }
    this.content.updateMatrixWorld(true);
    const ordered = selectedId
      ? [...this.spawns.filter((s) => s.id === selectedId), ...this.spawns.filter((s) => s.id !== selectedId)]
      : this.spawns;
    const active = ordered
      .filter((s) => !s.floraDispose && !isArchetypeRuin(s.mesh))
      .map((s) => ({ archetypeId: s.id, mesh: s.mesh }));
    const projectors = collectEntityProjectors(active, 1.35);
    updateColonyProjectorsAndVision({ projectors, visionSources: [], fovEnabled: false, nightFactor: 1.35 });
  }

  /** `work` = biped work-pose weight (`uWorkWeight`, 0..1); `pose` overrides vertebrate behavioral animation state. */
  tick(time: number, dt: number, turntable: boolean, row: boolean, work = 0, selectedId = '', nightMode = false, workTarget: InteractionTargetKind = 'tree', pose: VertebratePoseMode = 'auto', syncLights = true) {
    if (turntable) this.content.rotation.y = row ? 0 : this.content.rotation.y + dt * 0.5; // rotate object(s), grid stays calibrated; rows stay readable
    if (syncLights) this.syncProjectors(selectedId, nightMode);
    for (const s of this.spawns) {
      if (s.floraTimeU) { s.floraTimeU.value = time; continue; }
      if (s.floraDispose) continue;
      const u = s.mesh.userData?.uniforms as Record<string, THREE.IUniform<number | THREE.Vector4>> | undefined;
      if (u?.uVertParams && u?.uVertMeta) {
        const isBird = (u.uVertMeta.value as THREE.Vector4).y > 0.5;
        let walkV = isBird ? 1.0 : (work > 0 ? 0 : 1.0);
        let runV = 0;
        let workV = work;
        let sleepV = 0;
        if (pose === 'idle') { walkV = 0; workV = 0; }
        else if (pose === 'walk' || pose === 'flap') { walkV = 1; workV = 0; }
        else if (pose === 'run') { walkV = 1; runV = 1; workV = 0; }
        else if (pose === 'graze') { walkV = 0; workV = 1; }
        else if (pose === 'sleep') { walkV = 0; sleepV = 1; workV = 0; }
        else if (pose === 'glide') { walkV = 0.16; workV = 0; }
        tickArchetypeMesh(s.mesh, time, walkV, workV);
        if (u.uVertRun) u.uVertRun.value = runV;
        if (u.uVertSleep) u.uVertSleep.value = sleepV;
      } else {
        tickArchetypeMesh(s.mesh, time, undefined, work);
      }
    }

    if (work > 0) {
      const sites: ActiveWorkSiteInput[] = this.spawns
        .filter((s) => !s.floraDispose && (s.id.startsWith('robot.') || !row))
        .map((s) => {
          const { x, y, z } = s.mesh.position;
          return {
            workerId: `pg:${s.id}`,
            targetKind: workTarget,
            botOrigin: [x, y, z],
            toolOrigins: computeMeshToolOrigins(s.mesh, s.id, 0, work),
            targetPos: [x, y + 0.36, z + 1.95],
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
