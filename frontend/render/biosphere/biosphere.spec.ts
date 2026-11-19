import { afterEach, describe, expect, it } from 'vitest';
import { hexCount, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { resetDayNightParams, setDayNight, setDayNightParams } from '../core/dayNightConfig';
import {
  BIRD_SPECIES_CATALOG,
  BirdFlockSimulator,
  BIRDS_BY_BIOME,
  buildHexHabitatIndex,
  canBiosphereFaunaAttackPlayer,
  LAND_ANIMAL_SPECIES_CATALOG,
  LAND_ANIMALS_BY_BIOME,
  LandAnimalSimulator,
} from './index';
import {
  createHexTerrain,
  HEX_PREP,
  HEX_TERRAIN,
  specForPlanetType,
  tileXZ,
} from '../planets/hex';
import { ArchetypeCatalog } from '../kitbash';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import { createPlanetSurface } from '../planets/surface';
import { evalAquaticThreatEvasion } from '../visuals/water/fauna';
import {
  BED_CLEARANCE,
  createFaunaBuffers,
  FAUNA_SINK_MAX,
  fishPathPoint,
  layoutFauna,
  planetFishCap,
} from '../visuals/water/fauna/faunaPlacement';
import { bakeShoreField, createShoreField, sampleField } from '../visuals/water/shoreField';
import { hexWaterCodeAt } from '../planets/hex/hexWater';

function buildRichBiomeTiles(radius: number) {
  const count = hexCount(radius);
  const hx = hexIndex(radius);
  const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(count).fill(HEX_PREP.wild);
  const height = new Float32Array(count).fill(0.3);

  for (let i = 0; i < count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    if (q < -radius / 2) terrain[i] = HEX_TERRAIN.deep;
    else if (q === Math.floor(-radius / 2)) terrain[i] = HEX_TERRAIN.shallow;
    else if ((q + r) % 3 === 0) terrain[i] = HEX_TERRAIN.forest;
    else if ((q - r) % 7 === 0) terrain[i] = HEX_TERRAIN.rock;
  }
  return { terrain, prep, height };
}

describe('Living Planet Biosphere: 15 Bird Species, 12 Warm-Blooded Species & Water Fauna', () => {
  it('defines 5 endemic birds per biome (15 total) and 4 endemic warm-blooded animals per biome (12 total)', () => {
    expect(BIRD_SPECIES_CATALOG).toHaveLength(15);
    expect(LAND_ANIMAL_SPECIES_CATALOG).toHaveLength(12);

    for (const biome of ['forestRock', 'oceanForest', 'dune'] as const) {
      expect(BIRDS_BY_BIOME[biome]).toHaveLength(5);
      expect(LAND_ANIMALS_BY_BIOME[biome]).toHaveLength(4);
      const diets = new Set(LAND_ANIMALS_BY_BIOME[biome].map((a) => a.diet));
      expect(diets.has('predator')).toBe(true);
      expect(diets.has('grassEater') || diets.has('treeBrowser')).toBe(true);
      const socials = new Set(LAND_ANIMALS_BY_BIOME[biome].map((a) => a.social));
      expect(socials.has('solo')).toBe(true);
      expect(socials.has('group')).toBe(true);
    }

    for (const s of [...BIRD_SPECIES_CATALOG, ...LAND_ANIMAL_SPECIES_CATALOG]) {
      expect(canBiosphereFaunaAttackPlayer(s.id)).toBe(false);
    }
  });

  it('flies bird flocks by pattern and relocates flocks away from terraformed forests and battles', () => {
    const radius = 16;
    const tiles = buildRichBiomeTiles(radius);
    const hx = hexIndex(radius);
    const terrain = createHexTerrain({ radius, tiles, look: specForPlanetType('temperate') });
    const bio = terrain.biosphere;

    const counts = bio.counts();
    expect(counts.birdSpecies).toBe(5);
    expect(counts.birdFlocks).toBeGreaterThanOrEqual(10);
    expect(counts.birdsTotal).toBeGreaterThan(30);

    const patterns = new Set(bio.getBirdFlocks().map((f) => f.pattern));
    expect(patterns.size).toBeGreaterThanOrEqual(4);

    // Deforestation reaction: clearing a forest flock's home tile triggers FLEEING_FOREST + home relocation
    const forestFlock = bio.getBirdFlocks().find((f) => f.species.habitatPref === 'forest' && f.homeTileIndex >= 0)!;
    expect(forestFlock).toBeDefined();
    const oldHomeTile = forestFlock.homeTileIndex;
    const oldHomeX = forestFlock.homeX;
    const oldHomeZ = forestFlock.homeZ;
    terrain.setTileState(hx.q[oldHomeTile]!, hx.r[oldHomeTile]!, HEX_TERRAIN.flat, HEX_PREP.prepared);
    terrain.tick(0.05);

    expect(forestFlock.state).toBe('FLEEING_FOREST');
    expect(forestFlock.relocations).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(forestFlock.homeX - oldHomeX, forestFlock.homeZ - oldHomeZ)).toBeGreaterThan(5);

    // Battle reaction: combat hotspot causes nearby flock to bank away in FLEEING_BATTLE with max wing-flap
    const hawkFlock = bio.getBirdFlocks().find((f) => f.species.pattern === 'thermalSoar')!;
    const leader = hawkFlock.members[0]!;
    bio.noteBattleAt(leader.x + 2, leader.z + 2, 16, 5);
    terrain.tick(0.05);
    expect(hawkFlock.state).toBe('FLEEING_BATTLE');
    expect(hawkFlock.members[0]!.flapWeight).toBe(1);

    terrain.dispose();
  });
});

