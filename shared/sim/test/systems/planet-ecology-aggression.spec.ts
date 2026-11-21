import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND,
  canFaunaAttackPlayer,
  computeColonyPlanetDamage,
  createPlanet,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getActiveCohorts,
  hexIndex,
  ingestEcologicalDamageEvents,
  insertRow,
  isHiveAggressiveToColony,
  placeSpawnedEntity,
  PLANET_DAMAGE_AGGRESSION_THRESHOLD,
  PREP,
  regionForNewPlanet,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHiveEntity,
  spawnHqUnit,
  spawnWorkerUnit,
  startBuildingConstruction,
  TERRAIN,
  threatOf,
} from '../../src';

function createPeacefulColonyHost(seed = 'peaceful-planet') {
  const flags = parseWaves('..08');
  const pipeline = createRegistryPipeline({ flags });
  const data = pipeline.config.data;
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-eco', planetType: 'temperate', seed, radius: 24 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.flat);
  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2000 });
  col.status = 'active';
  col.stage = 3;
  col.threatStage = 3;
  col.s3ReachedAtTick = 0;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  host.load(state);
  return { host, state, data, pipeline };
}

describe('Planetary ecological damage & insect-only player aggression', () => {
  it('enforces that only insect hive species can ever attack player colonies, never warm-blooded or avian wildlife', () => {
    expect(canFaunaAttackPlayer('blackAnt')).toBe(true);
    expect(canFaunaAttackPlayer('blueBeetle')).toBe(true);
    expect(canFaunaAttackPlayer('greenSpitter')).toBe(true);
    expect(canFaunaAttackPlayer(ENTITY_KIND.blackAnt)).toBe(true);
    expect(canFaunaAttackPlayer(ENTITY_KIND.blueBeetle)).toBe(true);
    expect(canFaunaAttackPlayer(ENTITY_KIND.greenSpitter)).toBe(true);

    expect(canFaunaAttackPlayer('timberWolf')).toBe(false);
    expect(canFaunaAttackPlayer('crownStag')).toBe(false);
    expect(canFaunaAttackPlayer('canopyPanther')).toBe(false);
    expect(canFaunaAttackPlayer('highlandHawk')).toBe(false);
    expect(canFaunaAttackPlayer('saberOryx')).toBe(false);
    expect(canFaunaAttackPlayer('')).toBe(false);
    expect(canFaunaAttackPlayer(ENTITY_KIND.worker)).toBe(false);
  });

  it('keeps insects passive toward a low-damage colony even after S3 grace period expires', () => {
    const { host, state, data } = createPeacefulColonyHost('pristine-planet');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 6 }, 0, data);

    const dmg = computeColonyPlanetDamage(state, 0, data);
    expect(dmg.damageScore).toBeLessThan(PLANET_DAMAGE_AGGRESSION_THRESHOLD);
    expect(dmg.damagedEnough).toBe(false);

    // Advance past 3000 ticks (raid roll interval) with high synthetic thermal override check:
    // without crossing planet damage threshold, scheduled waves must not fire.
    state.meta.tick = 2999;
    host.step(1);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);
    expect(getActiveCohorts(state)).toHaveLength(0);
  });

  it('activates insect aggression once deforestation, mining, or industrial pollution crosses the planet damage threshold', () => {
    const { host, state, data } = createPeacefulColonyHost('deforested-planet');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 8, r: 0, initialResidents: 6 }, 0, data);

    // Add 3 thermal generators (36 pts >= 25 threshold) + drained deposit
    for (let i = 0; i < 3; i++) {
      const id = state.meta.nextEntityId++;
      const row = insertRow(state.entities, id, 0);
      state.entities.cols.kind[row] = BUILDING_KIND.thermalGenerator;
      state.entities.cols.owner[row] = 0;
      state.entities.cols.hp[row] = 400;
      state.entities.cols.hpMax[row] = 400;
      state.entities.cols.progress[row] = 1;
      state.entities.cols.state[row] = ENTITY_STATE.active;
      placeSpawnedEntity(state.entities, row, -3 - i, 0, 0);
    }
    const hx = hexIndex(state.grid.radius);
    const depIdx = hx.indexOf(-2, 2);
    state.grid.layers.deposit[depIdx] = DEPOSIT.metals;
    state.grid.layers.richness[depIdx] = 3000;

    const afterInd = computeColonyPlanetDamage(state, 0, data);
    expect(afterInd.damagedEnough).toBe(true);
    expect(afterInd.depositsMined).toBeGreaterThanOrEqual(1);

    // Clear-cutting forest right next to the hive (q=6, r=0 is 2 tiles from hive at q=8, r=0) provokes habitat defense
    const fakeEvents = [
      {
        kind: 'tileStateChanged',
        severity: 'info' as const,
        atTick: 10,
        colonyIds: ['col_0'],
        data: { colonyIndex: 0, q: 6, r: 0, prevTerrain: 'forest', prevPrep: 'wild', terrain: 'flat', prep: 'flat', op: 'clear', count: 2 },
      },
    ];
    ingestEcologicalDamageEvents(state, 10, {
      dt: 1,
      tick: 10,
      flags: new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']),
      data,
      events: fakeEvents,
      postings: [],
      record: () => {},
      rng: () => state.rng.misc,
      newEntityId: () => state.meta.nextEntityId++,
      emit: () => {},
    });

    const afterClear = computeColonyPlanetDamage(state, 0, data);
    expect(afterClear.forestCleared).toBe(2);
    expect(afterClear.scheduledRaidBonus).toBeGreaterThan(0);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(true);
    expect(getActiveCohorts(state).length).toBeGreaterThanOrEqual(1);
    void host;
  });
});

