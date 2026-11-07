import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND,
  ENTITY_KIND,
  ENTITY_STATE,
  TICKS_PER_SECOND,
  UNIT_KIND,
  createRegistryPipeline,
  createState,
  ensureColonyRecord,
  evaluateStageTrigger,
  getColonyProgression,
  insertRow,
  placeSpawnedEntity,
  restore,
  snapshot,
  spawnHqUnit,
  step,
  view,
  type PlanetState,
  type SimEvent,
} from '../../src';

function createProgressionTestPlanet(seed = 'w08-03-test', waves = '..08') {
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius: 16 });
  const colony = ensureColonyRecord(state, 0, 0);
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves(waves) });
  return { state, colony, pipeline };
}

function spawnCompletedEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner?: number;
    q?: number;
    r?: number;
    tier?: number;
    hp?: number;
    state?: number;
  },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.tier[row] = opts.tier ?? 1;
  placeSpawnedEntity(state.entities, row, opts.q ?? 0, opts.r ?? 0, state.meta.tick);
  cols.hp[row] = opts.hp ?? 500;
  cols.hpMax[row] = opts.hp ?? 500;
  cols.state[row] = opts.state ?? ENTITY_STATE.active;
  cols.progress[row] = cols.state[row] === ENTITY_STATE.constructing ? 0.5 : 1;
  return id;
}

describe('W08-03 · Stage trigger evaluator & 1 Hz dwell progression', () => {
  it('offers S0 suggestion once on landing and advances S0 -> S1 after Hub complete + 60s (300 ticks) dwell', () => {
    const { state, colony, pipeline } = createProgressionTestPlanet('s0-to-s1');

    // Step 1 tick at S0 before Hub is built
    const r0 = step(state, [], 1, pipeline);
    const sugEvents = r0.events.filter((e) => e.kind === 'suggestionOffered');
    expect(sugEvents).toHaveLength(1);
    expect(sugEvents[0].data).toMatchObject({
      colonyIndex: 0,
      suggestionId: 'sug_s0_0',
      stage: 0,
      kind: 'goal',
      goal: 'establish_colony',
      title: 'Establish Colony',
    });
    expect(eventDef('suggestionOffered').data.safeParse(sugEvents[0].data).success).toBe(true);
    expect(colony.activeSuggestion).toMatchObject({
      suggestionId: 'sug_s0_0',
      stage: 0,
      goal: 'establish_colony',
    });
    expect(evaluateStageTrigger(state, 0, 1)).toBe(false);
    expect(colony.stageDwellRemainingS).toBeNull();
    expect(view(state).colonies[0].nextStageConditionText).toBe('Command Hub T1 complete · 1 min');

    // Under-construction Hub does NOT satisfy S1 trigger
    const hubId = spawnCompletedEntity(state, {
      kind: ENTITY_KIND.commandHub,
      q: 2,
      r: 0,
      state: ENTITY_STATE.constructing,
    });
    expect(evaluateStageTrigger(state, 0, 1)).toBe(false);

    // Complete the Hub
    state.entities.cols.state[1] = ENTITY_STATE.active;
    state.entities.cols.progress[1] = 1;
    expect(hubId).toBeGreaterThan(0);
    expect(evaluateStageTrigger(state, 0, 1)).toBe(true);

    // Advance 59s (295 ticks from tick 0; we are at tick 1, so 294 more ticks -> tick 295): S1 not reached yet
    const eventsBefore60s: SimEvent[] = [];
    for (let t = 0; t < 294; t++) {
      eventsBefore60s.push(...step(state, [], 1, pipeline).events);
    }
    expect(eventsBefore60s.filter((e) => e.kind === 'stageReached')).toHaveLength(0);
    expect(colony.stage).toBe(0);
    expect(colony.stageDwellRemainingS).toBe(1);
    expect(view(state).colonies[0].stageDwellRemainingS).toBe(1);

    // Advance final 1s (5 ticks -> tick 300): S1 reached once!
    const eventsAt60s: SimEvent[] = [];
    for (let t = 0; t < 5; t++) {
      eventsAt60s.push(...step(state, [], 1, pipeline).events);
    }
    const s1Reached = eventsAt60s.filter((e) => e.kind === 'stageReached');
    expect(s1Reached).toHaveLength(1);
    expect(s1Reached[0].data).toMatchObject({
      colonyIndex: 0,
      stage: 1,
      previousStage: 0,
      title: 'S1 First Light',
      units: ['harvester'],
    });
    expect(eventDef('stageReached').data.safeParse(s1Reached[0].data).success).toBe(true);
    expect(colony.stage).toBe(1);
    expect(colony.unlockStage).toBe(1);
    expect(colony.stageDwellRemainingS).toBeNull();
    expect(view(state).colonies[0].nextStageConditionText).toBe('extractor + generator · 2 min');
  });
});

