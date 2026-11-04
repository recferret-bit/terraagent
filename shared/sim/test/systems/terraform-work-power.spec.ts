import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyBrownoutShedding,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyLedger,
  getColonyPower,
  hexIndex,
  insertRow,
  PREP,
  rowOf,
  setHqCellEnergy,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  step,
  TERRAFORM_TIME_TABLE,
  TERRAIN,
  workJobDrawPerS,
  type PlanetState,
  type SimCommand,
  type WorkJobRecord,
} from '../../src';

/** GP-45 (owner: colony grid): player work jobs draw from the colony grid and are shed first (group 1, `UO-TF-02`). */

/** Own level Flat world with colony 0, a Command Hub at (0, 0) (+16 / −7 E/s) and the HQ Drone at `hqAt`. */
function gridWorld(seed: string, hqAt = { q: 3, r: 0 }, radius = 10) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.prepared, 0);
    setTileDeposit(state, k, DEPOSIT.none, 0, 0);
    L.height[k] = 0;
    L.subDeposit[k] = 0;
    L.owner[k] = 0;
  }
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[hubRow] = ENTITY_KIND.commandHub;
  c.owner[hubRow] = 0;
  c.footprintW[hubRow] = 3;
  c.footprintD[hubRow] = 3;
  c.hp[hubRow] = 1500;
  c.state[hubRow] = ENTITY_STATE.active;
  const hq = spawnHqUnit(state, { owner: 0, ...hqAt }) as number;
  const hx = hexIndex(radius);
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const run = (cmds: SimCommand[] = []) => step(state, cmds, 1, pipeline);
  const ticks = (n: number) => { for (let i = 0; i < n; i++) run(); };
  const at = (q: number, r: number) => hx.indexOf(q, r);
  return {
    state, hq, run, ticks,
    forest: (q: number, r: number) => setTileTerrain(state, at(q, r), TERRAIN.forest, 0),
    terrain: (q: number, r: number) => L.terrain[at(q, r)],
  };
}

/** A powered Metals Extractor (−8 E/s, shed group 3) at `(q, r)`; returns its row. */
function addExtractor(state: PlanetState, q: number, r: number): number {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.metalsExtractor;
  c.owner[row] = 0;
  c.q[row] = q;
  c.r[row] = r;
  c.footprintW[row] = 2;
  c.footprintD[row] = 2;
  c.shedGroup[row] = 3;
  c.hp[row] = 500;
  c.state[row] = ENTITY_STATE.active;
  return row;
}

const work = (id: string, tiles: Array<{ q: number; r: number }>): SimCommand =>
  ({ commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles } } });
const jobsOf = (state: PlanetState) => (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};

function runUntil(run: () => unknown, done: () => boolean, max = 3000): number {
  for (let t = 1; t <= max; t++) {
    run();
    if (done()) return t;
  }
  return -1;
}

const FOREST_DRAW = workJobDrawPerS(TERRAFORM_TIME_TABLE.forest); // 8 E over 60 ticks (12 s)

