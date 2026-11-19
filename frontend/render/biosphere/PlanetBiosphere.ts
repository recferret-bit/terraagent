import * as THREE from 'three';
import { useVertebrateInstanceAttributes } from '../animation/vertebrates/instanceShader';
import { getVertebrateConfig, isVertebrateGeometry } from '../animation/vertebrates/rig';
import { VERTEBRATE_ANIMATION } from '../animation/vertebrates/shader';
import { getDayNightParams, isDayNightOn, wrapSolarHour } from '../core/dayNightConfig';
import { viewFocusBounded } from '../core/focusCull';
import { inViewFocus } from '../core/viewFocus';
import { ArchetypeCatalog } from '../kitbash';
import type { PlanetSpec } from '../planets/PlanetSpec';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';
import { useBiosphereInstanceAttributes } from '../visuals/unified/instancedBiosphere';
import {
  MAX_AQUATIC_THREATS,
  type AquaticThreatZone,
  type WaterFauna,
} from '../visuals/water/fauna';
import { BirdFlockSimulator } from './BirdFlockSim';
import { LandAnimalSimulator } from './LandAnimalSim';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  PlanetBiosphere,
} from './biosphereTypes';

interface SpeciesMeshSlot {
  mesh: THREE.InstancedMesh;
  bioAttr: THREE.InstancedBufferAttribute;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  depthMaterial: THREE.Material;
}

function computeSafeSleepDrop(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  const anim = geometry.getAttribute('aPartAnim');
  if (!pos || !anim) return 0.14;
  let minBodyY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const raw = Math.round(anim.getX(i));
    if (raw - Math.floor(raw / 10) * 10 === 8) {
      minBodyY = Math.min(minBodyY, pos.getY(i));
    }
  }
  return Number.isFinite(minBodyY) ? Math.max(0.05, Math.min(0.24, minBodyY - 0.02)) : 0;
}

function makeSpeciesMeshSlot(
  archetypeId: string,
  capacity: number,
  biomeName: 'desert' | 'temperate',
  sharedTimeU: THREE.IUniform<number>,
): SpeciesMeshSlot {
  const cap = Math.max(1, capacity);
  const geometry = ArchetypeCatalog.getGeometry(archetypeId).clone();
  const bioData = new Float32Array(cap * 4);
  const bioAttr = new THREE.InstancedBufferAttribute(bioData, 4);
  bioAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aBioState', bioAttr);

  const vertebrate = isVertebrateGeometry(geometry);
  const uni = createUnifiedColonyMaterial({
    biome: biomeName,
    shadowNormalBias: vertebrate ? 0.024 : 0,
    ...(vertebrate ? { plugins: [VERTEBRATE_ANIMATION] } : {}),
  });
  uni.uniforms.uTime = sharedTimeU;
  if (vertebrate) {
    const cfg = getVertebrateConfig(geometry);
    uni.uniforms.uVertParams?.value?.set(cfg.comY, cfg.sleepDrop, cfg.strideLen, cfg.liftHeight);
    uni.uniforms.uVertMeta?.value?.set(cfg.gaitFreq, cfg.isBird, cfg.headSleepPitch, 0);
    useVertebrateInstanceAttributes(uni.material, uni.depthMaterial);
  } else {
    useBiosphereInstanceAttributes(uni.material, uni.depthMaterial, computeSafeSleepDrop(geometry));
  }

  const mesh = new THREE.InstancedMesh(geometry, uni.material, cap);
  mesh.customDepthMaterial = uni.depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.name = `biosphere-${archetypeId}`;

  return {
    mesh,
    bioAttr,
    geometry,
    material: uni.material,
    depthMaterial: uni.depthMaterial,
  };
}

export interface CreatePlanetBiosphereOptions {
  look: PlanetSpec;
  habitat: BiosphereHabitatIndex;
  /** Optional swimming water fauna handle so fish/rays/jellies react to the same unified conqueror & battle threats. */
  waterFauna?: WaterFauna | null;
}

