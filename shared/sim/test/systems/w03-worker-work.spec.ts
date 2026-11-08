import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  getEntityBaseBuildCost,
  getWorkJobsMap,
  insertRow,
  PREP,
  rowOf,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
} from '../../src';
import { crewRate } from '../../src/systems/dispatch/crew';

/**
 * Owner feedback W03 #6 and #9: dismantle is builder work (half the build time, the 50 % refund step by step), repair
 * costs resources by the HP it restores and stalls on an empty stock, and a crew of workers on one job (a site, a
 * repair, a dismantle) is faster with diminishing returns (`workCrew.crew`) at exactly the same cost.
 */

const DATA = compileData(parseWaves('..03'));
const SEED_STOCK = { 'metals.t1': 200, 'minerals.t1': 200, 'bio.biomass': 100, 'bio.water': 100 } as const; // under the 500 caps

function world(seed: string, stock: Partial<Record<keyof typeof SEED_STOCK, number>> = SEED_STOCK) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 10 });
  const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', active: true, changedAt: 0 });
  for (const [k, v] of Object.entries(stock)) colony.stock[k as keyof typeof SEED_STOCK] = v;
  state.colonies.push(colony);
  const L = state.grid.layers;
  for (let i = 0; i < state.grid.count; i++) {
    setTileTerrain(state, i, TERRAIN.flat, 0);
    setTilePrep(state.grid, i, PREP.prepared, 0);
    setTileDeposit(state, i, DEPOSIT.none, 0, 0);
    L.height[i] = 0;
    L.owner[i] = 0;
  }
  return { state, colony, pipeline: createRegistryPipeline({ flags: parseWaves('..03') }) };
}

/** A finished 2×2 Metals Extractor (65 metals, 20 minerals) at `(q, r)`. */
function extractor(state: PlanetState, q: number, r: number, hp = 300): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.metalsExtractor;
  c.owner[row] = 0;
  c.q[row] = c.x[row] = q;
  c.r[row] = c.y[row] = r;
  c.hp[row] = hp;
  c.hpMax[row] = 300;
  c.tier[row] = 1;
  c.footprintW[row] = c.footprintD[row] = 2;
  c.state[row] = ENTITY_STATE.active;
  c.progress[row] = 1;
  return id;
}

const SPOTS: ReadonlyArray<[number, number]> = [[-3, 0], [3, -3], [0, 3]];
/** `n` single steps (a multi-tick `step` is one long step: routes are solved per step); the first one carries `cmds`. */
function run(s: PlanetState, p: ReturnType<typeof world>['pipeline'], cmds: SimCommand[] = [], n = 1): ReturnType<typeof step> {
  const first = step(s, cmds, 1, p);
  for (let i = 1; i < n; i++) step(s, [], 1, p);
  return first;
}
const alive = (s: PlanetState, id: number) => rowOf(s.entities, id) >= 0;
const dismantleCmd = (id: string, q: number, r: number): SimCommand =>
  ({ commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'dismantle', tiles: [{ q, r }] } } });

