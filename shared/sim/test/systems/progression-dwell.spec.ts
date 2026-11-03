import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND,
  compileData,
  createRegistryPipeline,
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  restore,
  SimHost,
  spawnHqUnit,
  UNIT_KIND,
  type PlanetState,
  type SimEvent,
} from '../../src';
import {
  formatDwellSeconds,
  getStageDwellTicks,
  isDwellComplete,
  STAGE_DWELL_SECONDS,
  STAGE_DWELL_TICKS,
  stepDwellTimer,
  ticksToRemainingSeconds,
} from '../../src/systems/progression/dwell';

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

function createProgressionHost(seed = 'w08-04-test', waves = '..08'): SimHost {
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius: 16 });
  const colony = ensureColonyRecord(state, 0, 0);
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves(waves) });
  const host = new SimHost(pipeline);
  host.load(state);
  return host;
}

describe('W08-04 · Canonical dwell timer helpers & constants', () => {
  it('exports canonical dwell timer constants (S1 60s, S2 120s, S3 180s, S4 180s)', () => {
    expect(STAGE_DWELL_SECONDS[1]).toBe(60);
    expect(STAGE_DWELL_SECONDS[2]).toBe(120);
    expect(STAGE_DWELL_SECONDS[3]).toBe(180);
    expect(STAGE_DWELL_SECONDS[4]).toBe(180);

    expect(STAGE_DWELL_TICKS[1]).toBe(300);
    expect(STAGE_DWELL_TICKS[2]).toBe(600);
    expect(STAGE_DWELL_TICKS[3]).toBe(900);
    expect(STAGE_DWELL_TICKS[4]).toBe(900);
  });

  it('computes stage dwell ticks correctly via getStageDwellTicks', () => {
    expect(getStageDwellTicks(0)).toBe(0);
    expect(getStageDwellTicks(1)).toBe(300);
    expect(getStageDwellTicks(2)).toBe(600);
    expect(getStageDwellTicks(3)).toBe(900);
    expect(getStageDwellTicks(4)).toBe(900);

    const compiled = compileData(parseWaves('..08'));
    expect(getStageDwellTicks(0, compiled)).toBe(0);
    expect(getStageDwellTicks(1, compiled)).toBe(300);
    expect(getStageDwellTicks(2, compiled)).toBe(600);
    expect(getStageDwellTicks(3, compiled)).toBe(900);
    expect(getStageDwellTicks(4, compiled)).toBe(900);
  });

  it('steps dwell timer and clamps at 0 while preserving null', () => {
    expect(stepDwellTimer(300, 1)).toBe(299);
    expect(stepDwellTimer(300, 5)).toBe(295);
    expect(stepDwellTimer(300, 25)).toBe(275);
    expect(stepDwellTimer(10, 25)).toBe(0);
    expect(stepDwellTimer(0, 5)).toBe(0);
    expect(stepDwellTimer(null, 5)).toBeNull();

    expect(isDwellComplete(0)).toBe(true);
    expect(isDwellComplete(-5)).toBe(true);
    expect(isDwellComplete(1)).toBe(false);
    expect(isDwellComplete(null)).toBe(false);
  });

  it('converts ticks to remaining seconds and formats M:SS countdown', () => {
    expect(ticksToRemainingSeconds(300)).toBe(60);
    expect(ticksToRemainingSeconds(150)).toBe(30);
    expect(ticksToRemainingSeconds(1)).toBe(1);
    expect(ticksToRemainingSeconds(0)).toBe(0);
    expect(ticksToRemainingSeconds(null)).toBeNull();

    // formatDwellSeconds from ticks
    expect(formatDwellSeconds(400)).toBe('1:20'); // 80s
    expect(formatDwellSeconds(300)).toBe('1:00'); // 60s
    expect(formatDwellSeconds(150)).toBe('0:30'); // 30s
    expect(formatDwellSeconds(25)).toBe('0:05');  // 5s
    expect(formatDwellSeconds(600)).toBe('2:00'); // 120s
    expect(formatDwellSeconds(900)).toBe('3:00'); // 180s
    expect(formatDwellSeconds(0)).toBe('0:00');
    expect(formatDwellSeconds(null)).toBe('0:00');

    // formatDwellSeconds from seconds
    expect(formatDwellSeconds(80, true)).toBe('1:20');
    expect(formatDwellSeconds(5, true)).toBe('0:05');
  });
});

