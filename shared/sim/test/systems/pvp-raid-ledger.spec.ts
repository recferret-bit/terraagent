import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  compileData,
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  findOpenRaidOf,
  getPvpState,
  healActiveRaids,
  insertRow,
  launchColonyRaid,
  peekPvpState,
  placeSpawnedEntity,
  savePvpState,
  seedStream,
  type ActiveRaidGroupState,
  type PlanetState,
  type SimEvent,
  type StepContext,
} from '../../src';
import { recordLaunchedRaid, stepRaidTargetGoal } from '../../src/systems/pvp/parts/raidGoalExecutor';
import { pvpSystem } from '../../src/systems/pvp';
import type { ColonyGoalEntry } from '../../src/systems/goals/types';

const flags = parseWaves('..18');
const data = compileData(flags);

function ctxFor(state: PlanetState, events: SimEvent[], tick = state.meta.tick): StepContext {
  return {
    dt: 1,
    tick,
    flags: flags as unknown as ReadonlySet<string>,
    data,
    rng: (s) => seedStream(String(state.meta.seed), `${s}:${tick}`),
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => events.push(e as SimEvent),
    events,
    record: () => {},
    postings: [],
  };
}

function addEntity(state: PlanetState, kind: number, owner: number, q: number, r: number, hp = 220): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = owner;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = hp;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  return id;
}

/** Attacker 0 with 3 recons; targets 1 and 2 (stage 4, unshielded). */
function makeState(): { state: PlanetState; raiders: number[] } {
  const state = createState({ planetId: 'p_ledger', planetType: 'temperate', seed: 'ledger', radius: 32 });
  for (const i of [0, 1, 2]) {
    const col = ensureColonyRecord(state, i, 0);
    col.id = `col_${i}`;
    col.stage = 4;
    col.sectorId = 0;
    col.status = 'active';
  }
  addEntity(state, ENTITY_KIND.commandHub, 0, 0, 0, 1500);
  addEntity(state, ENTITY_KIND.commandHub, 1, 14, 0, 1500);
  addEntity(state, ENTITY_KIND.commandHub, 2, -14, 0, 1500);
  const raiders = [addEntity(state, ENTITY_KIND.recon, 0, 2, 0), addEntity(state, ENTITY_KIND.recon, 0, 2, 1), addEntity(state, ENTITY_KIND.recon, 0, 3, 0)];
  return { state, raiders };
}

const openRaids = (state: PlanetState): ActiveRaidGroupState[] => Object.values(peekPvpState(state).activeRaids);

describe('raid ledger · one open raid per raider unit (recordLaunchedRaid)', () => {
  it('1,000 alternating launches with the same 3 units leave exactly 1 open raid (the newest)', () => {
    const { state, raiders } = makeState();
    const events: SimEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      const target = i % 2 === 0 ? 1 : 2;
      recordLaunchedRaid(state, 0, target, raiders, 1, { q: 0, r: 0 }, 100 + i * 175, ctxFor(state, events));
    }
    const open = openRaids(state);
    expect(open).toHaveLength(1);
    expect(open[0]!.targetColony).toBe(2);
    expect(open[0]!.raidId).toBe('raid_0_2_1000');
    expect(peekPvpState(state).byColony['0']?.activeRaidId).toBe('raid_0_2_1000');
    expect(events.filter((e) => e.kind === 'raidStarted')).toHaveLength(1000);
    expect(events.some((e) => e.kind === 'raidRepelled')).toBe(false);
  });

  it('a launch sharing only one unit supersedes the older raid; disjoint unit sets coexist', () => {
    const { state, raiders } = makeState();
    const [a, b, c] = raiders as [number, number, number];
    recordLaunchedRaid(state, 0, 1, [a], 1, { q: 0, r: 0 }, 10);
    recordLaunchedRaid(state, 0, 2, [b], 2, { q: 0, r: 0 }, 11);
    expect(openRaids(state)).toHaveLength(2);
    recordLaunchedRaid(state, 0, 2, [b, c], 2, { q: 0, r: 0 }, 12);
    expect(openRaids(state).map((r) => r.unitIds)).toEqual([[a], [b, c]]);
  });

  it('a launch with no units never drops other raids (corner case)', () => {
    const { state, raiders } = makeState();
    recordLaunchedRaid(state, 0, 1, raiders, 1, { q: 0, r: 0 }, 10);
    recordLaunchedRaid(state, 0, 2, [], 1, { q: 0, r: 0 }, 11);
    expect(openRaids(state)).toHaveLength(2);
  });

  it('real launches through launchColonyRaid keep the invariant', () => {
    const { state } = makeState();
    for (let i = 0; i < 12; i++) {
      const res = launchColonyRaid(state, 0, i % 2 === 0 ? 1 : 2, undefined, { data });
      expect(res.ok).toBe(true);
    }
    expect(openRaids(state)).toHaveLength(1);
  });
});

