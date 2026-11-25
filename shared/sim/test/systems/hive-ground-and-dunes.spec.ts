import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getAllHives,
  getHiveRecord,
  getSpawnSlots,
  getUnitRecord,
  HIVE_HEX_RADIUS,
  HIVE_TERRAFORM_RADIUS,
  hexDistance,
  hexIndex,
  insertRow,
  isFoundationReadyTile,
  isHexTile,
  isPreparedGround,
  isTileUneven,
  MAX_FOOTPRINT_SPREAD_M,
  materializeWorldgenHives,
  placeSpawnedEntity,
  PREP,
  rowOf,
  setTileDeposit,
  setTileHeight,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnFaunaBug,
  spawnHiveEntity,
  spawnHiveRaidWave,
  spawnHiveSite,
  spawnHqUnit,
  spawnWorkerUnit,
  TERRAIN,
  terraformHiveGround,
  type PlanetState,
  type PlanetType,
  type SimCommand,
} from '../../src';
import { getBuildingFootprintTiles } from '../../src/systems/construction/placement';

function spawnMobileUnit(
  state: PlanetState,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 240;
  cols.hpMax[row] = opts.hp ?? 240;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

describe('Hive ground spawning: terraformed pad and hexagons below and around', () => {
  const PLANET_TYPES: PlanetType[] = ['desert', 'temperate', 'ocean'];

  it('terraforms and levels hive ground across all planet types so tiles below and around every worldgen hive have hexagons', () => {
    const data = createRegistryPipeline({ flags: parseWaves('..07') }).config.data;
    for (const planetType of PLANET_TYPES) {
      const state = createPlanet({
        id: `hive-hex-${planetType}`,
        seed: `hive-hex-seed-${planetType}`,
        type: 'temperate',
        planetType,
        radius: 56,
      });

      const hiveIds = materializeWorldgenHives(state, 0, data);
      expect(hiveIds.length).toBeGreaterThanOrEqual(3);

      const hx = hexIndex(state.grid.radius);
      const { terrain, prep, height, deposit } = state.grid.layers;
      const layers = { terrain, prep, height };

      for (const hive of getAllHives(state)) {
        const centerIdx = hx.indexOf(hive.q, hive.r);
        expect(centerIdx).toBeGreaterThanOrEqual(0);
        const padHeight = height[centerIdx]!;

        // 1. All 9 tiles of the 3x3 building footprint below the hive satisfy player building foundation + hex rules
        const fpTiles = getBuildingFootprintTiles(hive.q, hive.r, 3);
        let lo = Infinity;
        let hi = -Infinity;
        for (const pt of fpTiles) {
          const ti = hx.indexOf(pt.q, pt.r);
          expect(ti).toBeGreaterThanOrEqual(0);
          expect(terrain[ti]).toBe(TERRAIN.flat);
          expect(isPreparedGround(prep[ti]!)).toBe(true);
          expect(isFoundationReadyTile(state.grid, ti)).toBe(true);
          expect(isTileUneven(state.grid.radius, ti, terrain, height)).toBe(false);
          expect(deposit[ti]).toBe(DEPOSIT.none);
          expect(isHexTile(state.grid.radius, ti, layers), `${planetType} hive (${hive.q},${hive.r}) fp (${pt.q},${pt.r})`).toBe(true);
          lo = Math.min(lo, height[ti]!);
          hi = Math.max(hi, height[ti]!);
        }
        expect(hi - lo).toBeLessThanOrEqual(MAX_FOOTPRINT_SPREAD_M);

        // 2. Every non-water tile in the 5x5 perimeter around the 3x3 hive (including corners +-2,+-2) AND d <= HIVE_HEX_RADIUS is a hex tile
        for (const pt of getBuildingFootprintTiles(hive.q, hive.r, 5)) {
          const ti = hx.indexOf(pt.q, pt.r);
          if (ti < 0 || terrain[ti] === TERRAIN.shallow || terrain[ti] === TERRAIN.deep) continue;
          const touchesWaterOrRim = [
            [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
          ].some(([nq, nr]) => {
            const ni = hx.indexOf(pt.q + nq, pt.r + nr);
            return ni < 0 || terrain[ni] === TERRAIN.shallow || terrain[ni] === TERRAIN.deep;
          });
          if (!touchesWaterOrRim) {
            expect(isHexTile(state.grid.radius, ti, layers), `${planetType} hive (${hive.q},${hive.r}) 5x5 (${pt.q},${pt.r})`).toBe(true);
          }
        }

        let hexTilesAround = 0;
        for (let dr = -HIVE_HEX_RADIUS; dr <= HIVE_HEX_RADIUS; dr++) {
          for (let dq = -HIVE_HEX_RADIUS; dq <= HIVE_HEX_RADIUS; dq++) {
            const d = hexDistance(0, 0, dq, dr);
            if (d > HIVE_HEX_RADIUS) continue;
            const ti = hx.indexOf(hive.q + dq, hive.r + dr);
            if (ti < 0 || terrain[ti] === TERRAIN.shallow || terrain[ti] === TERRAIN.deep) continue;
            expect(terrain[ti]).toBe(TERRAIN.flat);
            expect(isPreparedGround(prep[ti]!)).toBe(true);
            expect(Math.abs(height[ti]! - padHeight)).toBeLessThanOrEqual(1e-4);
            // If no neighbour at d+1 is water/oob, R2 guarantees a closed hexagon
            const touchesWaterOrRim = [
              [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
            ].some(([nq, nr]) => {
              const ni = hx.indexOf(hive.q + dq + nq, hive.r + dr + nr);
              return ni < 0 || terrain[ni] === TERRAIN.shallow || terrain[ni] === TERRAIN.deep;
            });
            if (!touchesWaterOrRim) {
              expect(isHexTile(state.grid.radius, ti, layers)).toBe(true);
              if (d >= 1) hexTilesAround++;
            }
          }
        }
        expect(hexTilesAround).toBeGreaterThanOrEqual(18);
      }
    }
  });
});

describe('Hive ground spawning: edge obstacles, water, and colony territory preservation', () => {
  it('clears wild dunes, rocks, forests, holes, and deposits under a newly spawned hive while preserving water and colony territory', () => {
    const state = createState({ planetId: 'hive-edge', planetType: 'desert', seed: 'hive-edge', radius: 14 });
    const hx = hexIndex(state.grid.radius);
    const L = state.grid.layers;
    L.terrain.fill(TERRAIN.slope);
    L.prep.fill(PREP.wild);
    L.height.fill(3.6);

    // Mix obstacles inside d <= HIVE_TERRAFORM_RADIUS around (0, 0)
    setTileTerrain(state.grid, hx.indexOf(0, 0), TERRAIN.rock, 0);
    setTileTerrain(state.grid, hx.indexOf(1, 0), TERRAIN.forest, 0);
    setTileTerrain(state.grid, hx.indexOf(-1, 1), TERRAIN.hole, 0);
    setTileDeposit(state.grid, hx.indexOf(0, 1), DEPOSIT.metals, 10000, 0);

    // Water tile and foreign colony tile at d = 5 must NOT be overwritten
    const waterIdx = hx.indexOf(5, 0);
    setTileTerrain(state.grid, waterIdx, TERRAIN.deep, 0);
    setTileHeight(state.grid, waterIdx, -0.8, 0);

    const ownedIdx = hx.indexOf(-5, 0);
    setTileTerrain(state.grid, ownedIdx, TERRAIN.slope, 0);
    L.owner[ownedIdx] = 0;

    // Out-of-bounds call is a safe no-op
    expect(terraformHiveGround(state, 999, -999, 1)).toEqual([]);

    const hiveId = spawnHiveSite(state, { species: 'blueBeetle', q: 0, r: 0, initialResidents: 2 }, 1);
    expect(getHiveRecord(state, hiveId)?.residentIds).toHaveLength(2);

    // Inner footprint + surrounding ring (d <= 2) are all terraformed hexagons with deposits cleared
    for (let dr = -2; dr <= 2; dr++) {
      for (let dq = -2; dq <= 2; dq++) {
        if (hexDistance(0, 0, dq, dr) > 2) continue;
        const ti = hx.indexOf(dq, dr);
        expect(L.terrain[ti]).toBe(TERRAIN.flat);
        expect(L.prep[ti]).toBe(PREP.prepared);
        expect(L.deposit[ti]).toBe(DEPOSIT.none);
        expect(isHexTile(state.grid.radius, ti, { terrain: L.terrain, prep: L.prep, height: L.height })).toBe(true);
      }
    }

    // Water and player-owned tiles were respected
    expect(L.terrain[waterIdx]).toBe(TERRAIN.deep);
    expect(L.terrain[ownedIdx]).toBe(TERRAIN.slope);
    expect(L.owner[ownedIdx]).toBe(0);
    expect(HIVE_TERRAFORM_RADIUS).toBe(4);
  });
});

describe('Dunes vs Mountains passability for all player units and insects', () => {
  it('allows HQ, Worker, Recon, DemoTank, and DemoArtillery to move across non-terraformed dunes (slope) and blocks mountains (rock)', () => {
    const flags = parseWaves('..07');
    const host = new SimHost(createRegistryPipeline({ flags }));
    const state = createState({ planetId: 'dunes-units', planetType: 'desert', seed: 'dunes-units', radius: 16 });
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.slope);
    state.grid.layers.prep.fill(PREP.wild);
    for (let i = 0; i < state.grid.count; i++) {
      state.grid.layers.height[i] = 1.2 + (hx.q[i]! % 3) * 0.45;
    }

    // Place a mountain wall along q = 4 (r = -2..2), leaving routes around it on non-terraformed dunes
    for (const r of [-2, -1, 0, 1, 2]) {
      setTileTerrain(state.grid, hx.indexOf(4, r), TERRAIN.rock, 0);
    }

    ensureColonyRecord(state, 0, 0).status = 'active';
    host.load(state);

    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const workerId = spawnWorkerUnit(state, { owner: 0, q: 0, r: 1 });
    const reconId = spawnMobileUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: -1 });
    const tankId = spawnMobileUnit(state, { kind: ENTITY_KIND.demoTank, owner: 0, q: -1, r: 0, hp: 520 });
    const artId = spawnMobileUnit(state, { kind: ENTITY_KIND.demoArtillery, owner: 0, q: -1, r: 1, hp: 320 });

    const allUnitIds = [hqId, workerId, reconId, tankId, artId];
    let cmdSeq = 0;
    const move = (entityId: number, q: number, r: number): SimCommand => ({
      commandId: `mv_${++cmdSeq}`,
      colonyIndex: 0,
      source: 'player',
      kind: 'moveUnit',
      args: { entityId, q, r },
    });

    // 1. Negative: EVERY unit rejects a move directly onto a mountain (TERRAIN.rock)
    for (const id of allUnitIds) {
      host.submit(move(id, 4, 0));
      expect(host.step(1).outcomes[0]?.code, `unit ${id} -> mountain`).toBe('site_blocked');
    }

    // 2. Positive: EVERY unit moves onto non-terraformed dunes beyond the mountain wall, routing around rock
    const targets: Array<[number, number, number]> = [
      [hqId, 7, 0],
      [workerId, 7, 1],
      [reconId, 7, -1],
      [tankId, 6, 0],
      [artId, 6, 1],
    ];
    for (const [id, q, r] of targets) {
      host.submit(move(id, q, r));
      expect(host.step(1).outcomes[0]?.code, `unit ${id} -> dune (${q},${r})`).toBeUndefined();
    }

    for (let stepIdx = 0; stepIdx < 80; stepIdx++) {
      host.step(1);
      for (const id of allUnitIds) {
        const uRow = rowOf(state.entities, id);
        const curIdx = hx.indexOf(state.entities.cols.q[uRow]!, state.entities.cols.r[uRow]!);
        expect(state.grid.layers.terrain[curIdx], `unit ${id} never steps on mountain`).not.toBe(TERRAIN.rock);
      }
    }

    for (const [id, q, r] of targets) {
      const uRow = rowOf(state.entities, id);
      expect([state.entities.cols.q[uRow], state.entities.cols.r[uRow]]).toEqual([q, r]);
      expect(getUnitRecord(state, id)?.lastFailure ?? null).toBeNull();
    }
  });
});

