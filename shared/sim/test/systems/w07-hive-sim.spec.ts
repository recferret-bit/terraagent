import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  acquireClosestTargetInRange,
  applyDamage,
  createPlanet,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getAllHives,
  getAllResidentBugs,
  getHiveRecord,
  getResidentBugRecord,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  insertRow,
  isHiveAggressiveToColony,
  isHostileTargetForAttacker,
  isUnitKind,
  landingBlock,
  materializeWorldgenHives,
  mobileStats,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  spawnHiveEntity,
  spawnHqUnit,
  TERRAIN,
  type PlanetState,
  type PlanetType,
} from '../../src';

function createW07FlatHost(radius = 24, seed = 'w07-hive-sim') {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w07-hive', planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  ensureColonyRecord(state, 0, 0).status = 'active';
  ensureColonyRecord(state, 1, 0).status = 'active';
  host.load(state);
  return { host, state, data: pipeline.config.data };
}

function spawnColonyUnit(
  state: PlanetState,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 200;
  cols.hpMax[row] = opts.hp ?? 200;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

describe('W07-14 · Worldgen hive placement and Delivery Gate 6 (W07 off)', () => {
  const PLANET_TYPES: PlanetType[] = ['desert', 'temperate', 'ocean'];

  it('places species hives on passable land strictly outside the 25-tile landing exclusions across all planet types', () => {
    for (const planetType of PLANET_TYPES) {
      const state = createPlanet({
        id: `p-${planetType}`,
        seed: `hive-world-${planetType}`,
        type: 'temperate',
        planetType,
        radius: 56,
      });

      // Delivery Gate 6: before W07 materializes hives, createPlanet leaves 0 fauna entities
      expect(state.entities.count).toBe(0);

      const hiveIds = materializeWorldgenHives(state);
      expect(hiveIds.length).toBeGreaterThanOrEqual(3);

      const slots = getSpawnSlots(state);
      const hex = hexIndex(state.grid.radius);
      const { terrain, prep, deposit } = state.grid.layers;
      const hives = getAllHives(state);
      expect(hives.length).toBe(hiveIds.length);

      const speciesSeen = new Set(hives.map((h) => h.species));
      expect(speciesSeen.has('blackAnt')).toBe(true);
      expect(speciesSeen.has('blueBeetle')).toBe(true);
      expect(speciesSeen.has('greenSpitter')).toBe(true);

      for (const hive of hives) {
        const ti = hex.indexOf(hive.q, hive.r);
        expect(ti).toBeGreaterThanOrEqual(0);
        expect([TERRAIN.flat, TERRAIN.slope]).toContain(terrain[ti]);
        expect(prep[ti]).not.toBe(PREP.ridge);
        expect(prep[ti]).not.toBe(PREP.moat);
        expect(deposit[ti]).toBe(DEPOSIT.none);

        for (const slot of slots) {
          expect(hexDistance(slot.q, slot.r, hive.q, hive.r)).toBeGreaterThan(25);
        }

        expect(hexDistance(hive.q, hive.r, hive.entranceQ, hive.entranceR)).toBe(1);
        const ei = hex.indexOf(hive.entranceQ, hive.entranceR);
        expect(ei).toBeGreaterThanOrEqual(0);
        expect([TERRAIN.flat, TERRAIN.slope]).toContain(terrain[ei]);
        expect(deposit[ei]).toBe(DEPOSIT.none);

        expect(hive.hp).toBe(1500);
        expect(hive.mode).toBe('passive');
        expect(hive.residentIds.length).toBeGreaterThan(0);
        expect(hive.residentIds.length).toBeLessThanOrEqual(hive.popCap);

        // Landing planner respects live hives so later landings never overlap a hive
        expect(landingBlock(state, 0, hive.q, hive.r)).toBe('landing_site_taken');
      }

      const bugs = getAllResidentBugs(state);
      expect(bugs.length).toBeGreaterThan(0);
      for (const bug of bugs) {
        expect(['blackAnt', 'blueBeetle', 'greenSpitter']).toContain(bug.species);
        expect(getHiveRecord(state, bug.homeHiveId)?.species).toBe(bug.species);
        expect(bug.mode).toBe('passive');
      }
    }
  });

  it('registers all three bug species as mobile units in mobility.ts and leaves W01..W06 hosts free of fauna when W07 is off', () => {
    const w06Host = new SimHost(createRegistryPipeline({ flags: parseWaves('..06') }));
    const planet = createPlanet({
      id: 'p-w06',
      seed: 'gate-6-seed',
      type: 'temperate',
      planetType: 'temperate',
      radius: 56,
    });
    w06Host.load(planet);
    w06Host.step(10);
    expect(w06Host.state.entities.count).toBe(0);
    expect(w06Host.state.blobs.faunaHives).toBeUndefined();

    const w07Data = createRegistryPipeline({ flags: parseWaves('..07') }).config.data;
    expect(isUnitKind(ENTITY_KIND.blackAnt)).toBe(true);
    expect(isUnitKind(ENTITY_KIND.blueBeetle)).toBe(true);
    expect(isUnitKind(ENTITY_KIND.greenSpitter)).toBe(true);
    expect(mobileStats(ENTITY_KIND.blackAnt, w07Data)?.speedPerTick).toBeCloseTo(0.4, 5);
    expect(mobileStats(ENTITY_KIND.blueBeetle, w07Data)?.speedPerTick).toBeCloseTo(0.16, 5);
    expect(mobileStats(ENTITY_KIND.greenSpitter, w07Data)?.speedPerTick).toBeCloseTo(0.28, 5);
  });
});

describe('W07-14 · Acceptance Check Part 1: passive bugs and hives ignore passing units', () => {
  it('passive bugs wander around their home hive via locomotion and deal 0 damage to passing units; colony units do not auto-fire', () => {
    const { host, state, data } = createW07FlatHost(24, 'passive-encounter');

    const antHiveId = spawnHiveEntity(
      state,
      { species: 'blackAnt', q: 0, r: 0, initialResidents: 3 },
      0,
      data,
    );
    const beetleHiveId = spawnHiveEntity(
      state,
      { species: 'blueBeetle', q: 10, r: 0, initialResidents: 2 },
      0,
      data,
    );
    const spitterHiveId = spawnHiveEntity(
      state,
      { species: 'greenSpitter', q: -10, r: 0, initialResidents: 2 },
      0,
      data,
    );

    const reconId = spawnColonyUnit(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: -3,
      r: 1,
      hp: 160,
    });
    const harvId = spawnColonyUnit(state, {
      kind: ENTITY_KIND.harvester,
      owner: 0,
      q: 2,
      r: -1,
      hp: 350,
    });

    // Order the recon to walk right past the ant hive
    host.submit({
      commandId: 'walk-past',
      colonyIndex: 0,
      source: 'player',
      kind: 'moveUnit',
      args: { entityId: reconId, q: 4, r: 1 },
    });

    const cols = state.entities.cols;
    const antBugs = getHiveRecord(state, antHiveId)!.residentIds;
    const initialBugPositions = antBugs.map((id) => {
      const r = rowOf(state.entities, id);
      return { id, x: cols.x[r]!, y: cols.y[r]! };
    });

    let movedCount = 0;
    for (let t = 0; t < 50; t++) {
      const prevX = new Map<number, [number, number]>();
      for (const bug of getAllResidentBugs(state)) {
        const r = rowOf(state.entities, bug.entityId);
        prevX.set(bug.entityId, [cols.x[r]!, cols.y[r]!]);
      }

      host.step(1);

      // SIM-M-01: no bug ever moves faster than its speedPerTick
      for (const bug of getAllResidentBugs(state)) {
        const r = rowOf(state.entities, bug.entityId);
        const prev = prevX.get(bug.entityId);
        if (!prev) continue;
        const stepDist = hexDistance(prev[0], prev[1], cols.x[r]!, cols.y[r]!);
        const maxStep = mobileStats(cols.kind[r]!, data)!.speedPerTick + 1e-4;
        expect(stepDist).toBeLessThanOrEqual(maxStep);
      }
    }

    for (const init of initialBugPositions) {
      const r = rowOf(state.entities, init.id);
      if (hexDistance(init.x, init.y, cols.x[r]!, cols.y[r]!) > 0.1) {
        movedCount++;
      }
    }
    expect(movedCount).toBeGreaterThan(0);

    // Passing units took 0 damage
    const reconRow = rowOf(state.entities, reconId);
    const harvRow = rowOf(state.entities, harvId);
    expect(cols.hp[reconRow]).toBe(160);
    expect(cols.hp[harvRow]).toBe(350);

    // Colony units do not treat passive bugs or hives as auto-fire targets
    expect(acquireClosestTargetInRange(state, reconRow, { data })).toBe(-1);
    for (const hid of [antHiveId, beetleHiveId, spitterHiveId]) {
      expect(getHiveRecord(state, hid)?.mode).toBe('passive');
      expect(isHostileTargetForAttacker(state, reconRow, rowOf(state.entities, hid))).toBe(false);
    }
  });
});