describe('Planetary ecological damage · Real SimHost forest-clearing & event deduplication', () => {
  it('end-to-end SimHost: real forest clearing stays peaceful below threshold and provokes adjacent hive once threshold is crossed without double-counting', () => {
    const { host, state, data } = createPeacefulColonyHost('real-clear-forest');
    state.colonies[0]!.powerSupplyOverride = 200;
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < hx.count; i++) {
      setTileOwner(state.grid, i, 0, 0);
    }
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -2, r: 0, instant: true, costOverride: {} });
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 6, r: 0, initialResidents: 5 }, 0, data);

    // Plant 2 wild forest tiles right beside the worker (q=2,r=0 and q=3,r=0; within hive habitat defense buffer of q=6,r=0)
    const f1 = hx.indexOf(2, 0);
    const f2 = hx.indexOf(3, 0);
    setTileTerrain(state.grid, f1, TERRAIN.forest, 0);
    setTilePrep(state.grid, f1, PREP.wild, 0);
    setTileTerrain(state.grid, f2, TERRAIN.forest, 0);
    setTilePrep(state.grid, f2, PREP.wild, 0);
    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 1, r: 0 });

    // 1. Clear first forest tile while colony has low ecological damage (commandHub 11 + clear 5 + tf 2 = 18 < 25): hive MUST remain passive!
    host.submit({
      commandId: 'clear-f1',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'clear', tiles: [{ q: 2, r: 0 }] } },
    });
    for (let t = 0; t < 60; t++) host.step(1);
    expect(state.grid.layers.terrain[f1]).toBe(TERRAIN.flat);
    const dmg1 = computeColonyPlanetDamage(state, 0, data);
    expect(dmg1.forestCleared).toBe(1); // deduplicated across tileStateChanged + obstacleRemoved
    expect(dmg1.damagedEnough).toBe(false);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);

    // 2. Add 1 thermal generator (+12 pts) -> clearing 2nd forest tile crosses 25 threshold and provokes hive!
    const id = state.meta.nextEntityId++;
    const row = insertRow(state.entities, id, state.meta.tick);
    state.entities.cols.kind[row] = BUILDING_KIND.thermalGenerator;
    state.entities.cols.owner[row] = 0;
    state.entities.cols.hp[row] = 400;
    state.entities.cols.hpMax[row] = 400;
    state.entities.cols.progress[row] = 1;
    state.entities.cols.state[row] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, row, -5, 0, state.meta.tick);

    host.submit({
      commandId: 'clear-f2',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'clear', tiles: [{ q: 3, r: 0 }] } },
    });
    for (let t = 0; t < 65; t++) host.step(1);
    expect(state.grid.layers.terrain[f2]).toBe(TERRAIN.flat);
    const dmg2 = computeColonyPlanetDamage(state, 0, data);
    expect(dmg2.forestCleared).toBe(2);
    expect(dmg2.damagedEnough).toBe(true);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(true);

    // 3. Also accepts hyphenated `col-0` colonyIds emitted by footprint reversion
    const tickNow = state.meta.tick + 1;
    ingestEcologicalDamageEvents(state, tickNow, {
      dt: 1,
      tick: tickNow,
      flags: new Set(['W00', 'W01', 'W07']),
      data,
      events: [
        {
          kind: 'obstacleRemoved',
          severity: 'info',
          atTick: tickNow,
          colonyIds: ['col-0'],
          data: { colonyId: 'col-0', q: -4, r: 0, op: 'clear', count: 1 },
        },
      ],
      postings: [],
      record: () => {},
      rng: () => state.rng.misc,
      newEntityId: () => state.meta.nextEntityId++,
      emit: () => {},
    });
    expect(computeColonyPlanetDamage(state, 0, data).forestCleared).toBe(3);
  });
});