describe('W08-04 · Acceptance Check 1: dt=5 and coarse stepping fire within 1s of game time', () => {
  it('dt=5 fires at the exact same game time as dt=1 for S1 (60s) and S2 (120s)', () => {
    // Setup two identical colonies
    const hostA = createProgressionHost('host-a-fine');
    const hostB = createProgressionHost('host-b-coarse-5');

    // Place Command Hub, 1 extractor, 1 generator on both hosts
    for (const host of [hostA, hostB]) {
      spawnCompletedEntity(host.state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
      spawnCompletedEntity(host.state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
      spawnCompletedEntity(host.state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });
    }

    let hostAS1Tick: number | null = null;
    let hostAS2Tick: number | null = null;
    let hostBS1Tick: number | null = null;
    let hostBS2Tick: number | null = null;

    hostA.onEvents((events, tick) => {
      for (const e of events) {
        if (e.kind === 'stageReached') {
          if (e.data.stage === 1 && hostAS1Tick === null) hostAS1Tick = tick;
          if (e.data.stage === 2 && hostAS2Tick === null) hostAS2Tick = tick;
        }
      }
    });

    hostB.onEvents((events, tick) => {
      for (const e of events) {
        if (e.kind === 'stageReached') {
          if (e.data.stage === 1 && hostBS1Tick === null) hostBS1Tick = tick;
          if (e.data.stage === 2 && hostBS2Tick === null) hostBS2Tick = tick;
        }
      }
    });

    // Advance 950 ticks (190s: 60s for S1 + 120s for S2 = 180s = 900 ticks)
    // Host A steps at fine dt = 1 tick (200 ms)
    for (let t = 0; t < 950; t++) {
      hostA.step(1);
    }

    // Host B steps at coarse dt = 5 ticks (1 s)
    for (let t = 0; t < 950 / 5; t++) {
      hostB.step(5);
    }

    // Verify S1 and S2 fired on both hosts
    expect(hostAS1Tick).not.toBeNull();
    expect(hostAS2Tick).not.toBeNull();
    expect(hostBS1Tick).not.toBeNull();
    expect(hostBS2Tick).not.toBeNull();

    // Expected exact ticks:
    // S0 -> S1 dwell is 60s = 300 ticks.
    // S1 -> S2 dwell is 120s = 600 ticks. S2 fires at 300 + 600 = 900 ticks.
    expect(hostAS1Tick).toBe(300);
    expect(hostAS2Tick).toBe(900);
    expect(hostBS1Tick).toBe(300);
    expect(hostBS2Tick).toBe(900);

    // Verify dt=5 fires within <= 1s (<= 5 ticks) of Host A: in fact exact 0 tick diff!
    const s1Diff = Math.abs(hostBS1Tick! - hostAS1Tick!);
    const s2Diff = Math.abs(hostBS2Tick! - hostAS2Tick!);
    expect(s1Diff).toBeLessThanOrEqual(5); // <= 1s (5 ticks)
    expect(s2Diff).toBeLessThanOrEqual(5); // <= 1s (5 ticks)
  });

  it('coarse dt=25 (5s) steps fire within <= 1s of expected transition tick', () => {
    const hostC = createProgressionHost('host-c-coarse-25');
    spawnCompletedEntity(hostC.state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnCompletedEntity(hostC.state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnCompletedEntity(hostC.state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });

    let s1Tick: number | null = null;
    let s2Tick: number | null = null;

    hostC.onEvents((events, tick) => {
      for (const e of events) {
        if (e.kind === 'stageReached') {
          if (e.data.stage === 1 && s1Tick === null) s1Tick = tick;
          if (e.data.stage === 2 && s2Tick === null) s2Tick = tick;
        }
      }
    });

    // Advance 950 ticks with coarse dt = 25 ticks (5s)
    for (let t = 0; t < 950 / 25; t++) {
      hostC.step(25);
    }

    expect(s1Tick).toBe(300);
    expect(s2Tick).toBe(900);
  });
});

describe('W08-04 · Acceptance Check 2: snapshot mid-dwell resumes and fires at exact expected tick', () => {
  it('resumes S1 dwell after 50% (30s = 150 ticks) snapshot and completes at expected tick', () => {
    const host = createProgressionHost('s1-snap-dwell');
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });

    // Step 50% through S1 dwell: 150 ticks (30s of 60s)
    for (let t = 0; t < 150; t++) {
      host.step(1);
    }

    // Verify 30s remaining
    expect(host.state.colonies[0].stage).toBe(0);
    expect(host.state.colonies[0].dwellRemainingTicks).toBe(150);
    expect(host.state.colonies[0].stageDwellRemainingS).toBe(30);
    expect(host.view().colonies[0].stageDwellRemainingS).toBe(30);

    // Take snapshot and restore into a fresh SimHost
    const snap = host.snapshot();
    const freshHost = new SimHost(host.pipeline);
    freshHost.load(restore(snap));

    // Verify restored state matches
    expect(freshHost.state.meta.tick).toBe(150);
    expect(freshHost.state.colonies[0].stage).toBe(0);
    expect(freshHost.state.colonies[0].dwellRemainingTicks).toBe(150);
    expect(freshHost.state.colonies[0].stageDwellRemainingS).toBe(30);
    expect(freshHost.view().colonies[0].stageDwellRemainingS).toBe(30);

    // Track stageReached event on restored host
    const events: SimEvent[] = [];
    freshHost.onEvents((evs) => events.push(...evs));

    // Step remaining 150 ticks
    for (let t = 0; t < 150; t++) {
      freshHost.step(1);
    }

    // stageReached for S1 fires at tick 300
    const s1Event = events.find((e) => e.kind === 'stageReached' && e.data.stage === 1);
    expect(s1Event).toBeDefined();
    expect(s1Event?.atTick).toBe(300);
    expect(freshHost.state.colonies[0].stage).toBe(1);
    expect(freshHost.state.colonies[0].dwellRemainingTicks).toBeNull();
    expect(freshHost.state.colonies[0].stageDwellRemainingS).toBeNull();
  });

  it('resumes S2 dwell after 50% (60s = 300 ticks) snapshot and completes at expected tick', () => {
    const host = createProgressionHost('s2-snap-dwell');
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });

    // Step 300 ticks (60s) to complete S1
    for (let t = 0; t < 300; t++) {
      host.step(1);
    }
    expect(host.state.colonies[0].stage).toBe(1);
    expect(host.state.colonies[0].dwellRemainingTicks).toBe(600); // S2 dwell started
    expect(host.state.colonies[0].stageDwellRemainingS).toBe(120);

    // Advance 50% through S2 dwell: 300 ticks (60s of 120s) -> tick 600
    for (let t = 0; t < 300; t++) {
      host.step(1);
    }
    expect(host.state.meta.tick).toBe(600);
    expect(host.state.colonies[0].dwellRemainingTicks).toBe(300);
    expect(host.state.colonies[0].stageDwellRemainingS).toBe(60);
    expect(host.view().colonies[0].stageDwellRemainingS).toBe(60);

    // Take snapshot and restore into a fresh SimHost
    const snap = host.snapshot();
    const freshHost = new SimHost(host.pipeline);
    freshHost.load(restore(snap));

    // Verify restored state matches
    expect(freshHost.state.meta.tick).toBe(600);
    expect(freshHost.state.colonies[0].stage).toBe(1);
    expect(freshHost.state.colonies[0].dwellRemainingTicks).toBe(300);
    expect(freshHost.state.colonies[0].stageDwellRemainingS).toBe(60);
    expect(freshHost.view().colonies[0].stageDwellRemainingS).toBe(60);

    // Step remaining 300 ticks with coarse dt = 5
    const events: SimEvent[] = [];
    freshHost.onEvents((evs) => events.push(...evs));

    for (let t = 0; t < 300 / 5; t++) {
      freshHost.step(5);
    }

    // stageReached for S2 fires at tick 900
    const s2Event = events.find((e) => e.kind === 'stageReached' && e.data.stage === 2);
    expect(s2Event).toBeDefined();
    expect(s2Event?.atTick).toBe(900);
    expect(freshHost.state.colonies[0].stage).toBe(2);
    expect(freshHost.state.colonies[0].stageDwellRemainingS).toBeNull();
  });
});

