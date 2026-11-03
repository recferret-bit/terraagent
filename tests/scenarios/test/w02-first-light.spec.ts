import { describe, expect, it } from 'vitest';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyLedger,
  enqueueQueueTask,
  getColonyQueue,
  type ColonyWithLedger,
} from '@terra/sim';
import { createScenarioPlanet, getScenario } from '../_loader';

interface TestColonyPower {
  supply?: number;
  demand?: number;
  net?: number;
  phase?: string;
  clockText?: string;
  daylight?: number;
  solarGrossPerS?: number;
  solarNetPerS?: number;
  brownout?: boolean;
}

function getCol(host: ReturnType<typeof createScenarioPlanet>['host']): ColonyWithLedger & { power?: TestColonyPower } {
  return ensureColonyLedger(host.state.colonies[0]) as ColonyWithLedger & { power?: TestColonyPower };
}

describe('W02-34 scenario w02-first-light — seed state & demo steps 1–5', () => {
  it('loads w02 / w02-first-light with Hub done, morning 06:00, stock 400/250/150/150, +8 supply / -5 demand', () => {
    expect(getScenario('w02')).toBeDefined();
    expect(getScenario('w02-first-light')).toBe(getScenario('w02'));

    const { host } = createScenarioPlanet('w02');
    const col = getCol(host);
    expect(col.stock).toMatchObject({
      'metals.t1': 400,
      'minerals.t1': 250,
      'bio.biomass': 150,
      'bio.water': 150,
    });
    expect(col.caps).toEqual({ metals: 500, minerals: 500, bio: 500 });
    expect(col.power).toMatchObject({
      supply: 8,
      demand: 5,
      net: 3,
      phase: 'day',
      clockText: '06:00',
      daylight: 1,
    });
  });

  it('runs demo steps 2–5: Harvester production & standing harvest, Extractor + Solar build & output, and waiting ETA', () => {
    const { host } = createScenarioPlanet('w02');
    const col = getCol(host);

    // Step 2: Queue 1 Harvester -> paid progressively across 50 ticks (-40/-15/-5/0), completes in 10s (50 ticks) and harvests
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-harv',
      kind: 'enqueueTask',
      args: { taskId: 'u-harv-1', task: { kind: 'buildUnit', unit: 'harvester' } },
    });
    host.step(1);
    expect(col.stock['metals.t1']).toBeCloseTo(400 - 40 / 50, 4);
    expect(col.stock['minerals.t1']).toBeCloseTo(250 - 15 / 50, 4);
    expect(col.stock['bio.biomass']).toBeCloseTo(150 - 5 / 50, 4);

    host.step(55);
    let harvRow = -1;
    for (let r = 0; r < host.state.entities.count; r++) {
      if (host.state.entities.cols.kind[r] === ENTITY_KIND.harvester) harvRow = r;
    }
    expect(harvRow).toBeGreaterThanOrEqual(0);

    // Step 3 & 4: Build Metals Extractor on deposit (3, 0) and Solar at (-3, 2)
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-ext',
      kind: 'enqueueTask',
      args: { taskId: 'b-ext-1', task: { kind: 'build', building: 'metalsExtractor', q: 3, r: 0 } },
    });
    host.step(50);
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-sol',
      kind: 'enqueueTask',
      args: { taskId: 'b-sol-1', task: { kind: 'build', building: 'solar', q: -3, r: 2 } },
    });
    host.step(65);
    expect(col.power?.solarNetPerS).toBe(20);

    // Step 5: Queue a second Extractor when Minerals are set to 5 -> waiting: Minerals 5/20 · ~30 s
    col.stock['minerals.t1'] = 5;
    const qWait = enqueueQueueTask(host.state, {
      colonyIndex: 0,
      taskId: 'b-ext-wait',
      task: { kind: 'build', building: 'metalsExtractor', q: 6, r: 0 },
    });
    expect(qWait.ok).toBe(true);
    if (qWait.ok) {
      expect(qWait.entry.state).toBe('waiting');
      expect(qWait.entry.waitDetail).toBe('waiting: Minerals 5/20 · ~30 s');
    }
  });
});

describe('W02-34 scenario w02-first-light — demo steps 6–8 (night brownout, storage cap, cancel refunds)', () => {
  it('runs demo steps 6–8: time night brownout & restore, fill to cap & storage wait, and cancel refunds', () => {
    const { host } = createScenarioPlanet('w02');
    const col = getCol(host);

    // Build Solar + Extractor so colony depends on Solar power
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-sol',
      kind: 'enqueueTask',
      args: { taskId: 'b-sol', task: { kind: 'build', building: 'solar', q: -3, r: 2 } },
    });
    host.step(65);
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-ext',
      kind: 'enqueueTask',
      args: { taskId: 'b-ext', task: { kind: 'build', building: 'metalsExtractor', q: 3, r: 0 } },
    });
    host.step(55);

    // Step 6: Run dev.time night -> Solar drops to 0, demand exceeds supply, Extractor shed (offlineBrownout)
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-night', kind: 'dev.time', args: { target: 'night' } });
    host.step(1);
    expect(col.power?.solarGrossPerS).toBe(0);
    expect(col.power?.brownout).toBe(true);
    let extRow = -1;
    for (let r = 0; r < host.state.entities.count; r++) {
      if (host.state.entities.cols.kind[r] === ENTITY_KIND.metalsExtractor) extRow = r;
    }
    expect(host.state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineBrownout);

    // Restore day -> Extractor back online
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-day', kind: 'dev.time', args: { target: 'day' } });
    host.step(1);
    expect(col.power?.brownout).toBe(false);
    expect(host.state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);

    // Step 7: Fill Metals to cap (500/500) -> Extractor halts at cap, and entry costing > cap shows waiting: storage (no ETA)
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-fill', kind: 'dev.fill', args: { res: 'metals.t1', amount: 9999 } });
    host.step(2);
    expect(col.stock['metals.t1']).toBe(500);
    expect(host.state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineCapped);

    const overCap = enqueueQueueTask(host.state, {
      colonyIndex: 0,
      taskId: 'over-cap',
      costOverride: { 'metals.t1': 600 },
      task: { kind: 'build', building: 'solar', q: 6, r: 0 },
    });
    expect(overCap.ok && overCap.entry.waitReason).toBe('storage');
    expect(overCap.ok && overCap.entry.waitDetail).toBe('waiting: storage (no ETA)');

    // Step 8: Cancel waiting order (free) and cancel in-progress order (50% of spentCost refunded)
    const metalsBeforeWaitCancel = col.stock['metals.t1'];
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'c-can-w', kind: 'cancelTask', args: { taskId: 'over-cap' } });
    host.step(1);
    expect(col.stock['metals.t1']).toBe(metalsBeforeWaitCancel);

    // Lower metals below cap so we can observe the progressive deduction and 50% refund without cap clamping
    col.stock['metals.t1'] = 200;
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-prog',
      kind: 'enqueueTask',
      args: { taskId: 'in-prog-solar', task: { kind: 'build', building: 'solar', q: 6, r: 0 } },
    });
    host.step(30); // 30 ticks = 50% progress -> 30 Metals spent
    expect(getColonyQueue(host.state, 0, 'construction').find((e) => e.taskId === 'in-prog-solar')?.state).toBe('in_progress');
    const afterStartMetals = col.stock['metals.t1'];
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'c-can-p', kind: 'cancelTask', args: { taskId: 'in-prog-solar' } });
    host.step(1);
    expect(col.stock['metals.t1']).toBeGreaterThanOrEqual(afterStartMetals + 15); // 50% of 30 spent Metals = 15
  });
});