describe('Planetary Ecological Damage: faunaKilled ingestion & hive provocation', () => {
  it('ingests faunaKilled events (single & batch counts), raising ecological damage and provoking nearby hives once over threshold', () => {
    const { state, data, pipeline } = createPeacefulColonyHost('fauna-kill-planet');
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {} });
    startBuildingConstruction(state, { owner: 0, building: 'roboticsFactory', q: 3, r: 0, instant: true, costOverride: {} });
    const hive2 = spawnHiveEntity(state, { species: 'blueBeetle', q: -8, r: 0, initialResidents: 2 }, 0, data);
    expect(isHiveAggressiveToColony(state, hive2, 0)).toBe(false);
    const dmgBefore = computeColonyPlanetDamage(state, 0, data);
    expect(dmgBefore.damagedEnough).toBe(false);

    const killTick = state.meta.tick + 2;
    ingestEcologicalDamageEvents(state, killTick, {
      dt: 1,
      tick: killTick,
      flags: pipeline.config.flags,
      data,
      events: [
        {
          kind: 'faunaKilled',
          severity: 'info',
          atTick: killTick,
          colonyIds: ['col_0'],
          data: { colonyIndex: 0, entityId: 999, species: 'blueBeetle', q: -7, r: 0, count: 3 },
        },
      ],
      postings: [],
      record: () => {},
      rng: () => state.rng.misc,
      newEntityId: () => state.meta.nextEntityId++,
      emit: () => {},
    });
    const dmgAfterKill = computeColonyPlanetDamage(state, 0, data);
    expect(dmgAfterKill.faunaKilled).toBe(3);
    expect(dmgAfterKill.damageScore).toBe(dmgBefore.damageScore + 12);
    expect(dmgAfterKill.damagedEnough).toBe(true);
    expect(isHiveAggressiveToColony(state, hive2, 0)).toBe(true);
  });
});

describe('Planetary Ecological Damage · W13 regional deposits, clean S3 colonies & multi-colony isolation', () => {
  it('does not count untouched W13 regional deposits as mined at tick 0 or after claiming territory', () => {
    const flags = createRegistryPipeline({ flags: parseWaves('..25') }).config.flags;
    for (const planetType of ['temperate', 'ocean', 'desert'] as const) {
      const region = regionForNewPlanet({ planetId: `pl_${planetType}`, planetType, flags });
      const state = createPlanet({ planetId: `pl_${planetType}`, planetType, seed: 'w13-pristine', radius: 32, region });
      const atZero = computeColonyPlanetDamage(state, 0);
      expect(atZero.depositsMined).toBe(0);
      expect(atZero.damagedEnough).toBe(false);

      // Claiming territory over untouched regional deposits must still keep depositsMined === 0
      for (let i = 0; i < Math.min(40, state.grid.count); i++) {
        setTileOwner(state.grid, i, 0, 5);
      }
      const afterClaim = computeColonyPlanetDamage(state, 0);
      expect(afterClaim.depositsMined).toBe(0);
      expect(afterClaim.damagedEnough).toBe(false);
    }
  });

  it('keeps a real solar-powered Stage-3 colony peaceful past S3 grace period and isolates rival-colony mining', () => {
    const { host, state, data } = createPeacefulColonyHost('clean-s3-solar');
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {} });
    startBuildingConstruction(state, { owner: 0, building: 'roboticsFactory', q: 4, r: 0, instant: true, costOverride: {} });
    startBuildingConstruction(state, { owner: 0, building: 'solarCollector', q: -3, r: 0, instant: true, costOverride: {} });
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 6 }, 0, data);

    // Colony 1 mines unowned deposits far away at (16, -12): must NOT blame peaceful Colony 0
    ensureColonyRecord(state, 1, 0).status = 'active';
    spawnHqUnit(state, { owner: 1, q: 16, r: -12 });
    const hx = hexIndex(state.grid.radius);
    for (let k = 0; k < 4; k++) {
      const idx = hx.indexOf(15 - k, -12);
      state.grid.layers.deposit[idx] = DEPOSIT.metals;
      state.grid.layers.richness[idx] = 1000;
    }

    expect(computeColonyPlanetDamage(state, 1, data).depositsMined).toBe(4);
    const col0Dmg = computeColonyPlanetDamage(state, 0, data);
    expect(col0Dmg.depositsMined).toBe(0);
    expect(col0Dmg.damagedEnough).toBe(false);

    state.meta.tick = 2999;
    expect(threatOf(state, 0).raidsAllowed).toBe(true);
    host.step(1);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);
    expect(getActiveCohorts(state)).toHaveLength(0);
  });
});