describe('W07-14 · Acceptance Check Part 2: attacking one provokes ONLY that hive against ONLY that colony', () => {
  it('provokes only the attacked hive against the attacking colony while other hives and other colonies remain neutral', () => {
    const { host, state, data } = createW07FlatHost(24, 'scoped-provocation');

    const hiveA = spawnHiveEntity(state, { species: 'blackAnt', q: 0, r: 0, initialResidents: 3 }, 0, data);
    const hiveB = spawnHiveEntity(state, { species: 'blueBeetle', q: 0, r: 8, initialResidents: 2 }, 0, data);
    const hiveC = spawnHiveEntity(state, { species: 'greenSpitter', q: -8, r: 0, initialResidents: 2 }, 0, data);
    const colony0Hq = spawnHqUnit(state, { owner: 0, q: 2, r: 0 });
    const colony1Recon = spawnColonyUnit(state, { kind: ENTITY_KIND.recon, owner: 1, q: -2, r: 0, hp: 160 });
    const colony0NearHiveB = spawnColonyUnit(state, { kind: ENTITY_KIND.harvester, owner: 0, q: 1, r: 8, hp: 350 });

    const cols = state.entities.cols;
    const hq0Row = rowOf(state.entities, colony0Hq);
    const hq0InitialHp = cols.hp[hq0Row]!;

    const bugAId = getHiveRecord(state, hiveA)!.residentIds[0]!;
    // Colony 0 deals confirmed damage to bugA of hiveA
    applyDamage(state, bugAId, 20, { attackerId: colony0Hq, attackerOwner: 0, tick: host.tick });

    // Hive A is now aggressive ONLY toward Colony 0
    expect(getHiveRecord(state, hiveA)?.mode).toBe('aggressive');
    expect(isHiveAggressiveToColony(state, hiveA, 0)).toBe(true);
    expect(isHiveAggressiveToColony(state, hiveA, 1)).toBe(false);

    // Hive B and Hive C remain completely passive
    expect(getHiveRecord(state, hiveB)?.mode).toBe('passive');
    expect(isHiveAggressiveToColony(state, hiveB, 0)).toBe(false);
    expect(getHiveRecord(state, hiveC)?.mode).toBe('passive');
    expect(isHiveAggressiveToColony(state, hiveC, 0)).toBe(false);

    // Targeting checks agree: Colony 0 sees Hive A as hostile and Hive B as passive; Colony 1 sees both as passive
    const hiveARow = rowOf(state.entities, hiveA);
    const hiveBRow = rowOf(state.entities, hiveB);
    const col1Row = rowOf(state.entities, colony1Recon);
    expect(isHostileTargetForAttacker(state, hq0Row, hiveARow)).toBe(true);
    expect(isHostileTargetForAttacker(state, hq0Row, hiveBRow)).toBe(false);
    expect(isHostileTargetForAttacker(state, col1Row, hiveARow)).toBe(false);
    expect(isHostileTargetForAttacker(state, col1Row, hiveBRow)).toBe(false);

    // Step 25 ticks (1 tick per step): Hive A's ants close in and bite Colony 0's HQ, while ignoring Colony 1's recon; Hive B ignores Colony 0's harvester
    for (let i = 0; i < 25; i++) host.step(1);

    expect(cols.hp[rowOf(state.entities, colony0Hq)]).toBeLessThan(hq0InitialHp);
    expect(cols.hp[rowOf(state.entities, colony1Recon)]).toBe(160);
    expect(cols.hp[rowOf(state.entities, colony0NearHiveB)]).toBe(350);
  });

  it('fires ranged acid projectiles when a greenSpitter hive is provoked by a colony', () => {
    const { host, state, data } = createW07FlatHost(24, 'spitter-provocation');
    const hiveC = spawnHiveEntity(
      state,
      { species: 'greenSpitter', q: -8, r: 0, initialResidents: 2 },
      0,
      data,
    );
    const colony1Recon = spawnColonyUnit(state, {
      kind: ENTITY_KIND.harvester,
      owner: 1,
      q: -5,
      r: 0,
      hp: 160,
    });

    applyDamage(state, hiveC, 50, { attackerId: colony1Recon, attackerOwner: 1, tick: host.tick });
    expect(isHiveAggressiveToColony(state, hiveC, 1)).toBe(true);
    expect(isHiveAggressiveToColony(state, hiveC, 0)).toBe(false);

    const spitters = getHiveRecord(state, hiveC)!.residentIds;
    expect(spitters.length).toBeGreaterThan(0);
    for (let i = 0; i < 25; i++) host.step(1);
    expect(state.entities.cols.hp[rowOf(state.entities, colony1Recon)]).toBeLessThan(160);
  });
});