describe('Living Planet Biosphere: Circadian Schedules, Robot Aggressors & Water Fauna', () => {
  afterEach(() => {
    resetDayNightParams();
    setDayNight(true);
  });

  it('reads real DayNightParams.timeOfDay [0..24) hours directly without 24x fractional-hour wrapping', () => {
    const radius = 16;
    const tiles = buildRichBiomeTiles(radius);
    const terrain = createHexTerrain({ radius, tiles, look: specForPlanetType('ocean') });
    const animals = terrain.biosphere.getLandAnimals();

    // High noon (12.0 h): crepuscular panthers MUST be sleeping (not midnight-hunting!), diurnal herbivores roaming/eating
    setDayNight(true);
    setDayNightParams({ timeOfDay: 12.0 }, 'sync');
    for (let i = 0; i < 4; i++) terrain.tick(0.08);
    expect(animals.filter((a) => a.species.id === 'fauna.canopyPanther').every((a) => a.state === 'SLEEPING')).toBe(true);
    expect(animals.some((a) => a.species.diet !== 'predator' && a.state !== 'SLEEPING')).toBe(true);

    // 09:00 AM default startup: panthers roam peacefully (`ROAMING`), grazers eat grass (`EATING_GRASS`)
    setDayNightParams({ timeOfDay: 9.0 }, 'sync');
    for (let i = 0; i < 4; i++) terrain.tick(0.08);
    expect(animals.some((a) => a.species.id === 'fauna.canopyPanther' && a.state === 'ROAMING')).toBe(true);
    expect(animals.some((a) => a.state === 'EATING_GRASS' || a.state === 'BROWSING_TREES')).toBe(true);

    // Deep night (02:00 AM): diurnal herbivores sleep while panthers hunt
    setDayNightParams({ timeOfDay: 2.0 }, 'sync');
    for (let i = 0; i < 4; i++) terrain.tick(0.08);
    expect(animals.some((a) => a.species.diet !== 'predator' && a.state === 'SLEEPING')).toBe(true);
    expect(animals.some((a) => a.species.id === 'fauna.canopyPanther' && a.state === 'HUNTING')).toBe(true);

    terrain.dispose();
  });

  it('drives warm-blooded animals through 24h circadian schedules and makes all fauna flee robot aggressors', () => {
    const radius = 16;
    const tiles = buildRichBiomeTiles(radius);
    const terrain = createHexTerrain({ radius, tiles, look: specForPlanetType('ocean') });
    const bio = terrain.biosphere;
    const animals = bio.getLandAnimals();

    expect(animals.length).toBeGreaterThan(15);
    expect(animals.every((a) => a.canAttackPlayer === false)).toBe(true);

    // 1. Midnight (02:00 -> time01 = 2/24): diurnal herbivores sleep, nocturnal/crepuscular panthers hunt
    bio.setTimeOfDayOverride(2 / 24);
    for (let i = 0; i < 6; i++) terrain.tick(0.1);
    const sleepingHerbivores = animals.filter((a) => a.species.diet !== 'predator' && a.state === 'SLEEPING');
    const huntingPanthers = animals.filter((a) => a.species.id === 'fauna.canopyPanther' && a.state === 'HUNTING');
    expect(sleepingHerbivores.length).toBeGreaterThan(0);
    expect(sleepingHerbivores[0]!.sleepCrouch).toBeGreaterThan(0.2);
    expect(huntingPanthers.length).toBeGreaterThan(0);

    // 2. Dawn drinking window (07:00 -> 7/24) for grazers
    bio.setTimeOfDayOverride(7 / 24);
    terrain.tick(0.1);
    expect(animals.some((a) => a.state === 'DRINKING' || a.state === 'BROWSING_TREES')).toBe(true);

    // 3. Morning grazing window (09:30 -> 9.5/24)
    bio.setTimeOfDayOverride(9.5 / 24);
    terrain.tick(0.1);
    expect(animals.some((a) => a.state === 'EATING_GRASS')).toBe(true);

    // 4. Midday predator nap (14:00 -> 14/24) & herbivore roaming
    bio.setTimeOfDayOverride(14 / 24);
    terrain.tick(0.1);
    expect(animals.some((a) => a.species.diet === 'predator' && a.state === 'SLEEPING')).toBe(true);
    expect(animals.some((a) => a.species.diet !== 'predator' && a.state === 'ROAMING')).toBe(true);

    // 5. Conqueror / Robot Aggressor Reaction: even a sleeping apex predator flees an approaching robot!
    const panther = animals.find((a) => a.species.id === 'fauna.canopyPanther')!;
    const startX = panther.x, startZ = panther.z;
    const robotX = startX - 1.2, robotZ = startZ + 0.5;
    bio.setAggressors([{ x: robotX, z: robotZ, radius: 12, working: true }]);
    for (let i = 0; i < 10; i++) terrain.tick(0.1);
    expect(panther.state).toBe('FLEEING_AGGRESSOR');
    expect(Math.hypot(panther.x - startX, panther.z - startZ)).toBeGreaterThan(0.5);

    // Boundary safety: zero and negative dt do not produce NaNs
    const [qx, qz] = tileXZ(0, 0);
    expect(Number.isFinite(qx + qz)).toBe(true);
    terrain.tick(0);
    terrain.tick(-0.5);
    expect(Number.isFinite(panther.x)).toBe(true);

    terrain.dispose();
  });
});