describe('Dunes vs Mountains passability for insect species and generated desert planets', () => {
  it('allows all 3 insect species to cross non-terraformed dunes and blocks them from crossing or spawning on mountains', () => {
    const flags = parseWaves('..07');
    const pipeline = createRegistryPipeline({ flags });
    const data = pipeline.config.data;
    const host = new SimHost(pipeline);
    const state = createState({ planetId: 'dunes-bugs', planetType: 'desert', seed: 'dunes-bugs', radius: 20 });
    const hx = hexIndex(state.grid.radius);
    state.grid.layers.terrain.fill(TERRAIN.slope);
    state.grid.layers.prep.fill(PREP.wild);
    state.grid.layers.height.fill(2.0);

    ensureColonyRecord(state, 0, 0).status = 'active';
    const targetHq = spawnHqUnit(state, { owner: 0, q: -6, r: 0 });
    expect(targetHq).toBeGreaterThan(0);

    // Mountain barrier between hive at (8, 0) and colony at (-6, 0), with open dune flanks
    for (const r of [-2, -1, 0, 1, 2]) {
      setTileTerrain(state.grid, hx.indexOf(1, r), TERRAIN.rock, 0);
    }

    host.load(state);
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 8, r: 0, initialResidents: 3 }, host.tick, data);
    const beetleId = spawnFaunaBug(state, { species: 'blueBeetle', q: 6, r: 1, homeHiveId: hiveId }, host.tick, data);
    const spitterId = spawnFaunaBug(state, { species: 'greenSpitter', q: 6, r: -1, homeHiveId: hiveId }, host.tick, data);
    expect(beetleId).toBeGreaterThan(0);
    expect(spitterId).toBeGreaterThan(0);

    const cohort = spawnHiveRaidWave(state, { colonyIndex: 0, hiveId, budget: 10, tick: host.tick, data });
    expect(cohort).not.toBeNull();

    let enteredDune = false;
    for (let t = 0; t < 65; t++) {
      host.step(1);
      for (const bugId of cohort!.memberIds) {
        const bRow = rowOf(state.entities, bugId);
        if (bRow < 0) continue;
        const ti = hx.indexOf(state.entities.cols.q[bRow]!, state.entities.cols.r[bRow]!);
        expect(state.grid.layers.terrain[ti]).not.toBe(TERRAIN.rock);
        if (state.grid.layers.terrain[ti] === TERRAIN.slope) enteredDune = true;
      }
    }
    expect(enteredDune).toBe(true);
    expect(state.entities.cols.hp[rowOf(state.entities, targetHq)]).toBeLessThan(900);

    // Boundary case: a hive completely sealed off by a ring of mountains withdraws cleanly (unreachable)
    const sealedHive = spawnHiveEntity(state, { species: 'greenSpitter', q: 0, r: 12, initialResidents: 2 }, host.tick, data);
    for (let dr = -6; dr <= 6; dr++) {
      for (let dq = -6; dq <= 6; dq++) {
        if (hexDistance(0, 0, dq, dr) === 6) {
          const ti = hx.indexOf(dq, 12 + dr);
          if (ti >= 0) {
            setTileTerrain(state.grid, ti, TERRAIN.rock, host.tick);
            setTilePrep(state.grid, ti, PREP.wild, host.tick);
          }
        }
      }
    }
    expect(spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: sealedHive, tick: host.tick, data })).not.toBeNull();
    host.step(3);
    for (const bugId of getHiveRecord(state, sealedHive)!.residentIds) {
      const bRow = rowOf(state.entities, bugId);
      const ti = hx.indexOf(state.entities.cols.q[bRow]!, state.entities.cols.r[bRow]!);
      expect(state.grid.layers.terrain[ti]).not.toBe(TERRAIN.rock);
    }
  });
});

