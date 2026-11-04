import { describe, expect, it } from 'vitest';
import { NestDestroyedDataSchema, parseWaves } from '@terra/contracts';
import {
  acquireClosestTargetInRange,
  applyDamage,
  BUILDING_KIND,
  computeWaveThreatBudget,
  createPlanet,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  FAUNA_SPECIES_THREAT_COSTS,
  fireProjectile,
  getActiveCohorts,
  getAllHives,
  getAllResidentBugs,
  getHiveRecord,
  getPendingProjectileImpacts,
  getResidentBugRecord,
  getSpawnSlots,
  getWorldgenHiveSites,
  hexDistance,
  hexIndex,
  insertRow,
  isFaunaEntityAggressiveToColony,
  isHiveAggressiveToColony,
  isHostileTargetForAttacker,
  materializeWorldgenHives,
  placeSpawnedEntity,
  planWorldgenHiveSites,
  PREP,
  provokeHiveAgainstColony,
  resolveSpeciesConfig,
  resolveWaveConfig,
  rowOf,
  SimHost,
  spawnHiveEntity,
  spawnHiveRaidWave,
  spawnHqUnit,
  startBuildingConstruction,
  stepProjectileImpacts,
  TERRAIN,
  threatOf,
  TICKS_PER_SECOND,
  type PlanetState,
  type SimEvent,
  type StepContext,
} from '../src';

function createW07FaunaHost(seed = 'w07-fauna-spec', radius = 24, waves = '..07') {
  const flags = parseWaves(waves);
  const pipeline = createRegistryPipeline({ flags });
  const data = pipeline.config.data;
  const host = new SimHost(pipeline);
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);

  const col0 = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2000 });
  col0.status = 'active';
  col0.stock['metals.t1'] = 800;
  col0.stock['minerals.t1'] = 600;
  col0.stage = 3;
  col0.threatStage = 3;
  col0.unlockStage = 3;
  col0.s3ReachedAtTick = 0;

  const col1 = ensureColonyLedger(ensureColonyRecord(state, 1, 0), { baseCap: 2000 });
  col1.status = 'active';

  spawnHqUnit(state, { owner: 0, q: -2, r: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data });
  startBuildingConstruction(state, { owner: 0, building: 'roboticsFactory', q: 4, r: 0, instant: true, costOverride: {}, data });

  host.load(state);
  return { host, state, data, pipeline };
}

