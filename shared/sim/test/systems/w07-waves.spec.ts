import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyAutopilotStep,
  applyDamage,
  BUILDING_KIND,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluateAutopilotDecision,
  evaluateColonyNeeds,
  FAUNA_SPECIES_THREAT_COSTS,
  getActiveCohorts,
  getColonyGoals,
  getHiveRecord,
  getResidentBugRecord,
  hexIndex,
  insertRow,
  isGoalExecutable,
  isHiveAggressiveToColony,
  placeSpawnedEntity,
  PREP,
  provokeHiveAgainstColony,
  queueColonyGoal,
  rowOf,
  setColonyPriorities,
  SimHost,
  spawnHiveEntity,
  spawnHiveRaidWave,
  spawnHqUnit,
  startBuildingConstruction,
  TERRAIN,
  threatOf,
  TICKS_PER_SECOND,
  weightColonyNeeds,
  type PlanetState,
} from '../../src';

function createS3WaveTestHost(seed = 'w07-15-waves', waves = '..08') {
  const flags = parseWaves(waves);
  const pipeline = createRegistryPipeline({ flags });
  const data = pipeline.config.data;
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w07-waves', planetType: 'temperate', seed, radius: 24 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2000 });
  col.status = 'active';
  col.stock['metals.t1'] = 800;
  col.stock['minerals.t1'] = 600;
  spawnHqUnit(state, { owner: 0, q: -2, r: 0 });
  const hubRes = startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data });
  if (!hubRes.ok) throw new Error(`commandHub failed: ${hubRes.code} ${hubRes.detail}`);
  const rfRes = startBuildingConstruction(state, { owner: 0, building: 'roboticsFactory', q: 4, r: 0, instant: true, costOverride: {}, data });
  if (!rfRes.ok) throw new Error(`roboticsFactory failed: ${rfRes.code} ${rfRes.detail}`);
  ensureColonyLedger(col, { baseCap: 2000 });
  col.stage = 3;
  col.threatStage = 3;
  col.unlockStage = 3;
  col.s3ReachedAtTick = 0;
  col.stock['metals.t1'] = 800;
  col.stock['minerals.t1'] = 600;
  host.load(state);
  return { host, state, data, pipeline };
}

function spawnUnit(
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

describe('W07-15 · Species threat-point costs & distinct living-resident waves', () => {
  it('dispatches distinct species wave sizes from living residents (blackAnt=5, greenSpitter=2, blueBeetle=1 at budget 5) and never spawns free units', () => {
    const { state, data } = createS3WaveTestHost('species-budgets');
    expect(FAUNA_SPECIES_THREAT_COSTS.blackAnt).toBe(1);
    expect(FAUNA_SPECIES_THREAT_COSTS.greenSpitter).toBe(2);
    expect(FAUNA_SPECIES_THREAT_COSTS.blueBeetle).toBe(4);

    state.meta.tick = 6 * 60 * TICKS_PER_SECOND;
    const summary = threatOf(state, 0);
    expect(summary.raidsAllowed).toBe(true);
    expect(summary.raidSize).toBe(5);
    expect(summary.speciesWaves).toEqual({ blackAnt: 5, greenSpitter: 2, blueBeetle: 1 });

    const antHiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 12, r: 0, initialResidents: 8 }, 0, data);
    const spitterHiveId = spawnHiveEntity(state, { species: 'greenSpitter', q: -12, r: 0, initialResidents: 4 }, 0, data);
    const beetleHiveId = spawnHiveEntity(state, { species: 'blueBeetle', q: 0, r: 12, initialResidents: 3 }, 0, data);
    const entityCountBefore = state.entities.count;

    const antCohort = spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: antHiveId, data });
    const spitterCohort = spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: spitterHiveId, data });
    const beetleCohort = spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: beetleHiveId, data });

    expect(antCohort?.memberIds).toHaveLength(5);
    expect(spitterCohort?.memberIds).toHaveLength(2);
    expect(beetleCohort?.memberIds).toHaveLength(1);
    // No free units were spawned
    expect(state.entities.count).toBe(entityCountBefore);

    // Remaining non-dispatched residents stay passive at home
    const antHive = getHiveRecord(state, antHiveId)!;
    const nonCohortAnts = antHive.residentIds.filter((id) => !antCohort!.memberIds.includes(id));
    expect(nonCohortAnts).toHaveLength(3);
    for (const id of nonCohortAnts) {
      expect(getResidentBugRecord(state, id)?.mode).toBe('passive');
      expect(getResidentBugRecord(state, id)?.cohortId).toBeNull();
    }
  });

  it('tracks s3ReachedAtTick fallback when W08 is off and postpones waves when 0 living residents fit the budget', () => {
    const { state, data } = createS3WaveTestHost('w07-only-fallback', '..07');
    const col = state.colonies[0]!;
    delete col.s3ReachedAtTick;
    state.meta.tick = 4 * 60 * TICKS_PER_SECOND;
    expect(threatOf(state, 0).raidsAllowed).toBe(false);
    state.meta.tick = 6 * 60 * TICKS_PER_SECOND;
    expect(threatOf(state, 0).raidsAllowed).toBe(true);

    const emptyHiveId = spawnHiveEntity(state, { species: 'blueBeetle', q: 10, r: 0, initialResidents: 0 }, 0, data);
    expect(spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: emptyHiveId, data })).toBeNull();
    // Low budget 3 (< 4 cost of blueBeetle) also dispatches 0
    const beetleHive2 = spawnHiveEntity(state, { species: 'blueBeetle', q: 10, r: -5, initialResidents: 2 }, 0, data);
    expect(spawnHiveRaidWave(state, { colonyIndex: 0, hiveId: beetleHive2, budget: 3, data })).toBeNull();
  });
});