describe('Living Planet Biosphere: Water Fauna Ponds & Full-Deforestation Bounds Safety', () => {
  it('spawns visible swimming water fauna on both HexTerrain (including 7-hex ponds) and PlanetSurface water planets', () => {
    expect(planetFishCap(220)).toBeGreaterThan(800);

    const tiles = buildRichBiomeTiles(14);
    const hexOcean = createHexTerrain({ radius: 14, tiles, look: specForPlanetType('ocean') });
    expect(hexOcean.water.fauna).not.toBeNull();
    expect(hexOcean.water.fauna!.fish.length).toBeGreaterThan(0);
    const totalHexFish = hexOcean.water.fauna!.fish.reduce((s, m) => s + m.count, 0);
    expect(totalHexFish).toBeGreaterThan(20);
    hexOcean.dispose();

    const surfOcean = createPlanetSurface(PLANET_SPECS.oceanForest, { halfSize: 48, quality: 'low' });
    let foundWaterFauna = false;
    surfOcean.group.traverse((obj) => {
      if (obj.name === 'waterFaunaGroup' && obj.children.length > 0) foundWaterFauna = true;
    });
    expect(foundWaterFauna).toBe(true);
    expect(surfOcean.biosphere!.counts().birdSpecies).toBe(5);
    expect(surfOcean.biosphere!.counts().landSpecies).toBe(4);
    surfOcean.update(0.1, 1.0);
    surfOcean.dispose();

    // Small 7-hex lakes (centre + 1 hex ring, matching w05-terrain lakes) also place visible swimming shoals
    const lakeR = 14;
    const lakeHx = hexIndex(lakeR);
    const lakeTerrain = new Uint8Array(lakeHx.count).fill(HEX_TERRAIN.flat);
    const lakePrep = new Uint8Array(lakeHx.count).fill(HEX_PREP.wild);
    const lakeHeight = new Float32Array(lakeHx.count).fill(0.25);
    for (let i = 0; i < lakeHx.count; i++) {
      if (hexDistance(-6, 0, lakeHx.q[i]!, lakeHx.r[i]!) <= 1) lakeTerrain[i] = HEX_TERRAIN.shallow;
      if (hexDistance(6, 0, lakeHx.q[i]!, lakeHx.r[i]!) <= 1) lakeTerrain[i] = HEX_TERRAIN.deep;
    }
    const pondPlanet = createHexTerrain({
      radius: lakeR,
      tiles: { terrain: lakeTerrain, prep: lakePrep, height: lakeHeight },
      look: specForPlanetType('temperate'),
    });
    expect(pondPlanet.water.fauna.placed).toBeGreaterThan(0);
    expect(pondPlanet.water.fauna.count).toBeGreaterThan(0);
    pondPlanet.dispose();
  });

  it('keeps fleeing fish inside narrow 7-hex pond banks/beds and isolates prototype geometries from aBioState', () => {
    const lakeR = 14;
    const lakeHx = hexIndex(lakeR);
    const lakeTerrain = new Uint8Array(lakeHx.count).fill(HEX_TERRAIN.flat);
    const lakePrep = new Uint8Array(lakeHx.count).fill(HEX_PREP.wild);
    const lakeHeight = new Float32Array(lakeHx.count).fill(0.25);
    for (let i = 0; i < lakeHx.count; i++) {
      if (hexDistance(-6, 0, lakeHx.q[i]!, lakeHx.r[i]!) <= 1) lakeTerrain[i] = HEX_TERRAIN.shallow;
      if (hexDistance(6, 0, lakeHx.q[i]!, lakeHx.r[i]!) <= 1) lakeTerrain[i] = HEX_TERRAIN.deep;
    }
    const pondPlanet = createHexTerrain({
      radius: lakeR,
      tiles: { terrain: lakeTerrain, prep: lakePrep, height: lakeHeight },
      look: specForPlanetType('temperate'),
    });
    const codes = new Uint8Array(lakeHx.count);
    for (let i = 0; i < lakeHx.count; i++) {
      codes[i] = lakeTerrain[i] === HEX_TERRAIN.deep ? 2 : lakeTerrain[i] === HEX_TERRAIN.shallow ? 1 : 0;
    }
    const pondField = bakeShoreField(hexWaterCodeAt(lakeR, codes), createShoreField(Math.max(16, lakeR * 2 * 2.2)));
    const pondBuf = createFaunaBuffers(planetFishCap(pondField.span));
    const pondLay = layoutFauna(pondField, specForPlanetType('temperate').seed, pondBuf, planetFishCap(pondField.span));
    expect(pondLay.placed).toBeGreaterThan(0);
    const [pondX, pondZ] = tileXZ(-6, 0);
    const peakThreat = [{ x: pondX - 2.5, z: pondZ, radius: 16, strength: 1.5 }];
    for (let i = 0; i < pondLay.placed; i++) {
      const [safeShift, safeDive] = [pondBuf.evade[i * 4]!, pondBuf.evade[i * 4 + 1]!];
      const len = pondBuf.fish[i * 4 + 2]!;
      for (const t of [0, 1.9, 4.2]) {
        const [bx, by, bz] = fishPathPoint(pondBuf, i, t, FAUNA_SINK_MAX);
        const ev = evalAquaticThreatEvasion(bx, bz, peakThreat, safeShift, safeDive);
        expect(sampleField(pondField, pondField.mask, bx + ev.dx, bz + ev.dz)).toBeGreaterThan(0.5);
        expect(by - ev.diveY - len * 0.15 - sampleField(pondField, pondField.bed, bx + ev.dx, bz + ev.dz)).toBeGreaterThanOrEqual(
          BED_CLEARANCE - 0.03,
        );
      }
    }

    expect(ArchetypeCatalog.getGeometry('fauna.timberWolf').getAttribute('aBioState')).toBeUndefined();
    const hareMesh = pondPlanet.biosphere.animalMeshes.find((m) => m.name === 'biosphere-fauna.meadowHare')!;
    expect(hareMesh.geometry).not.toBe(ArchetypeCatalog.getGeometry('fauna.meadowHare'));
    pondPlanet.dispose();
    expect(ArchetypeCatalog.getGeometry('fauna.meadowHare').getAttribute('aBioState')).toBeUndefined();
  });
});