function spawnUnit(
  state: PlanetState,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 200;
  cols.hpMax[row] = opts.hp ?? 200;
  cols.state[row] = ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('W07-31 · Worldgen hive placement (faunaHives stage, clearances, footprint, initial residents)', () => {
  it('places all 3 species with >= 16-tile spawn clearance, >= 10-tile hive spacing, passable footprint, and initial residents (4/2/3)', () => {
    const state = createPlanet({
      id: 'p-fauna-worldgen',
      seed: 'w07-31-worldgen',
      type: 'temperate',
      planetType: 'temperate',
      radius: 56,
    });
    const sites = getWorldgenHiveSites(state);
    expect(sites.length).toBeGreaterThanOrEqual(3);

    const slots = getSpawnSlots(state);
    const hex = hexIndex(state.grid.radius);
    const { terrain, deposit } = state.grid.layers;

    for (let i = 0; i < sites.length; i++) {
      const s = sites[i]!;
      for (const slot of slots) {
        expect(hexDistance(slot.q, slot.r, s.q, s.r)).toBeGreaterThanOrEqual(16);
      }
      for (let j = i + 1; j < sites.length; j++) {
        const other = sites[j]!;
        expect(hexDistance(s.q, s.r, other.q, other.r)).toBeGreaterThanOrEqual(10);
      }
      const ti = hex.indexOf(s.q, s.r);
      const ei = hex.indexOf(s.entranceQ, s.entranceR);
      expect([TERRAIN.flat, TERRAIN.slope]).toContain(terrain[ti]);
      expect([TERRAIN.flat, TERRAIN.slope]).toContain(terrain[ei]);
      expect(deposit[ti]).toBe(DEPOSIT.none);
      expect(hexDistance(s.q, s.r, s.entranceQ, s.entranceR)).toBe(1);
    }

    // Verify initial residents per species (blackAnt: 4, blueBeetle: 2, greenSpitter: 3)
    const w07Data = createRegistryPipeline({ flags: parseWaves('..07') }).config.data;
    expect(resolveSpeciesConfig('blackAnt', w07Data).initialResidents).toBe(4);
    expect(resolveSpeciesConfig('blueBeetle', w07Data).initialResidents).toBe(2);
    expect(resolveSpeciesConfig('greenSpitter', w07Data).initialResidents).toBe(3);

    const hiveIds = materializeWorldgenHives(state, 0, w07Data);
    expect(hiveIds.length).toBe(sites.length);
    const hives = getAllHives(state);
    const speciesSet = new Set(hives.map((h) => h.species));
    expect(speciesSet).toEqual(new Set(['blackAnt', 'blueBeetle', 'greenSpitter']));

    for (const h of hives) {
      const expectedInit = resolveSpeciesConfig(h.species, w07Data).initialResidents;
      expect(h.residentIds).toHaveLength(expectedInit);
      const hRow = rowOf(state.entities, h.hiveId);
      expect(state.entities.cols.footprintW[hRow]).toBeGreaterThanOrEqual(2);
    }

    const customSites = planWorldgenHiveSites(state, { minExclusionRadius: 16, minSpacingTiles: 10, count: 4 });
    expect(customSites).toHaveLength(4);
  });
});

describe('W07-31 · Passive targeting (Hold, Defend, and Hunt stances ignore passive bugs and hives)', () => {
  it('prevents colony units in Hold, Defend, and Hunt stances and defense turrets from auto-targeting passive fauna', () => {
    const { host, state, data } = createW07FaunaHost('passive-stances', 20);
    state.colonies[0]!.powerSupplyOverride = 100;

    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 5, r: 0, initialResidents: 4 }, 0, data);
    const reconHold = spawnUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 0 });
    const reconDefend = spawnUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 1 });
    const reconHunt = spawnUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: -1 });
    const turret = spawnUnit(state, { kind: ENTITY_KIND.autocannon, owner: 0, q: 2, r: 0, hp: 450 });
    const laser = spawnUnit(state, { kind: ENTITY_KIND.laserTower, owner: 0, q: 2, r: 1, hp: 400 });

    host.submit({ commandId: 'st-hold', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: reconHold.id, stance: 'hold' } });
    host.submit({ commandId: 'st-def', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: reconDefend.id, stance: 'defend' } });
    host.submit({ commandId: 'st-hunt', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: reconHunt.id, stance: 'hunt' } });

    host.step(15);

    const hiveRow = rowOf(state.entities, hiveId);
    expect(state.entities.cols.hp[hiveRow]).toBe(1500);
    expect(getHiveRecord(state, hiveId)?.mode).toBe('passive');

    for (const bugId of getHiveRecord(state, hiveId)!.residentIds) {
      const bRow = rowOf(state.entities, bugId);
      expect(state.entities.cols.hp[bRow]).toBe(120);
      expect(isHostileTargetForAttacker(state, reconHunt.row, bRow)).toBe(false);
    }

    expect(acquireClosestTargetInRange(state, reconHold.row, { data })).toBe(-1);
    expect(acquireClosestTargetInRange(state, reconDefend.row, { data })).toBe(-1);
    expect(acquireClosestTargetInRange(state, reconHunt.row, { maxRange: 15, requireSpotting: false, data })).toBe(-1);
    expect(acquireClosestTargetInRange(state, turret.row, { data })).toBe(-1);
    expect(acquireClosestTargetInRange(state, laser.row, { data })).toBe(-1);
  });
});