describe('Dunes passability on generated desert planets', () => {
  it('lets a landed HQ on a generated desert planet walk out of the landing zone across wild dunes', () => {
    const flags = parseWaves('..07');
    const host = new SimHost(createRegistryPipeline({ flags }));
    const planet = createPlanet({ id: 'desert-walk', seed: 'golden-1', type: 'temperate', planetType: 'desert', radius: 56 });
    const slot = getSpawnSlots(planet)[0]!;
    ensureColonyRecord(planet, 0, 0).status = 'active';
    const hqId = spawnHqUnit(planet, { owner: 0, q: slot.q, r: slot.r });
    host.load(planet);

    const hx = hexIndex(planet.grid.radius);
    let duneGoal: { q: number; r: number } | null = null;
    for (let d = 9; d <= 16 && !duneGoal; d++) {
      for (const [dq, dr] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
        const q = slot.q + dq;
        const r = slot.r + dr;
        const ti = hx.indexOf(q, r);
        if (ti >= 0 && planet.grid.layers.terrain[ti] === TERRAIN.slope && planet.grid.layers.deposit[ti] === DEPOSIT.none) {
          duneGoal = { q, r };
          break;
        }
      }
    }
    expect(duneGoal).not.toBeNull();

    host.submit({
      commandId: 'desert_dune_walk',
      colonyIndex: 0,
      source: 'player',
      kind: 'moveUnit',
      args: { entityId: hqId, q: duneGoal!.q, r: duneGoal!.r },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    host.step(90);

    const hqRow = rowOf(planet.entities, hqId);
    expect([planet.entities.cols.q[hqRow], planet.entities.cols.r[hqRow]]).toEqual([duneGoal!.q, duneGoal!.r]);
  });
});