describe('crew: several builders on one construction site', () => {
  function buildWith(n: number): { ticks: number; spent: number } {
    const { state, colony, pipeline } = world(`crew-build-${n}`);
    for (let i = 0; i < n; i++) spawnWorkerUnit(state, { tier: 2, owner: 0, q: SPOTS[i]![0], r: SPOTS[i]![1] });
    const b = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 0, r: 0 });
    if (!b.ok) throw new Error(b.code);
    const before = colony.stock['metals.t1'];
    let ticks = 0;
    while (ticks < 400 && state.entities.cols.state[rowOf(state.entities, b.entityId)] === ENTITY_STATE.constructing) {
      run(state, pipeline);
      ticks++;
    }
    return { ticks, spent: before - colony.stock['metals.t1'] };
  }

  it('1 → 2 → 3 builders finish sooner with diminishing returns, at the same total cost', () => {
    const [one, two, three] = [buildWith(1), buildWith(2), buildWith(3)];
    expect(two.ticks).toBeLessThan(one.ticks);
    expect(three.ticks).toBeLessThan(two.ticks);
    expect(two.ticks).toBeGreaterThan(one.ticks / 2); // a helper adds less than a full builder
    expect(one.spent).toBeCloseTo(60, 6);
    expect(two.spent).toBeCloseTo(60, 6);
    expect(three.spent).toBeCloseTo(60, 6);
  });

  it('the crew rate comes from the workCrew.crew row: 1, 1 + e, 1 + e + e², capped at maxCrew', () => {
    const e = Number(DATA.tables.workCrew!.crew!.helperEfficiency);
    const max = Number(DATA.tables.workCrew!.crew!.maxCrew);
    expect(crewRate(1, DATA)).toBe(1);
    expect(crewRate(2, DATA)).toBeCloseTo(1 + e, 9);
    expect(crewRate(3, DATA)).toBeCloseTo(1 + e + e * e, 9);
    expect(crewRate(max + 3, DATA)).toBeCloseTo(crewRate(max, DATA), 9);
  });
});

describe('repair: pays by the HP it restores, stalls on an empty stock, a crew is faster at the same cost', () => {
  it('auto-repair by a Worker Drone T2 costs costRate × build cost × missing share', () => {
    const { state, colony, pipeline } = world('rep-cost');
    spawnWorkerUnit(state, { tier: 2, owner: 0, q: 3, r: 0 });
    const ext = extractor(state, 5, 0, 150); // 50 % missing
    const rate = Number(DATA.tables.workCrew!.repair!.costRate);
    const before = { m: colony.stock['metals.t1'], n: colony.stock['minerals.t1'] };
    run(state, pipeline, [], 80);
    expect(state.entities.cols.hp[rowOf(state.entities, ext)]).toBe(300);
    expect(before.m - colony.stock['metals.t1']).toBeCloseTo(65 * rate * 0.5, 4);
    expect(before.n - colony.stock['minerals.t1']).toBeCloseTo(20 * rate * 0.5, 4);
  });

  it('stalls with wait reason `resources` at zero stock and resumes when the stock refills', () => {
    const { state, colony, pipeline } = world('rep-stall', { 'metals.t1': 0, 'minerals.t1': 0 });
    spawnWorkerUnit(state, { tier: 2, owner: 0, q: 3, r: 0 });
    const ext = extractor(state, 5, 0, 150);
    run(state, pipeline, [], 40);
    const job = Object.values(getWorkJobsMap(state)).find((j) => j.mode === 'repair');
    expect(job).toMatchObject({ status: 'waiting', waitReason: 'resources', progress: 0 });
    expect(state.entities.cols.hp[rowOf(state.entities, ext)]).toBe(150);
    expect(getColonyQueue(state, 0, 'construction').find((e) => e.task.kind === 'repair')?.waitReason).toBe('resources');
    colony.stock['metals.t1'] = 100;
    colony.stock['minerals.t1'] = 100;
    colony.stock['bio.water'] = 100;
    run(state, pipeline, [], 60);
    expect(state.entities.cols.hp[rowOf(state.entities, ext)]).toBe(300);
  });

  function repairWith(builders: number): { ticks: number; spent: number } {
    const { state, colony, pipeline } = world(`rep-crew-${builders}`);
    for (let i = 0; i < builders; i++) spawnWorkerUnit(state, { tier: 2, owner: 0, q: 3, r: i === 0 ? 0 : -i });
    const ext = extractor(state, 5, 0, 30); // 90 % missing
    const before = colony.stock['metals.t1'];
    let ticks = 0;
    while (ticks < 200 && state.entities.cols.hp[rowOf(state.entities, ext)] < 300) {
      run(state, pipeline);
      ticks++;
    }
    return { ticks, spent: before - colony.stock['metals.t1'] };
  }

  it('a repair order naming another worker on an open repair joins it as a helper (no second paid job)', () => {
    const { state, pipeline } = world('rep-join');
    spawnWorkerUnit(state, { tier: 2, owner: 0, q: 3, r: 0 });
    const hqId = spawnHqUnit(state, { owner: 0, q: -3, r: 0 });
    const ext = extractor(state, 5, 0, 150);
    run(state, pipeline); // auto-repair opens the lead job (the Builder)
    const res = run(state, pipeline, [{ commandId: 'rep-hq', colonyIndex: 0, source: 'player', kind: 'repair', args: { entityId: ext, workerId: hqId } }]);
    expect(res.outcomes[0]!.code).toBeUndefined();
    const jobs = Object.values(getWorkJobsMap(state)).filter((j) => j.targetEntityId === ext);
    expect(jobs.filter((j) => j.helpOf === undefined)).toHaveLength(1);
    expect(jobs.find((j) => j.workerEntityId === hqId)).toMatchObject({ helpOf: expect.any(String), totalCost: {} });
  });

  it('an idle Worker Drone T2 joins an open repair: faster, same cost, no second paid job', () => {
    const [one, two] = [repairWith(1), repairWith(2)];
    expect(two.ticks).toBeLessThan(one.ticks);
    expect(two.spent).toBeCloseTo(one.spent, 4);
    expect(one.spent).toBeCloseTo(65 * 0.4 * 0.9, 4);
  });
});