describe('W07-31 · Colony-scoped provocation (aggressiveColonies isolated to offending colony)', () => {
  it('keeps passive hives neutral on proximity/territory overlap and scopes damage provocation strictly to the offending colony', () => {
    const { host, state, data } = createW07FaunaHost('scoped-provoke', 22);
    const hiveA = spawnHiveEntity(state, { species: 'blackAnt', q: 8, r: 0, initialResidents: 4 }, 0, data);
    const hiveB = spawnHiveEntity(state, { species: 'blueBeetle', q: -8, r: 0, initialResidents: 2 }, 0, data);

    const col0Unit = spawnUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 6, r: 0, hp: 160 });
    const col1Unit = spawnUnit(state, { kind: ENTITY_KIND.recon, owner: 1, q: 9, r: 0, hp: 160 });

    // Standing within 5 tiles for > 3 ticks does not provoke passive hives
    host.step(6);
    expect(getHiveRecord(state, hiveA)?.mode).toBe('passive');
    expect(getHiveRecord(state, hiveA)?.aggressiveColonies).toEqual([]);

    // Colony 0 damages Hive A -> only Hive A becomes aggressive to Colony 0; Colony 1 and Hive B stay unprovoked
    applyDamage(state, hiveA, 25, { attackerId: col0Unit.id, attackerOwner: 0, tick: host.tick });
    host.step(1);

    const recA = getHiveRecord(state, hiveA)!;
    expect(recA.mode).toBe('aggressive');
    expect(recA.aggressiveColonies).toEqual([0]);
    expect(isHiveAggressiveToColony(state, hiveA, 0)).toBe(true);
    expect(isHiveAggressiveToColony(state, hiveA, 1)).toBe(false);
    expect(isHiveAggressiveToColony(state, hiveB, 0)).toBe(false);

    for (const memberId of getActiveCohorts(state)[0]!.memberIds) {
      expect(isFaunaEntityAggressiveToColony(state, memberId, 0)).toBe(true);
      expect(isFaunaEntityAggressiveToColony(state, memberId, 1)).toBe(false);
    }

    host.step(15);
    expect(state.entities.cols.hp[col1Unit.row]).toBe(160); // Uninvolved Colony 1 takes 0 damage
  });
});

describe('W07-31 · Bounded raid waves (maxWavesPerEpisode=3, 300-tick cooldown, <=1 cohort, 1500-tick / unreachable withdrawal)', () => {
  it('enforces maxWavesPerEpisode=3, 300-tick cooldown, at most 1 active cohort per (hiveId, colony), and withdrawal on timeout or unreachable target', () => {
    const { host, state, data } = createW07FaunaHost('bounded-waves', 24);
    const waveCfg = resolveWaveConfig(data);
    expect(waveCfg.maxWavesPerEpisode).toBe(3);
    expect(waveCfg.waveCooldownTicks).toBe(300);
    expect(waveCfg.waveRetreatTimeoutTicks).toBe(1500);

    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 12 }, 0, data);

    // Trigger Wave 1; repeated damage during Wave 1 keeps active cohorts at 1 and wavesSent at 1
    applyDamage(state, hiveId, 20, { attackerOwner: 0, tick: host.tick });
    host.step(1);
    for (let i = 0; i < 4; i++) {
      applyDamage(state, hiveId, 10, { attackerOwner: 0, tick: host.tick });
      host.step(1);
    }
    expect(getActiveCohorts(state)).toHaveLength(1);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(1);

    // Kill Wave 1 -> cooldown blocks Wave 2 before 300 ticks, then Wave 2 dispatches at +300 ticks
    for (const id of getActiveCohorts(state)[0]!.memberIds) applyDamage(state, id, 999, { attackerOwner: 0, tick: host.tick });
    host.step(1);
    expect(getActiveCohorts(state)).toHaveLength(0);
    host.step(100);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(1);
    host.step(200);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(2);

    // Kill Wave 2 -> wait 300 ticks -> Wave 3 dispatches
    for (const id of getActiveCohorts(state)[0]!.memberIds) applyDamage(state, id, 999, { attackerOwner: 0, tick: host.tick });
    host.step(301);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(3);

    // Test 1500-tick (300 s) withdrawal timeout on Wave 3: advance meta.tick by 1500 and step 1
    const wave3Ids = [...getActiveCohorts(state)[0]!.memberIds];
    state.meta.tick += 1500;
    const withdrawStep = host.step(1);
    expect(withdrawStep.events.some((e) => e.kind === 'raidRepelled')).toBe(false);
    expect(getActiveCohorts(state)).toHaveLength(0);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);
    for (const id of wave3Ids) {
      if (rowOf(state.entities, id) >= 0) {
        expect(getResidentBugRecord(state, id)?.mode).toBe('passive');
      }
    }

    // Unreachable target withdrawal: ring hive2 with deep water
    const hive2 = spawnHiveEntity(state, { species: 'blueBeetle', q: -12, r: 0, initialResidents: 2 }, host.tick, data);
    const hx = hexIndex(state.grid.radius);
    for (let dr = -3; dr <= 3; dr++) {
      for (let dq = -3; dq <= 3; dq++) {
        if ((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 === 2) {
          const ti = hx.indexOf(-12 + dq, dr);
          if (ti >= 0) state.grid.layers.terrain[ti] = TERRAIN.deep;
        }
      }
    }
    expect(spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: hive2, data })).not.toBeNull();
    host.step(2);
    expect(getActiveCohorts(state)).toHaveLength(0);
  });
});

