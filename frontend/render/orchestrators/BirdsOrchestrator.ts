import * as THREE from 'three';
import { useVertebrateInstanceAttributes } from '../animation/vertebrates/instanceShader';
import { getVertebrateConfig, isVertebrateGeometry } from '../animation/vertebrates/rig';
import { VERTEBRATE_ANIMATION } from '../animation/vertebrates/shader';
import { BirdFlockSimulator } from '../biosphere/BirdFlockSim';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  BirdFlock,
} from '../biosphere/biosphereTypes';
import { viewFocusBounded } from '../core/focusCull';
import { inViewFocus } from '../core/viewFocus';
import { ArchetypeCatalog } from '../kitbash';
import type { PlanetKind } from '../planets/PlanetSpec';
import type { PoolStats } from '../pools';
import '../visuals/biomes';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';
import type { BiomeOrchestratorConfig } from './BiomeConfig';

interface BirdSpeciesRenderSlot {
  readonly speciesId: string;
  readonly capacity: number;
  readonly mesh: THREE.InstancedMesh;
  readonly bioAttr: THREE.InstancedBufferAttribute;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly depthMaterial: THREE.Material;
}

function buildBirdRenderSlot(
  speciesId: string,
  capacity: number,
  biomeKey: PlanetKind,
  sharedTimeU: THREE.IUniform<number>,
): BirdSpeciesRenderSlot {
  const cap = Math.max(1, capacity);
  const geometry = ArchetypeCatalog.getGeometry(speciesId).clone();
  const bioAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  bioAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aBioState', bioAttr);

  const vertebrate = isVertebrateGeometry(geometry);
  const uni = createUnifiedColonyMaterial({
    biome: biomeKey,
    shadowNormalBias: vertebrate ? 0.024 : 0,
    ...(vertebrate ? { plugins: [VERTEBRATE_ANIMATION] } : {}),
  });
  uni.uniforms.uTime = sharedTimeU;
  if (vertebrate) {
    const cfg = getVertebrateConfig(geometry);
    uni.uniforms.uVertParams?.value?.set(cfg.comY, cfg.sleepDrop, cfg.strideLen, cfg.liftHeight);
    uni.uniforms.uVertMeta?.value?.set(cfg.gaitFreq, cfg.isBird, cfg.headSleepPitch, cfg.birdSize ?? 0);
    useVertebrateInstanceAttributes(uni.material, uni.depthMaterial);
  }

  const mesh = new THREE.InstancedMesh(geometry, uni.material, cap);
  mesh.customDepthMaterial = uni.depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.name = `biosphere-${speciesId}`;
  return { speciesId, capacity: cap, mesh, bioAttr, geometry, material: uni.material, depthMaterial: uni.depthMaterial };
}

/**
 * Sub-orchestrator managing pooled endemic bird flocks for the active planet biome ONLY.
 * Pre-allocates `groupsPerType` (default `2`) flocks per bird species once at level load,
 * disables per-bird collision checks, drives size-dependent wing animation, and never spawns/deletes birds at runtime.
 */
export class BirdsOrchestrator {
  readonly sim: BirdFlockSimulator;
  readonly meshes: readonly THREE.InstancedMesh[];
  private readonly slots: readonly BirdSpeciesRenderSlot[];
  private readonly mat = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scale = new THREE.Vector3();

  constructor(
    config: BiomeOrchestratorConfig,
    habitat: BiosphereHabitatIndex,
    parentGroup: THREE.Group,
    sharedTimeU: THREE.IUniform<number>,
    prebuiltFlocks?: readonly BirdFlock[],
  ) {
    const { kind, seed } = config.planet;
    const activeSpecies = config.birds.enabled ? config.birds.species : [];
    this.sim = new BirdFlockSimulator(kind, seed, habitat, {
      groupsPerSpecies: config.birds.groupsPerType,
      speciesOverride: activeSpecies,
      prebuiltFlocks: config.birds.enabled ? prebuiltFlocks : [],
    });

    this.slots = this.sim.speciesList.map((sp) => {
      const minCap = config.birds.groupsPerType * sp.flockSize[1];
      const cap = Math.max(minCap, config.birds.pools[sp.id]?.threshold ?? minCap);
      const slot = buildBirdRenderSlot(sp.id, cap, kind, sharedTimeU);
      parentGroup.add(slot.mesh);
      return slot;
    });
    this.meshes = this.slots.map((s) => s.mesh);
    this.syncMeshes(false);
  }

  get flocks(): readonly BirdFlock[] {
    return this.sim.flocks;
  }

  counts(): { birdSpecies: number; birdFlocks: number; birdsTotal: number } {
    let birdsTotal = 0;
    for (const f of this.sim.flocks) birdsTotal += f.members.length;
    return {
      birdSpecies: this.sim.speciesList.length,
      birdFlocks: this.sim.flocks.length,
      birdsTotal,
    };
  }

  step(
    dt: number,
    habitat: BiosphereHabitatIndex,
    aggressors: readonly BiosphereAggressor[],
    battles: readonly BiosphereBattleHotspot[],
    disturbances: readonly BiosphereBattleHotspot[],
  ): void {
    this.sim.step(dt, habitat, aggressors, battles, disturbances);
    this.syncMeshes(viewFocusBounded());
  }

  private syncMeshes(bounded: boolean): void {
    for (let slotIdx = 0; slotIdx < this.slots.length; slotIdx++) {
      const rs = this.slots[slotIdx]!;
      let drawn = 0;
      for (const flock of this.sim.flocks) {
        if (flock.speciesSlot !== slotIdx) continue;
        for (const m of flock.members) {
          if (drawn >= rs.capacity) break;
          // Pad ground-plane focus by altitude * cot(camera/sun elevation) so high-flying birds & cast shadows never pop mid-screen.
          if (bounded && !inViewFocus(m.x, m.z, 24 + Math.max(0, m.y) * 2.5)) continue;
          this.pos.set(m.x, m.y, m.z);
          this.euler.set(m.pitch, m.yaw, m.roll, 'YXZ');
          this.quat.setFromEuler(this.euler);
          this.scale.setScalar(m.scale);
          this.mat.compose(this.pos, this.quat, this.scale);
          rs.mesh.setMatrixAt(drawn, this.mat);
          rs.bioAttr.setXYZW(drawn, m.phase, m.flapWeight, 0, 0);
          drawn++;
        }
      }
      rs.mesh.count = drawn;
      rs.mesh.visible = drawn > 0;
      if (drawn > 0) {
        rs.mesh.instanceMatrix.needsUpdate = true;
        rs.bioAttr.needsUpdate = true;
      }
    }
  }

  poolStats(): PoolStats[] {
    return [...this.sim.pools.values()].map((p) => p.stats());
  }

  dispose(): void {
    for (const s of this.slots) {
      s.mesh.removeFromParent();
      s.mesh.dispose();
      s.geometry.dispose();
      s.material.dispose();
      s.depthMaterial.dispose();
    }
    this.sim.dispose();
  }
}