/** A world with a Worker Drone T2 at (2, -1) next to a finished Metals Extractor at (4, 0). */
function dismantleWorld(seed: string) {
  const w = world(seed);
  const builderId = spawnWorkerUnit(w.state, { tier: 2, owner: 0, q: 2, r: -1 });
  const ext = extractor(w.state, 4, 0);
  return { ...w, builderId, ext };
}

describe('dismantle: builder work, half the build time, the 50 % refund step by step', () => {
  it('a Builder walks over, works ½ × build time, refunds stepwise to exactly 50 %, then the building is gone', () => {
    const { state, colony, pipeline, builderId, ext } = dismantleWorld('dis-main');
    const before = { m: colony.stock['metals.t1'], n: colony.stock['minerals.t1'] };
    const res = run(state, pipeline, [dismantleCmd('d1', 4, 0)]);
    expect(res.outcomes[0]!.code).toBeUndefined();
    expect(alive(state, ext)).toBe(true);
    const job = getWorkJobsMap(state).d1!;
    const buildTicks = Number(DATA.tables.economyT1Basic!.metalsExtractor!.buildS);
    expect(buildTicks).toBe(70); // 14 s
    expect(job.durationTicks).toBe(Math.round(buildTicks * 0.5));
    expect(job).toMatchObject({ mode: 'dismantle', workerEntityId: builderId, targetEntityId: ext });
    // Offline while it comes down: a site again (the grid and production skip `constructing`).
    expect(state.entities.cols.state[rowOf(state.entities, ext)]).toBe(ENTITY_STATE.constructing);
    expect(getColonyQueue(state, 0, 'construction').find((e) => e.task.kind === 'dismantle')).toMatchObject({ taskId: 'd1', state: 'in_progress' });

    let worked = 0, ticks = 0, sawMid = false;
    while (ticks < 400 && alive(state, ext)) {
      run(state, pipeline);
      ticks++;
      const j = getWorkJobsMap(state).d1;
      if (j && j.progress > 0) worked++;
      if (j && j.progress > 0.3 && j.progress < 0.7 && !sawMid) {
        sawMid = true; // refund so far follows progress
        expect(colony.stock['metals.t1'] - before.m).toBeCloseTo(65 * 0.5 * j.progress, 4);
        const entry = getColonyQueue(state, 0, 'construction').find((e) => e.task.kind === 'dismantle');
        expect(Math.abs((entry?.progress ?? 0) - j.progress)).toBeLessThanOrEqual(1 / job.durationTicks + 1e-3); // the queue runs a slot earlier
        expect(state.entities.cols.progress[rowOf(state.entities, ext)]).toBeCloseTo(1 - j.progress, 4);
      }
    }
    expect(sawMid).toBe(true);
    expect(alive(state, ext)).toBe(false);
    expect(worked).toBe(job.durationTicks - 1); // the last step finishes it (the job is gone after)
    expect(colony.stock['metals.t1'] - before.m).toBeCloseTo(65 * 0.5, 6);
    expect(colony.stock['minerals.t1'] - before.n).toBeCloseTo(20 * 0.5, 6);
    expect(getWorkJobsMap(state)).toEqual({});
    run(state, pipeline); // the queue (slot 4) sees it next step
    expect(getColonyQueue(state, 0, 'construction').some((e) => e.task.kind === 'dismantle')).toBe(false);
  });

  it('the HQ does it when there is no Worker Drone', () => {
    const { state, pipeline } = world('dis-hq');
    const hqId = spawnHqUnit(state, { owner: 0, q: -2, r: 0 });
    const ext = extractor(state, 4, 0);
    run(state, pipeline, [dismantleCmd('d-hq', 4, 0)]);
    expect(getWorkJobsMap(state)['d-hq']?.workerEntityId).toBe(hqId);
    run(state, pipeline, [], 200);
    expect(alive(state, ext)).toBe(false);
  });

  it('a Worker Drone T1 dismantles too (every tier may, W05-02)', () => {
    const { state, pipeline } = world('dis-t1');
    const workerId = spawnWorkerUnit(state, { tier: 1, owner: 0, q: 2, r: -1 });
    const ext = extractor(state, 4, 0);
    run(state, pipeline, [dismantleCmd('d-t1', 4, 0)]);
    expect(getWorkJobsMap(state)['d-t1']?.workerEntityId).toBe(workerId);
    run(state, pipeline, [], 200);
    expect(alive(state, ext)).toBe(false);
  });

});

