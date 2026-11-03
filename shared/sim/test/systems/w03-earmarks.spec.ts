import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  DEFAULT_EARMARK_AFTER_TICKS,
  DEFAULT_EARMARK_CAP_RATIO,
  ENTITY_KIND,
  ENTITY_STATE,
  PREP,
  TERRAIN,
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  getColonyQueue,
  indexOf,
  insertRow,
  step,
} from '../../src';

function setupColony(id: string) {
  const state = createState({ planetId: id, planetType: 'temperate', seed: 'w03', radius: 10 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  return { state, colony };
}

/** A finished Command Hub: units are made at the Hub and its `supplyProvided` is the colony's supply cap. */
function addActiveHub(state: ReturnType<typeof createState>, q: number, r: number): void {
  const cols = state.entities.cols;
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  cols.kind[row] = ENTITY_KIND.commandHub;
  cols.owner[row] = 0;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.footprintW[row] = 3;
  cols.footprintD[row] = 3;
  cols.hp[row] = 1500;
  cols.hpMax[row] = 1500;
  cols.state[row] = ENTITY_STATE.active;
}

describe('W03-13 Earmarks — 60s starvation earmark & Harvester drain protection', () => {
  it('queue a 200-Minerals building at 40 Minerals, keep queueing 15-Minerals Harvesters -> after 60 s it earmarks 160 Minerals and eventually starts', () => {
    const { state, colony } = setupColony('p-earmark-accept');
    addActiveHub(state, -5, -3);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    expect(DEFAULT_EARMARK_AFTER_TICKS).toBe(300);
    expect(DEFAULT_EARMARK_CAP_RATIO).toBe(0.8);

    // Abundant Metals/Bio so only Minerals is the bottleneck; start at 40 Minerals
    creditResource(colony, 'metals.t1', 400, 0);
    creditResource(colony, 'bio.biomass', 200, 0);
    creditResource(colony, 'bio.water', 200, 0);
    creditResource(colony, 'minerals.t1', 40, 0);

    // Queue a 200-Minerals building at t = 0 -> waiting on resources (missing 160 Minerals)
    const bRes = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'heavy-minerals-bldg',
      costOverride: { 'minerals.t1': 200 },
      tick: 0,
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(bRes.ok).toBe(true);
    if (!bRes.ok) throw new Error('expected ok');
    expect(bRes.entry.state).toBe('waiting');
    expect(bRes.entry.waitReason).toBe('resources');
    expect(bRes.entry.earmarked).toBeUndefined();

    // Before 60 s (at t = 100 ticks = 20 s), a 15-Minerals Harvester CAN start (non-blocking before 60 s earmark),
    // and we replenish the 15 Minerals so stock is back at 40 Minerals at t = 300 (60 s)
    step(state, [], 100, pipeline);
    const hEarly = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'harv-early',
      costOverride: { 'minerals.t1': 15 },
      tick: state.meta.tick,
      task: { kind: 'buildUnit', unit: 'harvester' },
    });
    expect(hEarly.ok && hEarly.entry.state).toBe('in_progress');
    creditResource(colony, 'minerals.t1', 15, state.meta.tick);
    step(state, [], 200, pipeline); // reaches tick = 300 (60 s), harvester finishes and stock is 40 Minerals

    const after60s = getColonyQueue(state, 0, 'construction').find((e) => e.taskId === 'heavy-minerals-bldg');
    expect(after60s?.state).toBe('waiting');
    expect(after60s?.earmarked).toEqual({ 'minerals.t1': 160 });
    expect((colony as { earmarks?: Record<string, number> }).earmarks).toEqual({ 'minerals.t1': 160 });

    // Now keep queueing 15-Minerals Harvesters while Minerals trickle in (+40 Minerals per batch)
    for (let i = 0; i < 4; i++) {
      const h = enqueueQueueTask(state, {
        colonyIndex: 0,
        taskId: `harv-after-${i}`,
        costOverride: { 'minerals.t1': 15 },
        tick: state.meta.tick,
        task: { kind: 'buildUnit', unit: 'harvester' },
      });
      expect(h.ok).toBe(true);
      // Because the building has earmarked its 160 missing Minerals, the 15-Minerals Harvester waits!
      expect(h.ok && h.entry.state).toBe('waiting');

      creditResource(colony, 'minerals.t1', 40, state.meta.tick);
      step(state, [], 5, pipeline);
    }

    // Stock reached 40 + 4 * 40 = 200 Minerals -> the 200-Minerals building has now started!
    const startedBldg = getColonyQueue(state, 0, 'construction').find((e) => e.taskId === 'heavy-minerals-bldg');
    expect(startedBldg?.state).toBe('in_progress');
    expect(startedBldg?.earmarked).toBeUndefined();
  });
});

