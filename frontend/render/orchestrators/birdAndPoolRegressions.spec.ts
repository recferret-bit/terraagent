import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hexIndex } from '@terra/sim/grid/hex';
import { getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { BirdFlockSimulator } from '../biosphere/BirdFlockSim';
import { computeFormationSlotTangent, wrapAngleDelta } from '../biosphere/birdFormations';
import type { AvianFormationStyle, BirdFlock } from '../biosphere/biosphereTypes';
import { buildHexHabitatIndex } from '../biosphere/habitatIndex';
import { getWeaponRig } from '../combat/WeaponRig';
import { createArchetypeMesh, setArchetypeBuildProgress, setArchetypeRuin } from '../kitbash';
import { attachEntityProjectorRig, getArchetypeLights, resetArchetypeLights, setArchetypeLights } from '../lighting';
import { PLANET_SPECS, type PlanetKind } from '../planets/PlanetSpec';
import {
  createHexTerrain,
  createHexTerrainInWorker,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
} from '../planets/hex';
import { PooledMeshEntry, resolveRockNodePoolThreshold } from '../pools';
import {
  buildBiomeOrchestratorConfig,
  BuildingsOrchestrator,
  BugsOrchestrator,
  serializeBiomeOrchestratorConfig,
  UnitsOrchestrator,
} from './index';

function auditBiomeFlocks(
  biome: PlanetKind,
  r: number,
  tiles: { terrain: Uint8Array; prep: Uint8Array; height: Float32Array },
  seenFormations: Set<AvianFormationStyle>,
  seenKettleDirs: Set<number>,
): { sawOppositeKettle: boolean; minKettleCos: number; minAllCos: number } {
  const look = PLANET_SPECS[biome];
  const hab = buildHexHabitatIndex(r, { ...tiles, kind: biome, seed: look.seed }, look, () => 0.25);
  const sim = new BirdFlockSimulator(biome, 2026, hab);
  const dt = 1 / 30;
  let elapsed = 0;
  let sawOppositeKettle = false;
  let minKettleCos = 1;
  let minAllCos = 1;

  for (let stepIdx = 0; stepIdx < 210; stepIdx++) {
    const prevYaws = sim.flocks.map((f) => f.members.map((m) => m.yaw));
    const prevRolls = sim.flocks.map((f) => f.members.map((m) => m.roll));
    sim.step(dt, hab, [], []);
    elapsed += dt;
    if (stepIdx < 30) continue;

    sim.flocks.forEach((f: BirdFlock, fi: number) => {
      seenFormations.add(f.formation!);
      if (f.formation === 'thermalKettle') seenKettleDirs.add(f.orbitDir ?? 1);
      const leader = f.members[0]!;
      const lSpd = Math.hypot(leader.vx, leader.vz) || 1;
      f.members.forEach((m, mi) => {
        expect(Math.abs(wrapAngleDelta(m.yaw - prevYaws[fi]![mi]!))).toBeLessThanOrEqual(2.3 * dt + 1e-4);
        expect(Math.abs(m.roll - prevRolls[fi]![mi]!)).toBeLessThan(0.20);
        const spd = Math.hypot(m.vx, m.vz);
        expect(spd).toBeGreaterThan(f.species.speed * 0.55);
        const [tanX, tanZ] = computeFormationSlotTangent(f, mi, f.orbitAngle, elapsed, f.cruiseBaseY ?? 0.25, f.anchorX, f.anchorZ);
        const cosToOwnSlot = (m.vx * tanX + m.vz * tanZ) / spd;
        minAllCos = Math.min(minAllCos, cosToOwnSlot);
        if (f.formation === 'thermalKettle' && mi >= 1) {
          minKettleCos = Math.min(minKettleCos, cosToOwnSlot);
          if ((m.vx * leader.vx + m.vz * leader.vz) / (spd * lSpd) < -0.65) sawOppositeKettle = true;
        }
      });
    });
  }
  sim.dispose();
  return { sawOppositeKettle, minKettleCos, minAllCos };
}

describe('All 8 Bird Formations & Thermal Kettle Opposite-Circle Tangents', () => {
  it('aligns thermalKettle members on both orbitDir=+1/-1 across 360° and bounds angular rates across all 8 formations', () => {
    const r = 18;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    for (let i = 0; i < hx.count; i++) {
      const q = hx.q[i]!, rr = hx.r[i]!;
      if (q < -r / 2) terrain[i] = HEX_TERRAIN.deep;
      else if ((q + rr) % 3 === 0) terrain[i] = HEX_TERRAIN.forest;
      else if ((q - rr) % 5 === 0) terrain[i] = HEX_TERRAIN.rock;
    }
    const tiles = { terrain, prep: new Uint8Array(hx.count).fill(HEX_PREP.wild), height: new Float32Array(hx.count).fill(0.25) };
    const seenFormations = new Set<AvianFormationStyle>();
    const seenKettleDirs = new Set<number>();
    let sawOpposite = false;
    let minKettleCos = 1;
    let minAllCos = 1;

    for (const biome of ['forestRock', 'oceanForest', 'dune'] as const) {
      const res = auditBiomeFlocks(biome, r, tiles, seenFormations, seenKettleDirs);
      sawOpposite ||= res.sawOppositeKettle;
      minKettleCos = Math.min(minKettleCos, res.minKettleCos);
      minAllCos = Math.min(minAllCos, res.minAllCos);
    }

    expect([...seenFormations].sort()).toEqual([
      'canopyCarousel', 'jEchelon', 'murmurationRibbon', 'pelotonWave',
      'ridgeSweep', 'tandemPair', 'thermalKettle', 'veeEchelon',
    ]);
    expect(seenKettleDirs).toEqual(new Set([1, -1]));
    expect(sawOpposite).toBe(true);
    expect(minKettleCos).toBeGreaterThan(0.92);
    expect(minAllCos).toBeGreaterThan(0.60);
  });
});

describe('Bird Threat Relocation Smooth Anchor Glide', () => {
  it('glides anchorX/anchorZ smoothly toward targetX/targetZ on battle, forest & aggressor threats with zero single-frame jump', () => {
    const r = 18;
    const hx = hexIndex(r);
    const tiles = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.forest),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
      height: new Float32Array(hx.count).fill(0.2),
    };
    const look = PLANET_SPECS.forestRock;
    const hab = buildHexHabitatIndex(r, { ...tiles, kind: look.kind, seed: look.seed }, look, () => 0.2);
    const sim = new BirdFlockSimulator('forestRock', 99, hab);

    const kettleFlock = sim.flocks.find((f) => f.formation === 'thermalKettle')!;
    const startAnchorX = kettleFlock.anchorX!, startAnchorZ = kettleFlock.anchorZ!;
    const beforePos = kettleFlock.members.map((m) => [m.x, m.z] as const);
    const l0 = kettleFlock.members[0]!;
    const dt = 1 / 30;

    sim.step(dt, hab, [], [{ x: l0.x + 1, z: l0.z + 1, radius: 14, ttl: 5.5 }]);
    expect(kettleFlock.state).toBe('FLEEING_BATTLE');
    expect(Math.hypot(kettleFlock.targetX - startAnchorX, kettleFlock.targetZ - startAnchorZ)).toBeGreaterThan(10);

    const maxFleeSpeed = kettleFlock.species.speed * 1.55;
    expect(Math.hypot(kettleFlock.anchorX! - startAnchorX, kettleFlock.anchorZ! - startAnchorZ)).toBeLessThanOrEqual(maxFleeSpeed * 0.40 * dt + 1e-4);
    kettleFlock.members.forEach((m, i) => {
      expect(Math.hypot(m.x - beforePos[i]![0], m.z - beforePos[i]![1])).toBeLessThanOrEqual(maxFleeSpeed * 1.42 * dt + 1e-4);
    });

    let prevAx = kettleFlock.anchorX!, prevAz = kettleFlock.anchorZ!;
    for (let k = 0; k < 165; k++) {
      sim.step(dt, hab, [], []);
      expect(Math.hypot(kettleFlock.anchorX! - prevAx, kettleFlock.anchorZ! - prevAz)).toBeLessThanOrEqual(maxFleeSpeed * 0.40 * dt + 1e-4);
      prevAx = kettleFlock.anchorX!;
      prevAz = kettleFlock.anchorZ!;
    }
    expect(Math.hypot(kettleFlock.anchorX! - kettleFlock.targetX, kettleFlock.anchorZ! - kettleFlock.targetZ)).toBeLessThan(2.5);
    sim.dispose();
  });
});

