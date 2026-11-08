import { describe, expect, it } from 'vitest';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyLedger,
  enqueueQueueTask,
  getBuildingJobs,
  getColonyQueue,
  placeMetalsExtractor,
  rowOf,
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
  hqCellDischargePerS?: number;
  hqCellChargePerS?: number;
}

type Host = ReturnType<typeof createScenarioPlanet>['host'];

function getCol(host: Host): ColonyWithLedger & { power?: TestColonyPower } {
  return ensureColonyLedger(host.state.colonies[0]) as ColonyWithLedger & { power?: TestColonyPower };
}

/**
 * Steps until `done()` (at most `max` ticks) and returns the ticks it took. W02 builds take as long as the HQ needs to
 * walk to each site, grade its footprint (linked prep) and build it, one site after the other (W02-16).
 */
function stepUntil(host: Host, done: () => boolean, max: number): number {
  let n = 0;
  for (; n < max && !done(); n++) host.step(1);
  expect(done()).toBe(true);
  return n;
}

/** A building of `kind` stands finished (active, or shed / capped by the power and storage rules). */
const isBuilt = (host: Host, kind: number): boolean => {
  const cols = host.state.entities.cols;
  for (let r = 0; r < host.state.entities.count; r++) if (cols.kind[r] === kind && cols.state[r] !== ENTITY_STATE.constructing) return true;
  return false;
};