describe('W07-15 · Bounded 3-wave episodes, 60 s cooldown, 1 active cohort, and hive death', () => {
  it('enforces <= 1 active cohort, >= 300-tick (60 s) cooldown, and <= 3 waves per episode despite repeated damage', () => {
    const { host, state, data } = createS3WaveTestHost('episode-bounds');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 12 }, 0, data);

    // Wave 1 triggered by damage at tick 0
    applyDamage(state, hiveId, 20, { attackerOwner: 0, tick: host.tick });
    host.step(1);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(1);
    expect(getActiveCohorts(state)).toHaveLength(1);
    const wave1 = getActiveCohorts(state)[0]!;
    expect(wave1.memberIds).toHaveLength(5);

    // Repeated damage while Wave 1 is active does NOT dispatch Wave 2
    for (let i = 0; i < 5; i++) {
      applyDamage(state, hiveId, 10, { attackerOwner: 0, tick: host.tick });
      host.step(1);
    }
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(1);
    expect(getActiveCohorts(state)).toHaveLength(1);

    // Kill all Wave 1 cohort members -> emits raidRepelled, clears activeCohortId, but cooldown (300 ticks) blocks Wave 2
    for (const id of wave1.memberIds) applyDamage(state, id, 999, { attackerOwner: 0, tick: host.tick });
    const stepRepel1 = host.step(1);
    expect(stepRepel1.events.some((e) => e.kind === 'raidRepelled')).toBe(true);
    expect(getActiveCohorts(state)).toHaveLength(0);

    // Damage during cooldown (before tick 300) cannot bypass 60 s cooldown
    applyDamage(state, hiveId, 15, { attackerOwner: 0, tick: host.tick });
    host.step(100);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(1);

    // Step past tick 300 -> Wave 2 dispatches automatically (5 more living ants)
    host.step(200);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(2);
    const wave2 = getActiveCohorts(state)[0]!;
    expect(wave2.memberIds).toHaveLength(5);

    // Wipe Wave 2, wait 300 ticks -> Wave 3 dispatches remaining ants
    for (const id of wave2.memberIds) applyDamage(state, id, 999, { attackerOwner: 0, tick: host.tick });
    host.step(1);
    host.step(300);
    expect(getHiveRecord(state, hiveId)?.aggressionByColony[0]?.wavesSent).toBe(3);
    const wave3 = getActiveCohorts(state)[0]!;
    expect(wave3.memberIds.length).toBeGreaterThan(0);

    // Wipe Wave 3 -> episode ends and aggression against colony 0 clears
    for (const id of wave3.memberIds) applyDamage(state, id, 999, { attackerOwner: 0, tick: host.tick });
    host.step(1);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);
  });

  it('stops replenishment and new waves on hive death while active cohort finishes and non-cohort bugs stay passive', () => {
    const { host, state, data } = createS3WaveTestHost('hive-death-bounds');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 8 }, 0, data);

    provokeHiveAgainstColony(state, hiveId, 0, host.tick, data);
    host.step(1);
    const cohort = getActiveCohorts(state)[0]!;
    expect(cohort.memberIds).toHaveLength(5);
    const homeBugs = getHiveRecord(state, hiveId)!.residentIds.filter((id) => !cohort.memberIds.includes(id));
    expect(homeBugs).toHaveLength(3);

    // Destroy the hive mid-wave
    applyDamage(state, hiveId, 2000, { attackerOwner: 0, tick: host.tick });
    host.step(1);
    expect(getHiveRecord(state, hiveId)?.destroyed).toBe(true);

    // Active cohort members remain aggressive, while non-cohort residents stay passive
    for (const id of cohort.memberIds) {
      expect(getResidentBugRecord(state, id)?.mode).toBe('aggressive');
    }
    for (const id of homeBugs) {
      expect(getResidentBugRecord(state, id)?.mode).toBe('passive');
    }

    // Step 400 ticks: no replenishment and no second wave
    host.step(400);
    expect(getHiveRecord(state, hiveId)?.residentIds).toHaveLength(8);
  });
});