describe('dismantle: host validation, cancel, crew, storage cap', () => {
  it('validates on the host: HQ / Command Hub, already dismantling, unknown or foreign entity', () => {
    const { state, pipeline, ext } = dismantleWorld('dis-reject');
    const hqId = spawnHqUnit(state, { owner: 0, q: -4, r: 0 });
    const hqRow = rowOf(state.entities, hqId);
    const q = state.entities.cols.q[hqRow], r = state.entities.cols.r[hqRow];
    expect(run(state, pipeline, [dismantleCmd('d-hq', q, r)]).outcomes[0]!.code).toBe('cannot_dismantle_hq');
    expect(run(state, pipeline, [dismantleCmd('d-a', 4, 0)]).outcomes[0]!.code).toBeUndefined();
    expect(run(state, pipeline, [dismantleCmd('d-b', 4, 0)]).outcomes[0]!.code).toBe('already_dismantling');
    const task = (entityId: number, id: string): SimCommand =>
      ({ commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { task: { kind: 'dismantle', entityId } } });
    expect(run(state, pipeline, [task(99999, 'd-c')]).outcomes[0]!.code).toBe('unknown_entity');
    const foreign = extractor(state, -5, 3);
    state.entities.cols.owner[rowOf(state.entities, foreign)] = 1;
    expect(run(state, pipeline, [task(foreign, 'd-d')]).outcomes[0]!.code).toBe('not_own_colony');
    expect(run(state, pipeline, [task(ext, 'd-e')]).outcomes[0]!.code).toBe('already_dismantling');
    expect(run(state, pipeline, [{ commandId: 'dem', colonyIndex: 0, source: 'player', kind: 'demolish', args: { entityId: ext } }]).outcomes[0]!.code).toBe('already_dismantling');
  });

  it('cancel mid-way: the building stands again with the hull it lost; the refund so far stays', () => {
    const { state, colony, pipeline, ext } = dismantleWorld('dis-cancel');
    const before = colony.stock['metals.t1'];
    run(state, pipeline, [dismantleCmd('d1', 4, 0)]);
    while (getWorkJobsMap(state).d1!.progress < 0.4) run(state, pipeline);
    const p = getWorkJobsMap(state).d1!.progress;
    const refunded = colony.stock['metals.t1'] - before;
    expect(refunded).toBeCloseTo(65 * 0.5 * p, 4);
    const res = run(state, pipeline, [{ commandId: 'c1', colonyIndex: 0, source: 'player', kind: 'cancelTask', args: { taskId: `building:${ext}` } }]);
    expect(res.outcomes[0]!.code).toBeUndefined();
    const row = rowOf(state.entities, ext);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(state.entities.cols.state[row]).not.toBe(ENTITY_STATE.constructing);
    // Hull lost = progress × refundRate / repair costRate, so repairing it costs what the dismantle refunded. The
    // Builder next to it starts that (paid) auto-repair in the same step: at most one repair step on top.
    const lostTo = Math.round(300 * (1 - p * (0.5 / 0.4)));
    expect(state.entities.cols.hp[row]).toBeGreaterThanOrEqual(lostTo);
    expect(state.entities.cols.hp[row]).toBeLessThanOrEqual(lostTo + 10);
    expect(Object.values(getWorkJobsMap(state)).some((j) => j.mode === 'repair' && j.targetEntityId === ext)).toBe(true);
    expect(Object.values(getWorkJobsMap(state)).some((j) => j.mode === 'dismantle')).toBe(false);
    expect(getColonyQueue(state, 0, 'construction').some((e) => e.task.kind === 'dismantle')).toBe(false);
  });

  it('cancel by the order id (the queue chip) ends it the same way', () => {
    const { state, pipeline, ext } = dismantleWorld('dis-cancel-id');
    run(state, pipeline, [dismantleCmd('d1', 4, 0)]);
    run(state, pipeline, [{ commandId: 'c1', colonyIndex: 0, source: 'player', kind: 'cancelTask', args: { taskId: 'd1' } }]);
    expect(state.entities.cols.state[rowOf(state.entities, ext)]).not.toBe(ENTITY_STATE.constructing);
    expect(state.entities.cols.hp[rowOf(state.entities, ext)]).toBe(300); // nothing taken apart yet: no hull lost
    expect(getWorkJobsMap(state)).toEqual({});
  });

  it('a crew dismantles faster and refunds exactly the same 50 %', () => {
    const go = (builders: number) => {
      const { state, colony, pipeline } = world(`dis-crew-${builders}`);
      for (let i = 0; i < builders; i++) spawnWorkerUnit(state, { tier: 2, owner: 0, q: 2, r: -1 - i });
      const ext = extractor(state, 4, 0);
      const before = colony.stock['metals.t1'];
      run(state, pipeline, [dismantleCmd('d1', 4, 0)]);
      let ticks = 1;
      while (ticks < 400 && alive(state, ext)) { run(state, pipeline); ticks++; }
      return { ticks, refund: colony.stock['metals.t1'] - before };
    };
    const [one, two] = [go(1), go(2)];
    expect(two.ticks).toBeLessThan(one.ticks);
    expect(one.refund).toBeCloseTo(32.5, 6);
    expect(two.refund).toBeCloseTo(32.5, 6);
  });

  it('refunds clamp at the storage cap (D-42): what does not fit is lost, never over the cap', () => {
    const { state, colony, pipeline, ext } = dismantleWorld('dis-cap');
    const cap = colony.caps.metals;
    run(state, pipeline, [dismantleCmd('d1', 4, 0)]);
    colony.stock['metals.t1'] = cap - 5; // room for 5 of the 32.5 metals refund
    run(state, pipeline, [], 200);
    expect(alive(state, ext)).toBe(false);
    expect(colony.stock['metals.t1']).toBeCloseTo(cap, 6);
    expect(getEntityBaseBuildCost(ENTITY_KIND.metalsExtractor, DATA)['metals.t1']).toBe(65);
  });
});