describe('GroundObjectsOrchestrator rockNodePool & Biome Prewarming / Pruning', () => {
  it('pools rock nodes with acquire-before-release, prewarms BugsOrchestrator on level load, and prunes stale biomes', () => {
    const r = 14;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    let firstRockTile = -1;
    for (let i = 0; i < hx.count; i++) {
      if ((hx.q[i]! - hx.r[i]!) % 4 === 0 && Math.abs(hx.q[i]!) < r - 2 && Math.abs(hx.r[i]!) < r - 2) {
        terrain[i] = HEX_TERRAIN.rock;
        if (firstRockTile < 0) firstRockTile = i;
      }
    }
    const tiles = { terrain, prep: new Uint8Array(hx.count).fill(HEX_PREP.wild), height: new Float32Array(hx.count).fill(0.3) };
    const ht = createHexTerrain({ radius: r, tiles, look: PLANET_SPECS.forestRock });
    const bo = ht.biomeOrchestrator;

    for (const st of bo.poolStats().bugs) {
      expect(st.allocated).toBeGreaterThanOrEqual(st.initialSize);
      expect(st.initialSize).toBeGreaterThan(0);
      expect(st.key).toContain('forestRock:');
    }

    const rockPoolStat = bo.poolStats().groundObjects.find((s) => s.key === 'groundObject:rockNode')!;
    expect(rockPoolStat.threshold).toBe(resolveRockNodePoolThreshold(r));
    expect(rockPoolStat.active).toBeGreaterThan(0);

    const snapBefore = ht.props.instancesForTile(firstRockTile);
    expect(snapBefore.length).toBeGreaterThan(0);
    const savedX = snapBefore[0]!.x;
    const savedTileIdx = snapBefore[0]!.tileIndex;

    ht.setTileState(hx.q[firstRockTile]!, hx.r[firstRockTile]!, HEX_TERRAIN.rock, HEX_PREP.wild, 0.75);
    expect(snapBefore[0]!.tileIndex).toBe(savedTileIdx);
    expect(snapBefore[0]!.x).toBe(savedX);
    expect(snapBefore[0]!.y).not.toBe(0.75);

    ht.setTileState(hx.q[firstRockTile]!, hx.r[firstRockTile]!, HEX_TERRAIN.flat, HEX_PREP.prepared, 0.3);
    expect(bo.groundObjectsOrchestrator.rockNodePool.stats().reuseHits).toBeGreaterThan(0);
    ht.dispose();

    const group = new THREE.Group();
    const buildings = new BuildingsOrchestrator(group, { biomeKey: 'forestRock', prewarmOnInit: true });
    const units = new UnitsOrchestrator(group, { biomeKey: 'forestRock', prewarmOnInit: true });
    const bugs = new BugsOrchestrator(group, { biomeKey: 'forestRock', prewarmOnInit: true });
    buildings.prewarmForBiome('dune');
    units.prewarmForBiome('dune');
    bugs.prewarmForBiome('dune');
    expect(buildings.poolStats().every((s) => s.key.startsWith('building:dune:'))).toBe(true);
    expect(units.poolStats().every((s) => s.key.startsWith('unit:dune:'))).toBe(true);
    expect(bugs.poolStats().every((s) => s.key.startsWith('bug:dune:'))).toBe(true);
    buildings.dispose();
    units.dispose();
    bugs.dispose();
  });
});