describe('W08-03 · S2 acceptance check (extractor + generator + 2 min dwell)', () => {
  it('Acceptance check: completed Hub + 1 extractor + 1 generator -> after 2 min (120s = 600 ticks) emits stageReached S2 once', () => {
    const { state, colony, pipeline } = createProgressionTestPlanet('s2-acceptance');

    // Complete Hub, 1 extractor, and 1 generator
    spawnCompletedEntity(state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnCompletedEntity(state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnCompletedEntity(state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });

    expect(evaluateStageTrigger(state, 0, 1)).toBe(true);
    expect(evaluateStageTrigger(state, 0, 2)).toBe(true);

    // Advance 1 min (60s = 300 ticks) to complete S1 first
    const s1Events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      s1Events.push(...step(state, [], TICKS_PER_SECOND, pipeline).events);
    }
    expect(colony.stage).toBe(1);
    expect(s1Events.filter((e) => e.kind === 'stageReached' && e.data.stage === 1)).toHaveLength(1);
    expect(colony.stageDwellRemainingS).toBe(120);

    // Advance 40s into S2 dwell -> 1:20 (80s) remaining on HUD view
    for (let i = 0; i < 40; i++) {
      step(state, [], TICKS_PER_SECOND, pipeline);
    }
    expect(colony.stage).toBe(1);
    expect(view(state).colonies[0].stageDwellRemainingS).toBe(80);

    // Advance remaining 80s (total 120s = 600 ticks in S1) -> stageReached { stage: 2 } emitted once
    const s2Events: SimEvent[] = [];
    for (let i = 0; i < 80; i++) {
      s2Events.push(...step(state, [], TICKS_PER_SECOND, pipeline).events);
    }
    const s2Reached = s2Events.filter((e) => e.kind === 'stageReached' && e.data.stage === 2);
    expect(s2Reached).toHaveLength(1);
    expect(s2Reached[0].data).toMatchObject({
      colonyIndex: 0,
      stage: 2,
      previousStage: 1,
      title: 'S2 The Grid',
      units: ['builder'],
      buildings: ['pylon', 'depot', 'storageDepot', 'capacitor'],
    });
    expect(eventDef('stageReached').data.safeParse(s2Reached[0].data).success).toBe(true);
    expect(colony.stage).toBe(2);
    expect(colony.unlockStage).toBe(2);

    // Stepping further (another 5 min = 1500 ticks) does NOT emit a duplicate stageReached for S2
    const extraEvents: SimEvent[] = [];
    for (let i = 0; i < 300; i++) {
      extraEvents.push(...step(state, [], TICKS_PER_SECOND, pipeline).events);
    }
    expect(extraEvents.filter((e) => e.kind === 'stageReached' && e.data.stage === 2)).toHaveLength(0);
    expect(getColonyProgression(state, 0).emittedStages.filter((s) => s === 2)).toHaveLength(1);
  });
});