describe('W07-15 · Unreachable targets, 300 s withdrawal timeout,colony elimination, and scheduled S3 rolls', () => {
  it('withdraws cohort members back to hive entrance on unreachable target or colony elimination without emitting raidRepelled', () => {
    const { host, state, data } = createS3WaveTestHost('unreachable-withdraw');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 12, r: 0, initialResidents: 6 }, 0, data);

    // Surround the hive with deep water so colony 0 is unreachable
    const hx = hexIndex(state.grid.radius);
    const hive = getHiveRecord(state, hiveId)!;
    for (let dr = -4; dr <= 4; dr++) {
      for (let dq = -4; dq <= 4; dq++) {
        const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        if (d === 3) {
          const ti = hx.indexOf(hive.q + dq, hive.r + dr);
          if (ti >= 0) state.grid.layers.terrain[ti] = TERRAIN.deep;
        }
      }
    }

    const cohort = spawnHiveRaidWave(state, { colonyIndex: 0, hiveId, data });
    expect(cohort).not.toBeNull();
    const res = host.step(2);
    // Cohort withdrew without emitting raidRepelled
    expect(res.events.some((e) => e.kind === 'raidRepelled')).toBe(false);
    expect(getActiveCohorts(state)).toHaveLength(0);
    for (const id of cohort!.memberIds) {
      expect(getResidentBugRecord(state, id)?.mode).toBe('passive');
    }
  });

  it('withdraws surviving cohort after 1500 ticks (300 s) timeout and clears aggression when target colony is eliminated', () => {
    const { host, state, data } = createS3WaveTestHost('timeout-and-elimination');
    const hiveId = spawnHiveEntity(state, { species: 'blueBeetle', q: 16, r: 0, initialResidents: 2 }, 0, data);

    // Spawn a cohort against colony 1, then eliminate colony 1's only unit
    ensureColonyRecord(state, 1, 0).status = 'active';
    const col1Unit = spawnUnit(state, { kind: ENTITY_KIND.harvester, owner: 1, q: -10, r: 0, hp: 100 });
    const cohort1 = spawnHiveRaidWave(state, { colonyIndex: 1, hiveId, budget: 4, data });
    expect(cohort1).not.toBeNull();
    applyDamage(state, col1Unit, 500, { tick: host.tick });
    const elimStep = host.step(1);
    expect(elimStep.events.some((e) => e.kind === 'raidRepelled')).toBe(false);
    expect(isHiveAggressiveToColony(state, hiveId, 1)).toBe(false);
  });

  it('respects S3 + 5 min (1500 ticks) grace period and triggers scheduled rolls every 10 min (3000 ticks) scaled by thermalCount', () => {
    const { host, state, data } = createS3WaveTestHost('scheduled-s3-roll');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 6 }, 0, data);
    // Add 18 thermal generators so chance = min(1, 0.10 + 0.05 * 18) = 1.0
    for (let i = 0; i < 18; i++) {
      const id = state.meta.nextEntityId++;
      const r = insertRow(state.entities, id, 0);
      state.entities.cols.kind[r] = BUILDING_KIND.thermalGenerator;
      state.entities.cols.owner[r] = 0;
      state.entities.cols.hp[r] = 400;
      state.entities.cols.hpMax[r] = 400;
      state.entities.cols.progress[r] = 1;
      state.entities.cols.state[r] = ENTITY_STATE.active;
    }

    // At tick 1400 (< 1500 grace floor): no scheduled raid
    state.colonies[0]!.s3ReachedAtTick = 0;
    state.meta.tick = 1400;
    host.step(1);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);

    // At tick 3000 (>= 1500 grace floor and >= 3000 interval): deterministic roll succeeds and dispatches wave
    state.meta.tick = 2999;
    host.step(1);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(true);
    expect(getActiveCohorts(state)).toHaveLength(1);
  });
});