describe('PooledMeshEntry Immediate Release Reset & Zero-Light ProjectorRig Disposal', () => {
  it('resets state immediately on release() before parkMesh() and disposes zero-light EntityProjectorRig materials', () => {
    let disposedRigMats = 0;
    setArchetypeLights('building.solar', []);
    try {
      expect(getArchetypeLights('building.solar')).toHaveLength(0);
      const solarMesh = createArchetypeMesh('building.solar', 'dune');
      const solarRig = attachEntityProjectorRig(solarMesh, 'building.solar')!;
      expect(solarRig.group.children).toHaveLength(0);
      const solarHaloMat = (solarRig as unknown as { haloMat: THREE.Material }).haloMat;
      for (const mat of [solarRig.beamMat, solarRig.poolMat, solarRig.lensMat, solarHaloMat]) {
        mat.addEventListener('dispose', () => { disposedRigMats++; });
      }
      const solarEntry = new PooledMeshEntry('building:dune:building.solar', 0, 'building.solar', 'dune', solarMesh);
      solarEntry.dispose();
      expect(disposedRigMats).toBe(4);
    } finally {
      resetArchetypeLights('building.solar');
    }

    const capMesh = createArchetypeMesh('building.capacitor', 'dune');
    const rig = attachEntityProjectorRig(capMesh, 'building.capacitor')!;
    rig.rebuild([]);
    const haloMat = (rig as unknown as { haloMat: THREE.Material }).haloMat;
    for (const mat of [rig.beamMat, rig.poolMat, rig.lensMat, haloMat]) {
      mat.addEventListener('dispose', () => { disposedRigMats++; });
    }
    const capEntry = new PooledMeshEntry('building:dune:building.capacitor', 0, 'building.capacitor', 'dune', capMesh);
    capEntry.acquire();
    setArchetypeRuin(capMesh, 1);
    setArchetypeBuildProgress(capMesh, 0.33);
    capMesh.userData.uniforms.uSelected.value = 1;
    capMesh.userData.uniforms.uSelectionTime = { value: 12.5 };
    (capMesh.material as THREE.MeshStandardMaterial).color.setHex(0xb8a0ff);

    capEntry.release();
    expect(capMesh.userData.uniforms.uSelected.value).toBe(0);
    expect(capMesh.userData.uniforms.uSelectionTime.value).toBe(0);
    expect(capMesh.userData.uniforms.uRuin.value).toBe(0);
    expect(capMesh.userData.uniforms.uBuildStage.value).toBe(1);
    expect((capMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    capEntry.dispose();
    expect(disposedRigMats).toBe(8);

    const antMesh = createArchetypeMesh('fauna.blackAnt', 'dune');
    const antEntry = new PooledMeshEntry('bug:dune:fauna.blackAnt', 0, 'fauna.blackAnt', 'dune', antMesh);
    antEntry.acquire();
    getInsectAnimator(antMesh)!.die();
    antEntry.release();
    expect(getInsectAnimator(antMesh)!.state).toBe('idle');
    antEntry.dispose();

    const turretMesh = createArchetypeMesh('building.turret', 'dune');
    const turretEntry = new PooledMeshEntry('building:dune:building.turret', 0, 'building.turret', 'dune', turretMesh);
    turretEntry.acquire();
    getWeaponRig(turretMesh)!.fire(new THREE.Vector3(10, 0, 10), 0.5, true);
    turretEntry.release();
    expect(turretMesh.userData.uniforms.uWeaponEnabled.value).toBe(0);
    turretEntry.dispose();
  });
});

describe('Degenerate Tiny-Orbit JSON Overrides, Disabled Sub-Orchestrators & Standalone Biome Pool Retention', () => {
  it('prevents Frenet cusps and InstancedMesh buffer overflows on orbitRadius=2, flockSize=[9,9] JSON overrides', () => {
    const r = 12;
    const hx = hexIndex(r);
    const tiles = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.forest),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
      height: new Float32Array(hx.count).fill(0.25),
    };
    const base = buildBiomeOrchestratorConfig(PLANET_SPECS.forestRock, r);
    const customJson = JSON.stringify({
      ...base,
      planet: { ...base.planet, seed: 0 },
      terrain: { ...base.terrain, dirtyReach: 4 },
      birds: {
        ...base.birds,
        pools: undefined,
        species: base.birds.species.map((sp) =>
          sp.id === 'fauna.bird.mountainCrane' || sp.id === 'fauna.bird.alpineRaven'
            ? { ...sp, orbitRadius: 2, flockSize: [9, 9] }
            : sp,
        ),
      },
      animals: {
        ...base.animals,
        pools: undefined,
        species: base.animals.species.map((sp) =>
          sp.id === 'fauna.crownStag' ? { ...sp, groupSize: [8, 8] } : sp,
        ),
      },
    });

    const ht = createHexTerrain({ radius: r, tiles, look: PLANET_SPECS.forestRock, biomeConfigJson: customJson });
    expect(ht.biomeOrchestrator.config.planet.seed).toBeGreaterThan(0);
    expect(ht.biomeOrchestrator.config.terrain.dirtyReach).toBe(4);
    for (const im of [...ht.biosphere.birdMeshes, ...ht.biosphere.animalMeshes]) {
      const bioAttr = im.geometry.getAttribute('aBioState') as THREE.InstancedBufferAttribute;
      expect(im.count).toBeLessThanOrEqual(im.instanceMatrix.count);
      expect(im.count).toBeLessThanOrEqual(bioAttr.count);
    }

    let minTinyOrbitCos = 1;
    let elapsed = 0;
    const dt = 1 / 30;
    for (let step = 0; step < 150; step++) {
      ht.tick(dt);
      elapsed += dt;
      if (step < 25) continue;
      for (const f of ht.biosphere.getBirdFlocks()) {
        if (f.species.orbitRadius !== 2) continue;
        f.members.forEach((m, mi) => {
          const spd = Math.hypot(m.vx, m.vz);
          expect(spd).toBeGreaterThan(f.species.speed * 0.55);
          const [tx, tz] = computeFormationSlotTangent(f, mi, f.orbitAngle, elapsed, f.cruiseBaseY ?? 0.25, f.anchorX, f.anchorZ);
          minTinyOrbitCos = Math.min(minTinyOrbitCos, (m.vx * tx + m.vz * tz) / spd);
        });
      }
    }
    expect(minTinyOrbitCos).toBeGreaterThan(0.60);
    ht.dispose();
  });
});