describe('raid ledger · closing raids and the raid_target goal executor', () => {
  it('a raid ends silently when its target colony is eliminated', () => {
    const { state, raiders } = makeState();
    recordLaunchedRaid(state, 0, 1, raiders, 1, { q: 0, r: 0 }, 10);
    state.colonies[1]!.status = 'eliminated';
    const events: SimEvent[] = [];
    pvpSystem.run(state, ctxFor(state, events, 11));
    expect(openRaids(state)).toHaveLength(0);
    expect(peekPvpState(state).byColony['0']?.activeRaidId).toBeNull();
    expect(events.filter((e) => e.kind === 'raidRepelled' || e.kind === 'raidStarted')).toHaveLength(0);
  });

  it('the raid_target goal does not re-launch while the colony already has an open raid (any live target)', () => {
    const { state } = makeState();
    const goal: ColonyGoalEntry = {
      id: 'goal_0_1', colonyIndex: 0, goal: 'raid_target', status: 'active', params: { targetColonyId: 1 },
      progress: 0, stepsTotal: 1, stepsCompleted: 0, queuedAtTick: 0, startedAtTick: 0, seq: 1,
    } as unknown as ColonyGoalEntry;
    const goals = [goal];
    const events: SimEvent[] = [];
    stepRaidTargetGoal(state, 0, goal, goals, 10, ctxFor(state, events, 10));
    expect(events.filter((e) => e.kind === 'raidStarted')).toHaveLength(1);

    // Another launcher redirects the same units toward colony 2: the goal waits instead of ping-ponging back.
    launchColonyRaid(state, 0, 2, ctxFor(state, events, 20), { data });
    for (let t = 30; t < 3000; t += 175) stepRaidTargetGoal(state, 0, goal, goals, t, ctxFor(state, events, t));
    expect(events.filter((e) => e.kind === 'raidStarted')).toHaveLength(2);
    expect(goal.detail).toContain('busy');
    expect(openRaids(state)).toHaveLength(1);

    // Once that raid is gone (target eliminated), the goal launches again toward its own target.
    state.colonies[2]!.status = 'eliminated';
    expect(findOpenRaidOf(state, 0)).toBeUndefined();
    stepRaidTargetGoal(state, 0, goal, goals, 4000, ctxFor(state, events, 4000));
    expect(findOpenRaidOf(state, 0, 1)).toBeDefined();
  });
});

describe('raid ledger · self-heal of a bloated prod-like ledger', () => {
  function bloat(state: PlanetState, raiders: number[], count: number): void {
    const pvp = getPvpState(state);
    for (let i = 1; i <= count; i++) {
      const target = i % 2 === 0 ? 1 : 2;
      pvp.activeRaids[`raid_0_${target}_${i}`] = {
        raidId: `raid_0_${target}_${i}`, attackerColony: 0, targetColony: target, startedAtTick: i * 175,
        unitIds: [...raiders], groupId: 1, currentTargetEntityId: null, currentTargetQ: 0, currentTargetR: 0, repelled: false,
      };
    }
    pvp.byColony['0'] = {
      colonyIndex: 0, foundedAtTick: 0, raidProtectedUntil: 0, shieldDropped: true,
      activeRaidId: `raid_0_${count % 2 === 0 ? 1 : 2}_${count}`, activeRaidTargetColony: count % 2 === 0 ? 1 : 2,
      raidGroupId: 1, raiderUnitIds: [...raiders],
    };
    pvp.nextRaidSeq = count + 1;
    savePvpState(state, pvp, 0);
  }

  it('drops superseded raids (keeps the newest), emits no events, and is idempotent', () => {
    const { state, raiders } = makeState();
    bloat(state, raiders, 1366);
    expect(openRaids(state)).toHaveLength(1366);

    expect(healActiveRaids(state, 5)).toBe(1365);
    expect(openRaids(state).map((r) => r.raidId)).toEqual(['raid_0_1_1366']);
    expect(peekPvpState(state).byColony['0']?.activeRaidId).toBe('raid_0_1_1366');

    const blobBefore = state.blobs.pvp;
    expect(healActiveRaids(state, 6)).toBe(0);
    expect(state.blobs.pvp).toBe(blobBefore); // no write on the clean ledger
  });

  it('the PvP system heals on its first run without raidRepelled / raidStarted events', () => {
    const { state, raiders } = makeState();
    bloat(state, raiders, 500);
    const events: SimEvent[] = [];
    pvpSystem.run(state, ctxFor(state, events, 1));
    expect(openRaids(state)).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'raidRepelled' || e.kind === 'raidStarted')).toHaveLength(0);
  });
});