function buildAquaticThreatZones(
  aggressors: readonly BiosphereAggressor[],
  battles: readonly BiosphereBattleHotspot[],
  disturbances: readonly BiosphereBattleHotspot[],
  habitat: BiosphereHabitatIndex,
): AquaticThreatZone[] {
  const zones: AquaticThreatZone[] = [];
  for (const bat of battles) {
    zones.push({ x: bat.x, z: bat.z, radius: bat.radius + 10, strength: 1.35 });
  }
  for (const ds of disturbances) {
    zones.push({ x: ds.x, z: ds.z, radius: ds.radius + 8, strength: 1.15 });
  }
  for (const ag of aggressors) {
    zones.push({
      x: ag.x,
      z: ag.z,
      radius: (ag.radius ?? 11) + (ag.working ? 5 : 2),
      strength: ag.working ? 1.15 : 0.85,
    });
  }
  for (let i = 0; i < habitat.colonizedAnchors.length && zones.length < MAX_AQUATIC_THREATS; i += 4) {
    const col = habitat.colonizedAnchors[i]!;
    zones.push({ x: col.x, z: col.z, radius: 9, strength: 0.65 });
  }
  zones.sort((a, b) => b.strength - a.strength);
  return zones.slice(0, MAX_AQUATIC_THREATS);
}

interface TransformScratch {
  mat: THREE.Matrix4;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  euler: THREE.Euler;
  scale: THREE.Vector3;
}

function syncBirdMeshSlots(
  birdSlots: readonly SpeciesMeshSlot[],
  birdSim: BirdFlockSimulator,
  bounded: boolean,
  sc: TransformScratch,
): void {
  for (let slot = 0; slot < birdSlots.length; slot++) {
    const ms = birdSlots[slot]!;
    let drawn = 0;
    for (const flock of birdSim.flocks) {
      if (flock.speciesSlot !== slot) continue;
      for (const m of flock.members) {
        if (bounded && !inViewFocus(m.x, m.z, 18)) continue;
        sc.pos.set(m.x, m.y, m.z);
        sc.euler.set(m.pitch, m.yaw, m.roll, 'YXZ');
        sc.quat.setFromEuler(sc.euler);
        sc.scale.setScalar(m.scale);
        sc.mat.compose(sc.pos, sc.quat, sc.scale);
        ms.mesh.setMatrixAt(drawn, sc.mat);
        ms.bioAttr.setXYZW(drawn, m.phase, m.flapWeight, 0, 0);
        drawn++;
      }
    }
    ms.mesh.count = drawn;
    ms.mesh.visible = drawn > 0;
    if (drawn > 0) {
      ms.mesh.instanceMatrix.needsUpdate = true;
      ms.bioAttr.needsUpdate = true;
    }
  }
}

function syncAnimalMeshSlots(
  animalSlots: readonly SpeciesMeshSlot[],
  animalSim: LandAnimalSimulator,
  bounded: boolean,
  sc: TransformScratch,
): void {
  for (let slot = 0; slot < animalSlots.length; slot++) {
    const ms = animalSlots[slot]!;
    let drawn = 0;
    for (const a of animalSim.agents) {
      if (a.speciesSlot !== slot) continue;
      if (bounded && !inViewFocus(a.x, a.z, 14)) continue;
      sc.pos.set(a.x, a.y, a.z);
      sc.euler.set(0, a.yaw, 0, 'YXZ');
      sc.quat.setFromEuler(sc.euler);
      sc.scale.setScalar(a.scale);
      sc.mat.compose(sc.pos, sc.quat, sc.scale);
      ms.mesh.setMatrixAt(drawn, sc.mat);
      const spdRatio = Math.hypot(a.vx, a.vz) / Math.max(0.5, a.species.walkSpeed);
      const sprinting = a.state === 'FLEEING_AGGRESSOR' || a.state === 'FLEEING_PREDATOR' || (a.state === 'HUNTING' && spdRatio > 1.25);
      const walkOrRun = sprinting ? Math.min(2.0, spdRatio) : a.walkWeight;
      ms.bioAttr.setXYZW(drawn, a.phase, walkOrRun, a.workWeight, a.sleepCrouch);
      drawn++;
    }
    ms.mesh.count = drawn;
    ms.mesh.visible = drawn > 0;
    if (drawn > 0) {
      ms.mesh.instanceMatrix.needsUpdate = true;
      ms.bioAttr.needsUpdate = true;
    }
  }
}

function upsertHotspot(list: BiosphereBattleHotspot[], x: number, z: number, radius: number, ttl: number): void {
  const existing = list.find((h) => Math.hypot(h.x - x, h.z - z) < 8);
  if (existing) {
    existing.radius = Math.max(existing.radius, radius);
    existing.ttl = Math.max(existing.ttl, ttl);
  } else {
    list.push({ x, z, radius, ttl });
  }
}

function decayHotspots(list: BiosphereBattleHotspot[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i]!.ttl -= dt;
    if (list[i]!.ttl <= 0) list.splice(i, 1);
  }
}