describe('Living Planet Biosphere: Full-Deforestation Hex Bounds Safety', () => {
  it('keeps all birds and land animals inside hexagonal bounds even when every forest is clear-cut during active battles', () => {
    const radius = 14;
    const tiles = buildRichBiomeTiles(radius);
    const hx = hexIndex(radius);
    const look = specForPlanetType('temperate');
    const terrain = createHexTerrain({ radius, tiles, look });

    // Clear-cut EVERY forest tile on the entire island while robots and battles are active
    const cleared: number[] = [];
    for (let i = 0; i < hx.count; i++) {
      if (tiles.terrain[i] === HEX_TERRAIN.forest) {
        tiles.terrain[i] = HEX_TERRAIN.flat;
        tiles.prep[i] = HEX_PREP.prepared;
        cleared.push(i);
      }
    }
    terrain.updateTiles(tiles, cleared);
    terrain.biosphere.setAggressors([
      { x: 0, z: 0, radius: 14, working: true },
      { x: 10, z: -8, radius: 12, working: true },
    ]);
    terrain.biosphere.noteBattleAt(-8, 6, 16, 6);

    for (let stepIdx = 0; stepIdx < 40; stepIdx++) {
      terrain.tick(0.1);
    }

    const hab = buildHexHabitatIndex(radius, { ...tiles, kind: look.kind, seed: look.seed }, look, (x, z) => terrain.heightAt(x, z));
    expect(hab.forestAnchors).toHaveLength(0);
    for (const flock of terrain.biosphere.getBirdFlocks()) {
      expect(hab.isInBounds(flock.homeX, flock.homeZ)).toBe(true);
      for (const m of flock.members) {
        expect(Number.isFinite(m.x + m.y + m.z)).toBe(true);
      }
    }
    for (const animal of terrain.biosphere.getLandAnimals()) {
      expect(hab.isInBounds(animal.x, animal.z)).toBe(true);
    }
    terrain.dispose();
  });
});