describe('W08-04 · Stage dwell durations for S1..S4', () => {
  it('validates S3 (180s = 900 ticks) and S4 (180s = 900 ticks) dwell durations', () => {
    const host = createProgressionHost('s3-s4-durations');
    const col = host.state.colonies[0];
    col.stage = 2;
    col.unlockStage = 2;

    // Satisfy S3 trigger: 6 buildings + 2 extractors
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnCompletedEntity(host.state, { kind: BUILDING_KIND.mineralsExtractor, q: 5, r: 0 });
    spawnCompletedEntity(host.state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });
    spawnCompletedEntity(host.state, { kind: BUILDING_KIND.wind, q: 3, r: 2 });
    spawnCompletedEntity(host.state, { kind: BUILDING_KIND.depot, q: 1, r: 2 });

    // Step 5 ticks to initialize dwell
    host.step(5);
    expect(col.stage).toBe(2);
    expect(col.stageDwellRemainingS).toBe(179); // 180s initialized, 5 ticks elapsed (1s)

    // Advance remaining 895 ticks (total 900 ticks = 180s)
    const s3Events: SimEvent[] = [];
    host.onEvents((evs) => s3Events.push(...evs));
    for (let t = 0; t < 895 / 5; t++) {
      host.step(5);
    }

    expect(s3Events.some((e) => e.kind === 'stageReached' && e.data.stage === 3)).toBe(true);
    expect(col.stage).toBe(3);

    // Satisfy S4 trigger: Robotics Factory + scout unit
    spawnCompletedEntity(host.state, { kind: BUILDING_KIND.roboticsFactory, q: 6, r: 0 });
    spawnCompletedEntity(host.state, { kind: UNIT_KIND.scout, q: 7, r: 0 });

    host.step(5);
    expect(col.stage).toBe(3);
    expect(col.stageDwellRemainingS).toBe(179); // S4 dwell is 180s

    const s4Events: SimEvent[] = [];
    host.onEvents((evs) => s4Events.push(...evs));
    for (let t = 0; t < 895 / 5; t++) {
      host.step(5);
    }

    expect(s4Events.some((e) => e.kind === 'stageReached' && e.data.stage === 4)).toBe(true);
    expect(col.stage).toBe(4);
  });
});
