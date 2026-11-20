import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { hexCount } from '@terra/sim/grid/hex';
import { getVertebrateConfig, shiftVertebrateRigMetadata } from '../animation/vertebrates/rig';
import { BirdFlockSimulator } from '../biosphere/BirdFlockSim';
import { buildHexHabitatIndex } from '../biosphere/habitatIndex';
import { getWeaponRig } from '../combat/WeaponRig';
import { setViewFocusEnabled, updateViewFocus } from '../core/viewFocus';
import { ArchetypeCatalog } from '../kitbash';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import { createHexTerrain, HEX_DEPOSIT, HEX_PREP, HEX_TERRAIN, specForPlanetType } from '../planets/hex';
import {
  BiomeOrchestrator,
  buildBiomeOrchestratorConfig,
  BuildingsOrchestrator,
  BugsOrchestrator,
  UnitsOrchestrator,
} from './index';

afterEach(() => {
  setViewFocusEnabled(true);
});

describe('Orchestrator Prewarming & Pooled Mesh Reset Regressions', () => {
  it('prewarms UnitsOrchestrator, BuildingsOrchestrator, and BugsOrchestrator cleanly and canonicalizes aliases', () => {
    const group = new THREE.Group();
    const units = new UnitsOrchestrator(group, { biomeKey: 'forestRock', prewarmOnInit: true });
    const buildings = new BuildingsOrchestrator(group, { biomeKey: 'forestRock', prewarmOnInit: true });
    const bugs = new BugsOrchestrator(group, { biomeKey: 'forestRock', prewarmOnInit: true });

    expect(units.poolStats().length).toBeGreaterThanOrEqual(9);
    expect(buildings.poolStats().length).toBeGreaterThanOrEqual(19);
    expect(bugs.poolStats()).toHaveLength(3);

    // Aliases share the canonical pool without allocating a duplicate pool
    const mReconAlias = units.acquire(1, 'unit.recon', 'forestRock');
    units.release(1);
    const mReconCanon = units.acquire(2, 'robot.recon', 'forestRock');
    expect(mReconCanon).toBe(mReconAlias);

    const mDroneAlias = buildings.acquire(10, 'building.droneControlArray', 'forestRock');
    buildings.release(10);
    const mDroneCanon = buildings.acquire(11, 'building.droneArray', 'forestRock');
    expect(mDroneCanon).toBe(mDroneAlias);

    units.dispose();
    buildings.dispose();
    bugs.dispose();
  });

  it('clears WeaponRig aim/lift/recoil and detaches transient pod-retro-flames when pooled meshes recycle', () => {
    const group = new THREE.Group();
    const buildings = new BuildingsOrchestrator(group, { biomeKey: 'forestRock' });
    const units = new UnitsOrchestrator(group, { biomeKey: 'forestRock' });

    const turret1 = buildings.acquire(10, 'building.turret', 'forestRock');
    turret1.position.set(0, 0, 0);
    getWeaponRig(turret1)!.fire(new THREE.Vector3(50, 0, -40), 0.65, true);
    buildings.release(10);

    const turret2 = buildings.acquire(99, 'building.turret', 'forestRock');
    turret2.position.set(-20, 0, 15);
    getWeaponRig(turret2)!.update(0);
    const u = (turret2.userData as { uniforms: Record<string, { value: unknown }> }).uniforms;
    expect(u.uWeaponEnabled?.value).toBe(0);
    expect(u.uWeaponLift?.value).toBe(0);
    expect((u.uWeaponRecoil?.value as THREE.Vector2).toArray()).toEqual([0, 0]);

    const pod1 = units.acquire(5, 'ship.dropPod', 'forestRock');
    const flames = new THREE.Group();
    flames.name = 'pod-retro-flames';
    const flameGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    let flameGeoDisposed = false;
    flameGeo.addEventListener('dispose', () => { flameGeoDisposed = true; });
    flames.add(new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial()));
    pod1.add(flames);
    units.release(5);
    expect(pod1.getObjectByName('pod-retro-flames')).toBeUndefined();
    expect(flames.parent).toBeNull();

    buildings.dispose();
    units.dispose();
    expect(flameGeoDisposed).toBe(false);
    flameGeo.dispose();
  });
});