describe('W08-03 · S3 and S4 trigger conditions & wave cap', () => {
  it('evaluates S3 (6 buildings + 2 extractors) and S4 (Factory + scout or 5 explored tiles) and caps at S4 under ..08', () => {
    const { state, colony, pipeline } = createProgressionTestPlanet('s3-s4-triggers');
    colony.stage = 2;
    colony.unlockStage = 2;

    // Keep all building sight inside the initial HQ ring, so this fixture tests the scout branch of S4.
    // 5 buildings + 2 extractors is NOT enough for S3
    spawnCompletedEntity(state, { kind: ENTITY_KIND.commandHub, q: 0, r: 0 });
    spawnCompletedEntity(state, { kind: ENTITY_KIND.metalsExtractor, q: 1, r: 0 });
    spawnCompletedEntity(state, { kind: BUILDING_KIND.mineralsExtractor, q: 0, r: 1 });
    spawnCompletedEntity(state, { kind: ENTITY_KIND.solar, q: 1, r: 1 });
    spawnCompletedEntity(state, { kind: BUILDING_KIND.wind, q: -1, r: 2 });
    expect(evaluateStageTrigger(state, 0, 3)).toBe(false);

    // 6th completed building satisfies S3
    spawnCompletedEntity(state, { kind: BUILDING_KIND.depot, q: 1, r: -1 });
    expect(evaluateStageTrigger(state, 0, 3)).toBe(true);

    // Advance 3 min (180s = 900 ticks) -> S3 reached
    const rS3 = step(state, [], 900, pipeline);
    expect(rS3.events.filter((e) => e.kind === 'stageReached' && e.data.stage === 3)).toHaveLength(1);
    expect(colony.stage).toBe(3);

    // S4 requires Robotics Factory + (scout unit OR >= 5 tiles explored outside initial landing ring)
    spawnCompletedEntity(state, { kind: BUILDING_KIND.roboticsFactory, q: 0, r: 0 });
    expect(evaluateStageTrigger(state, 0, 4)).toBe(false);

    spawnCompletedEntity(state, { kind: UNIT_KIND.scout, q: 7, r: 0 });
    expect(evaluateStageTrigger(state, 0, 4)).toBe(true);

    // Advance 3 min (900 ticks) -> S4 reached
    const rS4 = step(state, [], 900, pipeline);
    expect(rS4.events.filter((e) => e.kind === 'stageReached' && e.data.stage === 4)).toHaveLength(1);
    expect(colony.stage).toBe(4);
    expect(colony.nextStageConditionText).toBe('');

    // Even with Hub T2 under TA_WAVES=..08, colony does not advance past S4
    state.entities.cols.tier[1] = 2;
    const rCap = step(state, [], 2000, pipeline);
    expect(rCap.events.filter((e) => e.kind === 'stageReached')).toHaveLength(0);
    expect(colony.stage).toBe(4);
  });

  it('persists dwell countdown across snapshot/restore', () => {
    const { state, pipeline } = createProgressionTestPlanet('snap-dwell');
    spawnCompletedEntity(state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });

    // Advance 20s (100 ticks) of the 60s S1 dwell -> 40s (200 ticks) remaining
    step(state, [], 100, pipeline);
    expect(getColonyProgression(state, 0).dwellRemainingTicks).toBe(200);
    expect(view(state).colonies[0].stageDwellRemainingS).toBe(40);

    const restored = restore(snapshot(state));
    expect(getColonyProgression(restored, 0).dwellRemainingTicks).toBe(200);
    expect(view(restored).colonies[0].stageDwellRemainingS).toBe(40);

    // Advance remaining 40s (200 ticks) on restored state -> S1 fires
    const res = step(restored, [], 200, pipeline);
    expect(res.events.filter((e) => e.kind === 'stageReached' && e.data.stage === 1)).toHaveLength(1);
    expect(restored.colonies[0].stage).toBe(1);
  });
});

describe('W08-03 · dev.stage command (set, skip-dwell, trigger)', () => {
  it('supports dev.stage set, skip-dwell, and trigger (fauna -> S3)', () => {
    const { state, colony, pipeline } = createProgressionTestPlanet('dev-stage-cmd');
    spawnCompletedEntity(state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });

    // Start dwell for S1
    step(state, [], 5, pipeline);
    expect(colony.stageDwellRemainingS).toBe(59);

    // skip-dwell immediately advances S0 -> S1
    const rSkip = step(
      state,
      [{ commandId: 'ds-skip', colonyIndex: 0, source: 'dev', kind: 'dev.stage', args: { op: 'skip-dwell' } }],
      1,
      pipeline,
    );
    expect(rSkip.outcomes[0].code).toBeUndefined();
    expect(colony.stage).toBe(1);
    expect(colony.stageDwellRemainingS).toBeNull();
    expect(rSkip.events.filter((e) => e.kind === 'stageReached' && e.data.stage === 1)).toHaveLength(1);

    // trigger fauna override -> immediately advances to S3 ("S3 First Contact") with override: 'fauna'
    const rTrig = step(
      state,
      [{ commandId: 'ds-trig', colonyIndex: 0, source: 'dev', kind: 'dev.stage', args: { op: 'trigger', override: 'fauna' } }],
      1,
      pipeline,
    );
    expect(rTrig.outcomes[0].code).toBeUndefined();
    expect(colony.stage).toBe(3);
    expect(colony.unlockStage).toBe(3);
    const trigEvent = rTrig.events.find((e) => e.kind === 'stageReached');
    expect(trigEvent?.data).toMatchObject({
      colonyIndex: 0,
      stage: 3,
      title: 'S3 First Contact',
      override: 'fauna',
    });

    // set -> sets stage to 4, updates unlockStage, emits stageReached and stageUnlocked
    const rSet = step(
      state,
      [{ commandId: 'ds-set', colonyIndex: 0, source: 'dev', kind: 'dev.stage', args: { op: 'set', stage: 4 } }],
      1,
      pipeline,
    );
    expect(rSet.outcomes[0].code).toBeUndefined();
    expect(colony.stage).toBe(4);
    expect(colony.unlockStage).toBe(4);
    expect(rSet.events.some((e) => e.kind === 'stageReached' && e.data.stage === 4)).toBe(true);
    expect(rSet.events.some((e) => e.kind === 'stageUnlocked' && e.data.unlockStage === 4)).toBe(true);
  });
});