describe('W07-14 · Acceptance Check Part 3: residents replenish up to cap and stop when hive is destroyed', () => {
  it('replenishes blackAnt residents every 60 s (300 ticks) up to cap 12, never exceeds cap, and stops when hive is destroyed', () => {
    const { host, state, data } = createW07FlatHost(20, 'replenish-cap');

    // Verify species popCaps and replenish intervals (12/3/6 and 60/180/120 s = 300/900/600 ticks)
    const antHiveId = spawnHiveEntity(
      state,
      { species: 'blackAnt', q: 0, r: 0, initialResidents: 11 },
      0,
      data,
    );
    const beetleHiveId = spawnHiveEntity(
      state,
      { species: 'blueBeetle', q: 8, r: 0, initialResidents: 3 },
      0,
      data,
    );
    const spitterHiveId = spawnHiveEntity(
      state,
      { species: 'greenSpitter', q: -8, r: 0, initialResidents: 6 },
      0,
      data,
    );

    expect(getHiveRecord(state, antHiveId)?.popCap).toBe(12);
    expect(getHiveRecord(state, antHiveId)?.replenishTicks).toBe(300);
    expect(getHiveRecord(state, beetleHiveId)?.popCap).toBe(3);
    expect(getHiveRecord(state, beetleHiveId)?.replenishTicks).toBe(900);
    expect(getHiveRecord(state, spitterHiveId)?.popCap).toBe(6);
    expect(getHiveRecord(state, spitterHiveId)?.replenishTicks).toBe(600);

    expect(getHiveRecord(state, antHiveId)?.residentIds).toHaveLength(11);

    // Step 299 ticks: not yet 300 ticks (60 s)
    host.step(299);
    expect(getHiveRecord(state, antHiveId)?.residentIds).toHaveLength(11);

    // Tick 300: 12th resident spawns at the entrance via placeSpawnedEntity
    host.step(1);
    const hiveAt300 = getHiveRecord(state, antHiveId)!;
    expect(hiveAt300.residentIds).toHaveLength(12);
    const newestBugId = hiveAt300.residentIds[11]!;
    const newestBug = getResidentBugRecord(state, newestBugId)!;
    expect(newestBug.homeHiveId).toBe(antHiveId);
    expect(newestBug.species).toBe('blackAnt');
    expect(newestBug.mode).toBe('passive');

    // Step another 350 ticks: cap is 12, so no 13th resident spawns
    host.step(350);
    expect(getHiveRecord(state, antHiveId)?.residentIds).toHaveLength(12);

    // Kill one resident bug (drops to 11), then destroy the hive
    applyDamage(state, newestBugId, 999, { tick: host.tick });
    applyDamage(state, antHiveId, 1500, { tick: host.tick });
    host.step(1);

    const destroyedHive = getHiveRecord(state, antHiveId)!;
    expect(destroyedHive.destroyed).toBe(true);
    expect(destroyedHive.residentIds).toHaveLength(11);
    // Surviving residents keep their tombstone homeHiveId
    for (const survId of destroyedHive.residentIds) {
      expect(getResidentBugRecord(state, survId)?.homeHiveId).toBe(antHiveId);
    }

    // Step 400 more ticks: destroyed hive never replenishes
    host.step(400);
    expect(getHiveRecord(state, antHiveId)?.residentIds).toHaveLength(11);
  });
});