describe('W07-31 · Acid projectile impact (greenSpitter spitterAcid, projectileImpacts queue, no friendly fire)', () => {
  it('fires spitterAcid into projectileImpacts and resolves arrival damage & splash without friendly fire to other fauna', () => {
    const { host, state, data } = createW07FaunaHost('acid-impact', 20);
    const spitterHive = spawnHiveEntity(state, { species: 'greenSpitter', q: 9, r: 0, initialResidents: 2 }, 0, data);
    const targetHarv = spawnUnit(state, { kind: ENTITY_KIND.harvester, owner: 0, q: 6, r: 0, hp: 300 });
    const bystanderAnt = spawnUnit(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 6, r: 1, hp: 120 });

    applyDamage(state, spitterHive, 30, { attackerId: targetHarv.id, attackerOwner: 0, tick: host.tick });

    let sawQueuedAcid = false;
    for (let i = 0; i < 15; i++) {
      host.step(1);
      if (getPendingProjectileImpacts(state).some((p) => p.weaponId === 'spitterAcid' && p.weaponKind === 'acid')) {
        sawQueuedAcid = true;
      }
    }
    expect(sawQueuedAcid).toBe(true);
    expect(state.entities.cols.hp[targetHarv.row]).toBeLessThan(300);
    expect(state.entities.cols.hp[bystanderAnt.row]).toBe(120);

    // Direct acid splash verification: aoe 0.8 hits colony unit and deals 0 friendly fire to bystanderAnt (owner -1)
    stepProjectileImpacts(state, state.meta.tick + 100);
    const spitterId = getHiveRecord(state, spitterHive)!.residentIds[0]!;
    const hpBefore = state.entities.cols.hp[targetHarv.row]!;
    const p = fireProjectile(state, {
      attackerId: spitterId,
      attackerOwner: -1,
      targetId: targetHarv.id,
      weaponId: 'spitterAcid',
      weaponKind: 'acid',
      damage: 12,
      speed: 4,
      aoe: 0.8,
      tick: state.meta.tick,
    });
    state.meta.tick = p.impactTick;
    stepProjectileImpacts(state, p.impactTick);
    expect(state.entities.cols.hp[targetHarv.row]).toBe(hpBefore - 12);
    expect(state.entities.cols.hp[bystanderAnt.row]).toBe(120);
  });
});

describe('W07-31 · Species threat budgets (1 / 2 / 4, min(12, 2 + threatStage + thermalCount), living residents only)', () => {
  it('computes min(12, 2 + threatStage + thermalCount) and dispatches only living available residents by species cost', () => {
    const { state, data } = createW07FaunaHost('threat-budgets', 24, '..08');
    expect(FAUNA_SPECIES_THREAT_COSTS).toEqual({ blackAnt: 1, greenSpitter: 2, blueBeetle: 4 });

    state.meta.tick = 6 * 60 * TICKS_PER_SECOND;
    // At threatStage 3 with 0 thermals -> budget = min(12, 2 + 3 + 0) = 5
    expect(computeWaveThreatBudget(state, 0)).toBe(5);
    expect(threatOf(state, 0).speciesWaves).toEqual({ blackAnt: 5, greenSpitter: 2, blueBeetle: 1 });

    // Add 10 thermal generators -> budget = min(12, 2 + 3 + 10) = 12
    for (let i = 0; i < 10; i++) {
      const r = insertRow(state.entities, state.meta.nextEntityId++, 0);
      state.entities.cols.kind[r] = BUILDING_KIND.thermalGenerator;
      state.entities.cols.owner[r] = 0;
      state.entities.cols.hp[r] = 400;
      state.entities.cols.hpMax[r] = 400;
      state.entities.cols.progress[r] = 1;
      state.entities.cols.state[r] = ENTITY_STATE.active;
    }
    expect(computeWaveThreatBudget(state, 0)).toBe(12);

    // Hive with only 3 living ants at budget 12 dispatches only the 3 living residents (never spawns free units)
    const antHive = spawnHiveEntity(state, { species: 'blackAnt', q: 12, r: 0, initialResidents: 3 }, 0, data);
    const countBefore = state.entities.count;
    const cohort = spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: antHive, data });
    expect(cohort?.memberIds).toHaveLength(3);
    expect(state.entities.count).toBe(countBefore);
  });
});