describe('Disabled Sub-Orchestrators in Worker Hydration & Standalone Biome Pool Retention', () => {
  it('honors enabled:false across all biome sub-orchestrators in Worker hydration and retains standalone non-default biome pools', async () => {
    const r = 8;
    const hx = hexIndex(r);
    const deposit = new Uint8Array(hx.count).fill(HEX_DEPOSIT.metals);
    const tiles = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.rock),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
      height: new Float32Array(hx.count).fill(0.3),
      deposit,
      richness: new Uint16Array(hx.count).fill(10000),
    };
    const base = buildBiomeOrchestratorConfig(PLANET_SPECS.dune, r);
    const disabledJson = serializeBiomeOrchestratorConfig({
      ...base,
      trees: { ...base.trees, enabled: false },
      groundObjects: { ...base.groundObjects, enabled: false },
      resources: { ...base.resources, enabled: false },
      birds: { ...base.birds, enabled: false },
      animals: { ...base.animals, enabled: false },
      bugs: { ...base.bugs, enabled: false },
    });

    const ht = await createHexTerrainInWorker({ radius: r, tiles, look: PLANET_SPECS.dune, biomeConfigJson: disabledJson });
    expect(ht.biosphere.counts()).toEqual({
      birdSpecies: 0, birdFlocks: 0, birdsTotal: 0, landSpecies: 0, landGroups: 0, landAnimalsTotal: 0,
    });
    expect(ht.biomeOrchestrator.poolStats().bugs).toHaveLength(0);
    ht.setTileState(0, 0, HEX_TERRAIN.forest, HEX_PREP.wild, 0.4, HEX_DEPOSIT.minerals, 9000);
    expect(ht.props.counts()).toEqual({ pine: 0, duneTree: 0, boulder: 0, spire: 0, metals: 0, minerals: 0, oil: 0 });
    expect(ht.biomeOrchestrator.groundObjectsOrchestrator.rockNodePool.activeCount).toBe(0);
    expect(ht.biomeOrchestrator.resourcesOrchestrator.nodePool.activeCount).toBe(0);
    expect(ht.biomeOrchestrator.treesOrchestrator.nodePool.activeCount).toBe(0);
    ht.dispose();

    // Standalone acquire/release on a non-default biome retains the pool instead of prematurely disposing it on release
    const group = new THREE.Group();
    const buildings = new BuildingsOrchestrator(group);
    const m1 = buildings.acquire(1, 'building.solar', 'dune');
    buildings.release(1);
    const m2 = buildings.acquire(2, 'building.solar', 'dune');
    expect(m2).toBe(m1);
    expect(buildings.poolStats().find((s) => s.key === 'building:dune:building.solar')!.reuseHits).toBeGreaterThanOrEqual(1);
    buildings.dispose();
  });
});
