import * as THREE from 'three';
import { useVertebrateInstanceAttributes } from '../animation/vertebrates/instanceShader';
import { getVertebrateConfig, isVertebrateGeometry } from '../animation/vertebrates/rig';
import { VERTEBRATE_ANIMATION } from '../animation/vertebrates/shader';
import { LandAnimalSimulator } from '../biosphere/LandAnimalSim';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  LandAnimalAgent,
} from '../biosphere/biosphereTypes';
import { viewFocusBounded } from '../core/focusCull';
import { inViewFocus } from '../core/viewFocus';
import { ArchetypeCatalog } from '../kitbash';
import type { PlanetKind } from '../planets/PlanetSpec';
import type { PoolStats } from '../pools';
import '../visuals/biomes';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';
import { useBiosphereInstanceAttributes } from '../visuals/unified/instancedBiosphere';
import type { BiomeOrchestratorConfig } from './BiomeConfig';

interface AnimalSpeciesRenderSlot {
  readonly speciesId: string;
  readonly capacity: number;
  readonly mesh: THREE.InstancedMesh;
  readonly bioAttr: THREE.InstancedBufferAttribute;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly depthMaterial: THREE.Material;
}

function buildAnimalRenderSlot(
  speciesId: string,
  capacity: number,
  biomeKey: PlanetKind,
  sharedTimeU: THREE.IUniform<number>,
): AnimalSpeciesRenderSlot {
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
  } else {
    useBiosphereInstanceAttributes(uni.material, uni.depthMaterial, 0.14);
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
 * Sub-orchestrator managing pooled warm-blooded land mammals for the active planet biome ONLY.
 */
export class AnimalsOrchestrator {
  readonly sim: LandAnimalSimulator;
  readonly meshes: readonly THREE.InstancedMesh[];
  private readonly slots: readonly AnimalSpeciesRenderSlot[];
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
    prebuiltAgents?: readonly LandAnimalAgent[],
  ) {
    const { kind, seed } = config.planet;
    const activeSpecies = config.animals.enabled ? config.animals.species : [];
    this.sim = new LandAnimalSimulator(kind, seed, habitat, {
      groupsPerSpecies: config.animals.groupsPerType,
      speciesOverride: activeSpecies,
      prebuiltAgents: config.animals.enabled ? prebuiltAgents : [],
    });

    this.slots = this.sim.speciesList.map((sp) => {
      const minCap = Math.max(1, config.animals.groupsPerType * sp.groupSize[1]);
      const cap = Math.max(minCap, config.animals.pools[sp.id]?.threshold ?? minCap);
      const slot = buildAnimalRenderSlot(sp.id, cap, kind, sharedTimeU);
      parentGroup.add(slot.mesh);
      return slot;
    });
    this.meshes = this.slots.map((s) => s.mesh);
    this.syncMeshes(false);
  }

  get agents(): readonly LandAnimalAgent[] {
    return this.sim.agents;
  }

  counts(): { landSpecies: number; landGroups: number; landAnimalsTotal: number } {
    return {
      landSpecies: this.sim.speciesList.length,
      landGroups: this.sim.groupCount,
      landAnimalsTotal: this.sim.agents.length,
    };
  }

  step(
    dt: number,
    solarHour24: number,
    habitat: BiosphereHabitatIndex,
    aggressors: readonly BiosphereAggressor[],
    battles: readonly BiosphereBattleHotspot[],
    disturbances: readonly BiosphereBattleHotspot[],
  ): void {
    this.sim.step(dt, solarHour24, habitat, aggressors, battles, disturbances);
    this.syncMeshes(viewFocusBounded());
  }

  private syncMeshes(bounded: boolean): void {
    for (let slotIdx = 0; slotIdx < this.slots.length; slotIdx++) {
      const rs = this.slots[slotIdx]!;
      let drawn = 0;
      for (const a of this.sim.agents) {
        if (a.speciesSlot !== slotIdx) continue;
        if (drawn >= rs.capacity) break;
        if (bounded && !inViewFocus(a.x, a.z, 14)) continue;
        this.pos.set(a.x, a.y, a.z);
        this.euler.set(0, a.yaw, 0, 'YXZ');
        this.quat.setFromEuler(this.euler);
        this.scale.setScalar(a.scale);
        this.mat.compose(this.pos, this.quat, this.scale);
        rs.mesh.setMatrixAt(drawn, this.mat);
        const spdRatio = Math.hypot(a.vx, a.vz) / Math.max(0.5, a.species.walkSpeed);
        const sprinting =
          a.state === 'FLEEING_AGGRESSOR' ||
          a.state === 'FLEEING_PREDATOR' ||
          (a.state === 'HUNTING' && spdRatio > 1.25);
        const walkOrRun = sprinting ? Math.min(2.0, spdRatio) : a.walkWeight;
        rs.bioAttr.setXYZW(drawn, a.phase, walkOrRun, a.workWeight, a.sleepCrouch);
        drawn++;
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