describe('W07-31 · Population bounds, orphan resolution on hive death, and wave flag disabled (..06)', () => {
  it('enforces per-hive popCap (8/4/6 & 12/3/6) and planet cap <= 64, resolves orphans on hive death with nestDestroyed, and is inactive on ..06', () => {
    const { host, state, data } = createW07FaunaHost('pop-and-orphans', 24);

    // 1. Per-hive residentCap (custom 8 / 4 / 6) and replenishment stop at cap
    const hAnt = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, popCap: 8, initialResidents: 7, replenishTicks: 10 }, 0, data);
    const hBeetle = spawnHiveEntity(state, { species: 'blueBeetle', q: -10, r: 0, popCap: 4, initialResidents: 4, replenishTicks: 10 }, 0, data);
    const hSpitter = spawnHiveEntity(state, { species: 'greenSpitter', q: 0, r: 10, popCap: 6, initialResidents: 6, replenishTicks: 10 }, 0, data);

    host.step(25);
    expect(getHiveRecord(state, hAnt)?.residentIds).toHaveLength(8);
    expect(getHiveRecord(state, hBeetle)?.residentIds).toHaveLength(4);
    expect(getHiveRecord(state, hSpitter)?.residentIds).toHaveLength(6);
    expect(getAllResidentBugs(state).length).toBeLessThanOrEqual(64);

    // 2. Orphan resolution on hive death: active cohort finishes wave, non-cohort residents stay passive, replenishment stops
    provokeHiveAgainstColony(state, hAnt, 0, host.tick, data);
    host.step(1);
    const cohort = getActiveCohorts(state).find((c) => c.hiveId === hAnt)!;
    expect(cohort.memberIds).toHaveLength(5);
    const nonCohortIds = getHiveRecord(state, hAnt)!.residentIds.filter((id) => !cohort.memberIds.includes(id));
    expect(nonCohortIds).toHaveLength(3);

    const events: SimEvent[] = [];
    const ctx: StepContext = {
      dt: 1,
      tick: host.tick,
      flags: new Set(parseWaves('..07').list),
      data,
      events,
      postings: [],
      rng: (s) => state.rng[s],
      newEntityId: () => state.meta.nextEntityId++,
      emit: (e) => events.push({ severity: 'info', colonyIds: [], data: {}, ...e, atTick: host.tick }),
      record: () => undefined,
    };
    const destroyRes = applyDamage(state, hAnt, 2000, { attackerOwner: 0, tick: host.tick, ctx });
    expect(destroyRes.destroyed).toBe(true);
    const nestEv = events.find((e) => e.kind === 'nestDestroyed');
    expect(nestEv).toBeDefined();
    expect(() => NestDestroyedDataSchema.parse(nestEv!.data)).not.toThrow();

    host.step(1);
    expect(getHiveRecord(state, hAnt)?.destroyed).toBe(true);
    for (const id of cohort.memberIds) {
      expect(getResidentBugRecord(state, id)?.mode).toBe('aggressive');
    }
    for (const id of nonCohortIds) {
      expect(getResidentBugRecord(state, id)?.mode).toBe('passive');
      expect(getResidentBugRecord(state, id)?.homeHiveId).toBe(hAnt);
    }

    // Kill one non-cohort resident and step 50 ticks -> no replenishment and no second wave
    applyDamage(state, nonCohortIds[0]!, 999, { tick: host.tick });
    for (const id of cohort.memberIds) applyDamage(state, id, 999, { attackerOwner: 0, tick: host.tick });
    host.step(50);
    expect(getHiveRecord(state, hAnt)?.residentIds).toHaveLength(2);
    expect(getActiveCohorts(state).filter((c) => c.hiveId === hAnt)).toHaveLength(0);

    // 3. Wave flag disabled (..06): 0 hives and 0 fauna entities
    const w06Pipeline = createRegistryPipeline({ flags: parseWaves('..06') });
    expect(w06Pipeline.systems.some((s) => s.id === 'fauna' || s.id === 'fauna.combat')).toBe(false);
    const w06Host = new SimHost(w06Pipeline);
    const w06Planet = createPlanet({ id: 'p-w06-fauna', seed: 'w06-no-fauna', type: 'temperate', planetType: 'temperate', radius: 48 });
    w06Host.load(w06Planet);
    w06Host.step(10);
    expect(getAllHives(w06Host.state)).toHaveLength(0);
    expect(getAllResidentBugs(w06Host.state)).toHaveLength(0);
    expect(w06Host.state.entities.count).toBe(0);
  });
});