describe('Bird Aerodynamics, View-Focus Altitude & Large-Planet Pool Scaling Regressions', () => {
  it('keeps V-echelon wingmen aligned around turns, avoids FLEEING_BATTLE spin spasms, and drives periodic soarer power strokes', () => {
    const r = 16;
    const n = hexCount(r);
    const tiles = {
      terrain: new Uint8Array(n).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(n).fill(HEX_PREP.wild),
      height: new Float32Array(n).fill(0.2),
    };
    const hab = buildHexHabitatIndex(r, tiles, specForPlanetType('temperate'), () => 0.2);
    const sim = new BirdFlockSimulator('forestRock', 42, hab);

    const craneFlock = sim.flocks.find((f) => f.species.id === 'fauna.bird.mountainCrane')!;
    const hawkFlock = sim.flocks.find((f) => f.species.id === 'fauna.bird.highlandHawk')!;
    let minCosAlign = 1;
    let maxHawkFlap = 0;
    let minHawkFlap = 1;
    for (let i = 0; i < 450; i++) {
      sim.step(1 / 30, hab, [], []);
      const l = craneFlock.members[0]!;
      for (let k = 1; k < craneFlock.members.length; k++) {
        minCosAlign = Math.min(minCosAlign, Math.cos(craneFlock.members[k]!.yaw - l.yaw));
      }
      maxHawkFlap = Math.max(maxHawkFlap, hawkFlock.members[0]!.flapWeight);
      minHawkFlap = Math.min(minHawkFlap, hawkFlock.members[0]!.flapWeight);
    }
    expect(minCosAlign).toBeGreaterThan(0.55);
    expect(maxHawkFlap).toBeGreaterThan(0.65);
    expect(minHawkFlap).toBeLessThan(0.30);

    // FLEEING_BATTLE relocates smoothly without arrival spin spasms or thermalKettle flock splitting
    const fk = sim.flocks.find((f) => f.species.id === 'fauna.bird.brookKingfisher')!;
    let prevYaw = fk.members[0]!.yaw;
    let totalAbsYaw = 0;
    const bx = fk.members[0]!.x + 1, bz = fk.members[0]!.z + 1;
    for (let i = 0; i < 180; i++) {
      sim.step(1 / 30, hab, [], [{ x: bx, z: bz, radius: 14, ttl: 5.5 }]);
      let dy = fk.members[0]!.yaw - prevYaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      totalAbsYaw += Math.abs(dy);
      prevYaw = fk.members[0]!.yaw;
    }
    expect(totalAbsYaw).toBeLessThan(Math.PI * 3.2);

    // shiftVertebrateRigMetadata preserves bird angular radians under scale != 1
    const birdGeo = ArchetypeCatalog.getGeometry('fauna.bird.seaAlbatross');
    const ampBefore = getVertebrateConfig(birdGeo).strideLen;
    shiftVertebrateRigMetadata(birdGeo, 0.75, 0);
    expect(getVertebrateConfig(birdGeo).strideLen).toBeCloseTo(ampBefore, 6);
    birdGeo.dispose();
    sim.dispose();
  });
});

describe('View-Focus Altitude & Large-Planet Pool Scaling Regressions', () => {
  it('preserves high-altitude birds in 28° view focus, applies planet biome materials, and scales large-planet resource/tree pools', () => {
    const r = 28;
    const n = hexCount(r);
    const terrainArr = new Uint8Array(n).fill(HEX_TERRAIN.forest);
    const depositArr = new Uint8Array(n);
    for (let i = 0; i < n; i += 3) depositArr[i] = HEX_DEPOSIT.metals;
    const tiles = {
      terrain: terrainArr,
      prep: new Uint8Array(n).fill(HEX_PREP.wild),
      height: new Float32Array(n).fill(0.25),
      deposit: depositArr,
      richness: new Uint16Array(n).fill(10000),
      depositTier: new Uint8Array(n).fill(2),
    };

    const ht = createHexTerrain({ radius: r, tiles, look: PLANET_SPECS.oceanForest });
    const bo = ht.biomeOrchestrator;
    expect(bo).toBeInstanceOf(BiomeOrchestrator);
    expect(bo.poolStats().bugs).toHaveLength(3);

    const depStatsBefore = bo.resourcesOrchestrator.nodePool.stats();
    expect(depStatsBefore.active).toBeGreaterThan(900);
    expect(depStatsBefore.threshold).toBeGreaterThan(depStatsBefore.active);
    ht.setTileState(0, 0, undefined, undefined, undefined, HEX_DEPOSIT.metals, 3000);
    expect(bo.resourcesOrchestrator.nodePool.stats().trimmedOverflow).toBe(0);

    // High-altitude bird at (0, 19, 29) is visible on-screen in a 28° camera and stays drawn after step()
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 500);
    cam.position.set(0, 22, 34);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    updateViewFocus(cam, 0);

    const flock0 = ht.biosphere.getBirdFlocks()[0]!;
    flock0.homeX = 0;
    flock0.homeZ = 29;
    flock0.members[0]!.x = 0;
    flock0.members[0]!.y = 19;
    flock0.members[0]!.z = 29;
    const ndc = new THREE.Vector3(0, 19, 29).project(cam);
    expect(Math.abs(ndc.y)).toBeLessThan(0.95);
    ht.tick(1 / 60);
    expect(ht.biosphere.birdMeshes[flock0.speciesSlot]!.count).toBeGreaterThan(0);

    // Radius-56 dune config scales cell thresholds past 96 so saguaro/barrelCactus buckets never overflow
    const dune56 = buildBiomeOrchestratorConfig(PLANET_SPECS.dune, 56);
    expect(dune56.groundObjects.pools.saguaro!.threshold).toBeGreaterThan(140);

    ht.dispose();
  });
});