describe('GP-45 work jobs on the colony grid', () => {
  it('draws energy / work time: a forest job is 8 E over 12 s, repair (no energy) draws nothing', () => {
    expect(FOREST_DRAW).toBeCloseTo(8 / 12, 4);
    expect(workJobDrawPerS(TERRAFORM_TIME_TABLE.rock)).toBeCloseTo(15 / 20, 4);
    expect(workJobDrawPerS(TERRAFORM_TIME_TABLE.repair)).toBe(0);
  });

  it('adds its E/s to demand only while the worker is at the job (walking draws nothing)', () => {
    const w = gridWorld('wp-walk', { q: -7, r: 0 });
    w.forest(7, 0);
    w.run([work('w1', [{ q: 7, r: 0 }])]);
    expect(getColonyPower(w.state, 0).workDemand).toBe(0);
    expect(getColonyPower(w.state, 0).rawDemand).toBe(7);

    expect(runUntil(w.run, () => getColonyPower(w.state, 0).workDemand > 0)).toBeGreaterThan(1);
    const p = getColonyPower(w.state, 0);
    expect(p.workDemand).toBe(FOREST_DRAW);
    expect(p.rawDemand).toBeCloseTo(7 + FOREST_DRAW, 4);
    expect(p.demand).toBeCloseTo(7 + FOREST_DRAW, 4);
    expect(p.buildingDemand).toBe(7);
    expect(p.brownout).toBe(false);
    expect(jobsOf(w.state).w1).toMatchObject({ status: 'in_progress' });
  });

  it('a brownout pauses the job (progress kept, waiting power) and it resumes and chains on when power returns', () => {
    const w = gridWorld('wp-shed');
    w.forest(4, 0);
    w.forest(5, 0);
    addExtractor(w.state, -4, 0);
    const ext = addExtractor(w.state, 0, -4);
    setHqCellEnergy(w.state, rowOf(w.state.entities, w.hq), 0); // an empty HQ cell: the grid has no store to draw
    w.run([work('w1', [{ q: 4, r: 0 }])]);
    w.ticks(2);

    // Hub 7 + 2 Extractors 16 + job 0.67 = 23.67 > 16: group 1 (the job) is shed first, then group 3 (the newest
    // Extractor); Hub 7 + the older Extractor 8 = 15 then fits.
    const p = getColonyPower(w.state, 0);
    expect(p.brownout).toBe(true);
    expect(p.shedWorkJobIds).toEqual(['w1']);
    expect(p.shedGroupsActive).toEqual([1, 3]);
    expect(p.workDemand).toBe(0);
    expect(p.demand).toBe(15);
    expect(jobsOf(w.state).w1).toMatchObject({ status: 'waiting', waitReason: 'power' });

    const frozen = jobsOf(w.state).w1!.progress;
    w.ticks(10);
    expect(jobsOf(w.state).w1!.progress).toBe(frozen);
    expect(w.terrain(4, 0)).toBe(TERRAIN.forest);

    w.state.entities.cols.hp[ext] = 0; // the load goes away: 7 + 8 + 0.67 <= 16
    w.ticks(1); // power decides at the end of a step, the job obeys it the next step
    expect(jobsOf(w.state).w1!.progress).toBe(frozen);
    w.ticks(1);
    expect(getColonyPower(w.state, 0).shedWorkJobIds).toEqual([]);
    expect(jobsOf(w.state).w1).toMatchObject({ status: 'in_progress' });
    expect(jobsOf(w.state).w1!.waitReason).toBeUndefined();
    expect(jobsOf(w.state).w1!.progress).toBeGreaterThan(frozen);

    expect(runUntil(w.run, () => w.terrain(4, 0) === TERRAIN.flat)).toBeGreaterThan(0);
    expect(jobsOf(w.state)['w1~1']).toMatchObject({ q: 5, r: 0, chainRootId: 'w1' });
    expect(runUntil(w.run, () => w.terrain(5, 0) === TERRAIN.flat)).toBeGreaterThan(0);
  });

  it('sheds work jobs (group 1) before extractors (group 3): a small deficit pauses the job only', () => {
    const w = gridWorld('wp-order');
    const ext = addExtractor(w.state, -4, 0);
    const hqRow = rowOf(w.state.entities, w.hq);
    const job = { entityId: w.hq, row: hqRow, group: 1, drainPerS: 3, kind: ENTITY_KIND.hq, jobId: 'w1' };
    const extC = { entityId: w.state.entities.cols.id[ext], row: ext, group: 3, drainPerS: 6, kind: ENTITY_KIND.metalsExtractor };

    const small = applyBrownoutShedding(w.state, 0, 11, 14, [extC, job], [{ q: 0, r: 0 }], 1);
    expect(small.shedWorkJobIds).toEqual(['w1']);
    expect(small.shedEntityIds).toEqual([]);
    expect(small.shedGroupsActive).toEqual([1]);
    expect(small.remainingDemand).toBe(11);
    expect(w.state.entities.cols.state[ext]).toBe(ENTITY_STATE.active);
    expect(w.state.entities.cols.state[hqRow]).not.toBe(ENTITY_STATE.offlineBrownout); // the worker itself is never shed

    const big = applyBrownoutShedding(w.state, 0, 8, 14, [extC, job], [{ q: 0, r: 0 }], 2);
    expect(big.shedWorkJobIds).toEqual(['w1']);
    expect(big.shedEntityIds).toEqual([extC.entityId]);
    expect(big.shedGroupsActive).toEqual([1, 3]);
  });

  it('before the Hub there is no grid: work jobs stay unmetered and are never paused', () => {
    const w = gridWorld('wp-prehub');
    w.state.entities.cols.hp[0] = 0; // no Hub
    w.forest(4, 0);
    w.run([work('w1', [{ q: 4, r: 0 }])]);
    w.ticks(3);
    expect(getColonyPower(w.state, 0).workDemand).toBe(0);
    expect(jobsOf(w.state).w1).toMatchObject({ status: 'in_progress' });
  });
});
