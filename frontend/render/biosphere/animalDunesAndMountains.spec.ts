import { describe, expect, it } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { buildHexHabitatIndex, isPassableAnimalTile, LandAnimalSimulator } from './index';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType, tileAt, tileXZ } from '../planets/hex';
import { BiomeOrchestrator } from '../orchestrators/BiomeOrchestrator';
import { buildBiomeOrchestratorConfig } from '../orchestrators/BiomeConfig';

describe('Land animal passability: non-terraformed dunes allowed, mountains blocked', () => {
  it('allows non-terraformed dunes (slope) and flat/forest across all biomes while blocking mountains (rock), ridges, moats, and holes', () => {
    for (const kind of ['dune', 'forestRock', 'oceanForest'] as const) {
      expect(isPassableAnimalTile(HEX_TERRAIN.flat, HEX_PREP.wild, kind)).toBe(true);
      expect(isPassableAnimalTile(HEX_TERRAIN.slope, HEX_PREP.wild, kind)).toBe(true);
      expect(isPassableAnimalTile(HEX_TERRAIN.forest, HEX_PREP.wild, kind)).toBe(true);

      // Mountains (unprepared rock) are strictly impassable; terraformed rock pads are passable
      expect(isPassableAnimalTile(HEX_TERRAIN.rock, HEX_PREP.wild, kind)).toBe(false);
      expect(isPassableAnimalTile(HEX_TERRAIN.rock, HEX_PREP.flat, kind)).toBe(false);
      expect(isPassableAnimalTile(HEX_TERRAIN.rock, HEX_PREP.prepared, kind)).toBe(true);

      // Ridges, moats, and sinkholes are strictly impassable
      expect(isPassableAnimalTile(HEX_TERRAIN.slope, HEX_PREP.ridge, kind)).toBe(false);
      expect(isPassableAnimalTile(HEX_TERRAIN.flat, HEX_PREP.moat, kind)).toBe(false);
      expect(isPassableAnimalTile(HEX_TERRAIN.hole, HEX_PREP.wild, kind)).toBe(false);
    }
  });

  it('spawns and moves desert animals across non-terraformed dunes (slope) and never places or steps them onto mountains (rock)', () => {
    const radius = 14;
    const count = hexCount(radius);
    const hx = hexIndex(radius);
    // Pure desert erg: ONLY non-terraformed dunes (slope) + mountain ranges (rock), zero flat tiles!
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.slope);
    const prep = new Uint8Array(count).fill(HEX_PREP.wild);
    const height = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const q = hx.q[i]!;
      const r = hx.r[i]!;
      if ((q + r) % 4 === 0) {
        terrain[i] = HEX_TERRAIN.rock;
        height[i] = 4.5;
      } else {
        height[i] = 1.4 + ((q * 3 + r) % 3) * 0.5;
      }
    }

    const look = specForPlanetType('desert');
    const hexTerrain = createHexTerrain({ radius, tiles: { terrain, prep, height }, look });
    const habitat = buildHexHabitatIndex(radius, { terrain, prep, height, kind: 'dune', seed: look.seed }, look, hexTerrain.heightAt);
    expect(habitat.grassAnchors.length).toBeGreaterThan(20);

    const [rockX, rockZ] = tileXZ(0, 0); // (0 + 0) % 4 === 0 -> mountain
    const [duneX, duneZ] = tileXZ(1, 0); // (1 + 0) % 4 !== 0 -> non-terraformed dune
    expect(habitat.isPassableLand(rockX, rockZ)).toBe(false);
    expect(habitat.isPassableLand(duneX, duneZ)).toBe(true);

    const sim = new LandAnimalSimulator('dune', 42, habitat);
    expect(sim.agents.length).toBeGreaterThan(0);

    for (let step = 0; step < 80; step++) {
      sim.step(0.08, 10.0, habitat, [], []);
      for (const a of sim.agents) {
        const pick = tileAt(radius, a.x, a.z);
        expect(pick).not.toBeNull();
        expect(terrain[pick!.i], `animal ${a.species.id} must not stand on mountain`).not.toBe(HEX_TERRAIN.rock);
      }
    }

    // Worker-hydrated BiomeOrchestrator enforces the exact same mountain blocker
    const cfg = buildBiomeOrchestratorConfig(PLANET_SPECS.dune, radius);
    const orch = new BiomeOrchestrator(cfg, { terrain, prep, height });
    const liveAnimals = orch.biosphere.getLandAnimals();
    expect(liveAnimals.length).toBeGreaterThan(0);
    for (let step = 0; step < 40; step++) {
      orch.tick(0.08, 1.0);
      for (const a of liveAnimals) {
        const pick = tileAt(radius, a.x, a.z);
        expect(pick).not.toBeNull();
        expect(terrain[pick!.i], `BiomeOrchestrator animal ${a.species.id} must not stand on mountain`).not.toBe(
          HEX_TERRAIN.rock,
        );
      }
    }

    orch.dispose();
    sim.dispose();
    hexTerrain.dispose();
  });
});