describe('W02-34 scenario w02-first-light — seed state & demo steps 1–5', () => {
  it('loads w02 / w02-first-light with Hub done, morning 06:00, stock 400/250/150/150, +16 supply / -7 demand', () => {
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
      supply: 16,
      demand: 7,
      net: 9,
      phase: 'day',
      clockText: '06:00',
      daylight: 1,
    });
  });

  it('runs demo steps 2–5: Worker Drone production and standing harvest, Extractor + Solar build and output, and waiting ETA', () => {
    const { host } = createScenarioPlanet('w02');
    const col = getCol(host);

    // Step 2: Queue 1 Worker Drone T1 -> paid progressively across 50 ticks (-40/-15/-5/0), completes in 10s (50 ticks) and harvests
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-harv',
      kind: 'enqueueTask',
      args: { taskId: 'u-harv-1', task: { kind: 'buildUnit', unit: 'worker', tier: 1 } },
    });
    host.step(1);
    expect(col.stock['metals.t1']).toBeCloseTo(400 - 40 / 50, 4);
    expect(col.stock['minerals.t1']).toBeCloseTo(250 - 15 / 50, 4);
    expect(col.stock['bio.biomass']).toBeCloseTo(150 - 5 / 50, 4);

    host.step(55);
    let harvRow = -1;
    for (let r = 0; r < host.state.entities.count; r++) {
      if (host.state.entities.cols.kind[r] === ENTITY_KIND.worker) harvRow = r;
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
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-sol',
      kind: 'enqueueTask',
      args: { taskId: 'b-sol-1', task: { kind: 'build', building: 'solar', q: -3, r: 2 } },
    });
    host.step(1);
    // The HQ and the T1 worker prep the two sites at once.
    expect(getColonyQueue(host.state, 0, 'construction').map((e) => [e.taskId, e.state, e.waitReason])).toEqual([
      ['b-ext-1', 'in_progress', 'site'],
      ['b-sol-1', 'in_progress', 'site'],
    ]);
    stepUntil(host, () => isBuilt(host, ENTITY_KIND.metalsExtractor) && isBuilt(host, ENTITY_KIND.solar), 300);
    host.step(1);
    expect(col.power?.solarNetPerS).toBe(13);

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
    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'c-ext',
      kind: 'enqueueTask',
      args: { taskId: 'b-ext', task: { kind: 'build', building: 'metalsExtractor', q: 3, r: 0 } },
    });
    stepUntil(host, () => isBuilt(host, ENTITY_KIND.solar) && isBuilt(host, ENTITY_KIND.metalsExtractor), 600);
    host.step(1);

    // Step 6: Run dev.time night -> Solar drops to 0; the Founder Core (+16) still carries Hub (7) + Extractor (8)
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-night', kind: 'dev.time', args: { target: 'night' } });
    host.step(1);
    expect(col.power?.solarGrossPerS).toBe(0);
    expect(col.power?.brownout).toBe(false);
    let extRow = -1;
    for (let r = 0; r < host.state.entities.count; r++) {
      if (host.state.entities.cols.kind[r] === ENTITY_KIND.metalsExtractor) extRow = r;
    }
    expect(host.state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);

    // A second Extractor puts the night grid in deficit (23 > 16): the HQ cell carries it (no brownout, cell draining)
    const ext2 = placeMetalsExtractor(host.state, { owner: 0, q: 6, r: 0 });
    expect(ext2.ok).toBe(true);
    const ext2Row = ext2.ok ? rowOf(host.state.entities, ext2.entityId) : -1;
    host.step(1);
    expect(col.power?.brownout).toBe(false);
    expect(col.power?.hqCellDischargePerS).toBeCloseTo(7, 3);
    // ...until the cell is empty (`dev.cell 0`): then the newest Extractor is shed (offlineBrownout), the first runs on
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-cell0', kind: 'dev.cell', args: { energy: 0 } });
    host.step(2);
    expect(col.power?.brownout).toBe(true);
    expect(host.state.entities.cols.state[ext2Row]).toBe(ENTITY_STATE.offlineBrownout);
    expect(host.state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);

    // Restore day -> both Extractors online, the surplus refills the cell
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-day', kind: 'dev.time', args: { target: 'day' } });
    host.step(1);
    expect(col.power?.brownout).toBe(false);
    expect(host.state.entities.cols.state[ext2Row]).toBe(ENTITY_STATE.active);
    expect(col.power?.hqCellChargePerS).toBeGreaterThan(0);
    host.state.entities.cols.hp[ext2Row] = 0; // gone again: steps 7–8 run with one Extractor

    // Step 7: Fill Metals to cap (500/500) -> Extractor halts at cap, and entry costing > cap shows waiting: storage (no ETA)
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'c-fill', kind: 'dev.fill', args: { res: 'metals.t1', amount: 9999 } });
    host.step(2);
    expect(col.stock['metals.t1']).toBe(500);
    expect(host.state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineCapped);

    const overCap = enqueueQueueTask(host.state, {
      colonyIndex: 0,
      taskId: 'over-cap',
      costOverride: { 'metals.t1': 600 },
      task: { kind: 'build', building: 'solar', q: 5, r: -4 } /* off the deposits: no building stands on one (D-37) */,
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
      args: { taskId: 'in-prog-solar', task: { kind: 'build', building: 'solar', q: 5, r: -4 } /* off the deposits: no building stands on one (D-37) */ },
    });
    // The HQ walks there, grades the footprint and builds: run until it has paid 30 Metals (half the Solar)
    const inProg = () => getColonyQueue(host.state, 0, 'construction').find((e) => e.taskId === 'in-prog-solar');
    stepUntil(host, () => (inProg()?.spentCost?.['metals.t1'] ?? 0) >= 30, 400);
    expect(inProg()?.state).toBe('in_progress');
    const paid = getBuildingJobs(host.state)[inProg()?.entityId ?? -1]?.spentCost ?? {}; // paid so far (the job's own record)
    const before = { ...col.stock };
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'c-can-p', kind: 'cancelTask', args: { taskId: 'in-prog-solar' } });
    host.step(1);
    // 50 % of what was paid comes back (Minerals: no income here; Metals also gets the Extractor's output)
    expect(paid['minerals.t1'] ?? 0).toBeGreaterThan(30);
    expect(col.stock['minerals.t1']).toBeCloseTo(before['minerals.t1'] + (paid['minerals.t1'] ?? 0) * 0.5, 4);
    expect(col.stock['metals.t1']).toBeGreaterThanOrEqual(before['metals.t1'] + (paid['metals.t1'] ?? 0) * 0.5);
  });
});