function resolveSolarHour24(timeOverride01: number | null, elapsed: number): number {
  if (timeOverride01 !== null) return (((timeOverride01 % 1) + 1) % 1) * 24;
  const hour = getDayNightParams().timeOfDay;
  return isDayNightOn() ? wrapSolarHour(hour) : wrapSolarHour(hour + elapsed * 0.08);
}

export function createPlanetBiosphere(opts: CreatePlanetBiosphereOptions): PlanetBiosphere {
  const { look } = opts;
  let habitat = opts.habitat;
  const group = new THREE.Group();
  group.name = 'planetBiosphere';
  const sharedTimeU: THREE.IUniform<number> = { value: 0 };
  const biomeName: 'desert' | 'temperate' = look.kind === 'dune' ? 'desert' : 'temperate';

  const birdSim = new BirdFlockSimulator(look.kind, look.seed, habitat);
  const animalSim = new LandAnimalSimulator(look.kind, look.seed, habitat);

  const birdSlots = birdSim.speciesList.map((sp, slot) => {
    const cap = birdSim.flocks.filter((f) => f.speciesSlot === slot).reduce((sum, f) => sum + f.members.length, 0);
    const ms = makeSpeciesMeshSlot(sp.id, cap, biomeName, sharedTimeU);
    group.add(ms.mesh);
    return ms;
  });
  const animalSlots = animalSim.speciesList.map((sp, slot) => {
    const cap = animalSim.agents.filter((a) => a.speciesSlot === slot).length;
    const ms = makeSpeciesMeshSlot(sp.id, cap, biomeName, sharedTimeU);
    group.add(ms.mesh);
    return ms;
  });

  let aggressors: readonly BiosphereAggressor[] = [];
  const battles: BiosphereBattleHotspot[] = [];
  const disturbances: BiosphereBattleHotspot[] = [];
  let timeOverride01: number | null = null;
  let elapsed = 0;
  const scratch: TransformScratch = {
    mat: new THREE.Matrix4(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ'), scale: new THREE.Vector3(),
  };

  syncBirdMeshSlots(birdSlots, birdSim, false, scratch);
  syncAnimalMeshSlots(animalSlots, animalSim, false, scratch);

  return {
    group,
    birdMeshes: birdSlots.map((s) => s.mesh),
    animalMeshes: animalSlots.map((s) => s.mesh),
    counts() {
      let birdsTotal = 0;
      for (const f of birdSim.flocks) birdsTotal += f.members.length;
      return {
        birdSpecies: birdSim.speciesList.length, birdFlocks: birdSim.flocks.length, birdsTotal,
        landSpecies: animalSim.speciesList.length, landGroups: animalSim.groupCount, landAnimalsTotal: animalSim.agents.length,
      };
    },
    getBirdFlocks: () => birdSim.flocks,
    getLandAnimals: () => animalSim.agents,
    setAggressors(next) { aggressors = next; },
    noteBattleAt: (x, z, radius = 14, ttl = 6.0) => upsertHotspot(battles, x, z, radius, ttl),
    noteHabitatDisturbance: (x, z, radius = 14, ttl = 7.0) => upsertHotspot(disturbances, x, z, radius, ttl),
    setTimeOfDayOverride(time01) { timeOverride01 = time01; },
    onHabitatChanged(nextHabitat) { habitat = nextHabitat; },
    tick(dt) {
      const safeDt = Math.max(0, dt);
      elapsed += safeDt;
      sharedTimeU.value = elapsed;
      decayHotspots(battles, safeDt);
      decayHotspots(disturbances, safeDt);
      const solarHour24 = resolveSolarHour24(timeOverride01, elapsed);
      birdSim.step(safeDt, habitat, aggressors, battles, disturbances);
      animalSim.step(safeDt, solarHour24, habitat, aggressors, battles, disturbances);
      if (opts.waterFauna) {
        opts.waterFauna.setThreats(buildAquaticThreatZones(aggressors, battles, disturbances, habitat));
      }
      const bounded = viewFocusBounded();
      syncBirdMeshSlots(birdSlots, birdSim, bounded, scratch);
      syncAnimalMeshSlots(animalSlots, animalSim, bounded, scratch);
    },
    dispose() {
      for (const s of [...birdSlots, ...animalSlots]) {
        s.mesh.removeFromParent();
        s.mesh.dispose();
        s.geometry.dispose();
        s.material.dispose();
        s.depthMaterial.dispose();
      }
      battles.length = 0;
      disturbances.length = 0;
      group.removeFromParent();
    },
  };
}