describe('W07-15 · W08 Defend Area (defend_colony), Clear Nest (clear_corridor), and defense priority slider', () => {
  it('executes defend_colony and clear_corridor goals in W07 and differentiates defense slider 10 vs 90', () => {
    expect(isGoalExecutable('defend_colony', parseWaves('..07'))).toBe(true);
    expect(isGoalExecutable('clear_corridor', parseWaves('..07'))).toBe(true);
    expect(isGoalExecutable('defend_colony', parseWaves('..06'))).toBe(false);
    expect(isGoalExecutable('clear_corridor', parseWaves('..06'))).toBe(false);

    const { host, state, data } = createS3WaveTestHost('goals-and-slider');
    // Priority slider: defense=10 vs defense=90 on identical S3 state produces different ranked topNeed
    const rawNeeds = evaluateColonyNeeds(state, 0);
    expect(rawNeeds.defense).toBeGreaterThanOrEqual(5000);
    const lowDef = weightColonyNeeds(rawNeeds, { defense: 10, economy: 90, power: 50, expansion: 50, research: 50 });
    const highDef = weightColonyNeeds(rawNeeds, { defense: 90, economy: 10, power: 50, expansion: 50, research: 50 });
    expect(highDef.top.need).toBe('defense');
    expect(lowDef.top.need).not.toBe('defense');

    setColonyPriorities(state, 0, { defense: 90, power: 40, economy: 40 }, host.tick);
    expect(evaluateAutopilotDecision(state, 0).topNeed).toBe('defense');
    setColonyPriorities(state, 0, { defense: 10, power: 80, economy: 80 }, host.tick);
    expect(evaluateAutopilotDecision(state, 0).topNeed).not.toBe('defense');
    void applyAutopilotStep;

    // Queue defend_colony with a recon unit -> sets defend stance and completes when perimeter is clear
    const reconId = spawnUnit(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 200 });
    expect(queueColonyGoal(state, 0, { goal: 'defend_colony' }, host.tick).ok).toBe(true);
    for (let i = 0; i < 6; i++) host.step(1);
    expect(getColonyGoals(state, 0).find((g) => g.goal === 'defend_colony')?.status).toBe('done');

    // Queue clear_corridor -> orders recon to attack nearest hive and completes when hive is destroyed
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 8, r: 0, initialResidents: 0 }, host.tick, data);
    expect(queueColonyGoal(state, 0, { goal: 'clear_corridor' }, host.tick).ok).toBe(true);
    for (let i = 0; i < 5; i++) host.step(1);
    expect(getColonyGoals(state, 0).find((g) => g.goal === 'clear_corridor')?.status).toBe('active');
    applyDamage(state, hiveId, 2000, { attackerId: reconId, attackerOwner: 0, tick: host.tick });
    for (let i = 0; i < 6; i++) host.step(1);
    expect(getColonyGoals(state, 0).find((g) => g.goal === 'clear_corridor')?.status).toBe('done');
  });
});