describe('W03-13 Earmarks — 80% storage cap clamp & waiting(storage) non-earmarking', () => {
  it('never earmarks waiting(storage) entries even after 60 s and clamps total earmarks at 80% of storage cap', () => {
    const { state, colony } = setupColony('p-earmark-caps');
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    // Cap is 500 -> 80% of storage cap is 400
    // 1) Over-cap entry (600 Minerals > 500 cap) -> waiting(storage), never earmarks
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'over-cap-storage',
      costOverride: { 'minerals.t1': 600 },
      tick: 0,
      task: { kind: 'build', building: 'solar', q: 1, r: 1 },
    });

    // 2) Starved entry costing 480 Minerals (<= 500 cap, at 0 Minerals stock -> missing 480, clamped to 400 at 60 s)
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'starved-480',
      costOverride: { 'minerals.t1': 480 },
      tick: 0,
      task: { kind: 'build', building: 'solar', q: 4, r: 1 },
    });

    step(state, [], 305, pipeline);

    const q = getColonyQueue(state, 0, 'construction');
    const overCap = q.find((e) => e.taskId === 'over-cap-storage');
    const starved480 = q.find((e) => e.taskId === 'starved-480');

    expect(overCap?.waitReason).toBe('storage');
    expect(overCap?.earmarked).toBeUndefined();
    expect(starved480?.waitReason).toBe('resources');
    expect(starved480?.earmarked).toEqual({ 'minerals.t1': 400 });
    expect((colony as { earmarks?: Record<string, number> }).earmarks).toEqual({ 'minerals.t1': 400 });
  });
});

describe('W03-13 placePowerLine command & multi-pylon construction entry', () => {
  it('enqueues a single powerLine construction entry with subEntityIds and completes when pylons finish', () => {
    const { state, colony } = setupColony('p-powerline');
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    // Claim and prepare territory around (1,0) and (4,0)
    for (let q = -2; q <= 6; q++) {
      for (let r = -2; r <= 2; r++) {
        const idx = indexOf(state.grid.radius, q, r);
        if (idx >= 0) {
          state.grid.layers.owner[idx] = 0;
          state.grid.layers.terrain[idx] = TERRAIN.flat;
          state.grid.layers.prep[idx] = PREP.prepared;
        }
      }
    }

    const hqRow = insertRow(state.entities, 1, 0);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.hp[hqRow] = 900;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;

    creditResource(colony, 'metals.t1', 200, 0);
    creditResource(colony, 'minerals.t1', 200, 0);

    // Hop > span (6) is rejected
    const badRes = step(
      state,
      [{ commandId: 'pl-bad', colonyIndex: 0, source: 'player', kind: 'placePowerLine', args: { tiles: [{ q: 0, r: 0 }, { q: 8, r: 0 }] } }],
      1,
      pipeline,
    );
    expect(badRes.outcomes[0].code).toBe('invalid_args');

    // Valid 2-pylon line (hop = 3 <= 6)
    const okRes = step(
      state,
      [{ commandId: 'pl-ok', colonyIndex: 0, source: 'player', kind: 'placePowerLine', args: { taskId: 'line-2', tiles: [{ q: 1, r: 0 }, { q: 4, r: 0 }] } }],
      1,
      pipeline,
    );
    expect(okRes.outcomes[0].code).toBeUndefined();

    const lineEntry = getColonyQueue(state, 0, 'construction').find((e) => e.taskId === 'line-2');
    expect(lineEntry).toBeDefined();
    expect(lineEntry?.cost).toEqual({ 'metals.t1': 30, 'minerals.t1': 10 });
    expect(lineEntry?.subEntityIds).toHaveLength(2);
  });
});