describe('Living Planet Biosphere: Unified Aquatic Evasion & Behavioral Fidelity', () => {
  it('propagates aggressor/battle/disturbance evasion to WaterFauna and separates veeFormation, ridgePatrol, corner escape, prowling & grazing micro-steps', () => {
    // 1. WaterFauna evasion math & unified biosphere threat forwarding
    expect(evalAquaticThreatEvasion(5, 5, [])).toEqual({ dx: 0, dz: 0, diveY: 0, panic: 0 });
    expect(evalAquaticThreatEvasion(50, 50, [{ x: 0, z: 0, radius: 12, strength: 1.0 }])).toEqual({ dx: 0, dz: 0, diveY: 0, panic: 0 });
    const ev = evalAquaticThreatEvasion(3, 0, [{ x: 0, z: 0, radius: 12, strength: 1.2 }]);
    expect(ev.dx).toBeGreaterThan(0.5);
    expect(ev.diveY).toBeGreaterThan(0.1);
    expect(ev.panic).toBeGreaterThan(0.4);

    const tiles = buildRichBiomeTiles(14);
    const oceanHex = createHexTerrain({ radius: 14, tiles, look: specForPlanetType('ocean') });
    expect(oceanHex.water.fauna.getThreats()).toHaveLength(0);
    oceanHex.biosphere.setAggressors([{ x: -12, z: 2, radius: 11, working: true }]);
    oceanHex.biosphere.noteBattleAt(-10, -4, 14, 5);
    oceanHex.tick(0.1);
    expect(oceanHex.water.fauna.getThreats().length).toBeGreaterThanOrEqual(2);
    oceanHex.dispose();

    // 2. veeFormation vs ridgePatrol produce genuinely distinct 3D trajectories from identical home/angle
    const hab16 = buildHexHabitatIndex(16, buildRichBiomeTiles(16), specForPlanetType('ocean'), () => 0.3);
    const birdSim = new BirdFlockSimulator('oceanForest', 77, hab16);
    const vee = birdSim.flocks.find((f) => f.pattern === 'veeFormation')!;
    const ridge = birdSim.flocks.find((f) => f.pattern === 'ridgePatrol')!;
    vee.homeX = 0; vee.homeZ = 0; vee.orbitAngle = 1.1; vee.members[0]!.x = 0; vee.members[0]!.z = 0;
    ridge.homeX = 0; ridge.homeZ = 0; ridge.orbitAngle = 1.1; ridge.members[0]!.x = 0; ridge.members[0]!.z = 0;
    for (let k = 0; k < 15; k++) birdSim.step(0.1, hab16, [], []);
    expect(Math.hypot(vee.members[0]!.x - ridge.members[0]!.x, vee.members[0]!.z - ridge.members[0]!.z)).toBeGreaterThan(1.0);

    // 3. East hex corner escape (`x > halfSize * 0.90`), zero-prey predator prowling & herbivore grazing micro-steps
    const allGrassTiles = {
      terrain: new Uint8Array(hexCount(16)).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(hexCount(16)).fill(HEX_PREP.wild),
      height: new Float32Array(hexCount(16)).fill(0.2),
    };
    const openHab = buildHexHabitatIndex(16, allGrassTiles, specForPlanetType('temperate'), () => 0.2);
    const animalSim = new LandAnimalSimulator('forestRock', 91, openHab);
    const wolf = animalSim.agents.find((a) => a.species.diet === 'predator')!;
    const [eastCornerX, eastCornerZ] = tileXZ(13, 0); // x = 26 > halfSize * 0.90 (~24.94)
    expect(eastCornerX).toBeGreaterThan(openHab.halfSize * 0.90);
    wolf.x = eastCornerX - 4;
    wolf.z = eastCornerZ;
    animalSim.step(0.1, 10, openHab, [{ x: eastCornerX - 8, z: eastCornerZ, radius: 10, working: true }], []);
    expect(wolf.goalX).toBeGreaterThan(openHab.halfSize * 0.90);

    // Remove all herbivores > 200m away so predator has zero prey within 46m -> must still prowl away from home!
    for (const a of animalSim.agents) {
      if (a.species.diet !== 'predator') { a.x = -200; a.z = -200; }
    }
    wolf.state = 'ROAMING';
    wolf.x = 0; wolf.z = 0; wolf.homeX = 0; wolf.homeZ = 0; wolf.goalX = 0; wolf.goalZ = 0;
    for (let k = 0; k < 25; k++) animalSim.step(0.1, 20.5, openHab, [], []); // 20:30 = wolf HUNTING window
    expect(wolf.state).toBe('HUNTING');
    expect(Math.hypot(wolf.x, wolf.z)).toBeGreaterThan(1.2);

    // Herbivore already at grazing goal takes slow foraging micro-steps over several seconds while keeping workWeight > 0.5
    const hare = animalSim.agents.find((a) => a.species.id === 'fauna.meadowHare')!;
    for (const a of animalSim.agents) {
      if (a.groupId === hare.groupId) {
        a.x = 4; a.z = 4; a.homeX = 4; a.homeZ = 4; a.goalX = 4; a.goalZ = 4; a.pauseTimer = 0.1;
        a.state = 'EATING_GRASS';
      }
    }
    for (let k = 0; k < 30; k++) animalSim.step(0.1, 8.0, openHab, [], []); // 08:00 = hare EATING_GRASS window
    expect(hare.state).toBe('EATING_GRASS');
    expect(Math.hypot(hare.x - 4, hare.z - 4)).toBeGreaterThan(0.25);
    expect(hare.workWeight).toBeGreaterThan(0.5);
  });
});
