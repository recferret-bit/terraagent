import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ENTITY_STATE,
  getBuildingJobs,
  getColonyQueue,
  getColonyStock,
  getColonyTerraformOrders,
  getFootprintTileIndices,
  getUnitCommand,
  getUnitRecord,
  hexDistance,
  PREP,
  restore,
  rowOf,
  setColonyStock,
  setTilePrep,
  SimHost,
  snapshot,
  spawnWorkerUnit,
  spawnHqUnit,
  type PlanetState,
} from '../../src';
import { cmd, HQ_SPEED_PER_TICK, MotionWatch } from './helpers';

const EPS = 1e-4;
const A = { q: 5, r: 0 };
const B = { q: -6, r: 3 };

function rig(): { host: SimHost; hqId: number } {
  const host = new SimHost({ flags: parseWaves('..02') });
  host.load(createPlanet({ type: 'flat', seed: 'w02-dispatch', radius: 16 }));
  setColonyStock(host.state, 0, { 'metals.t1': 400, 'minerals.t1': 400, 'bio.biomass': 100, 'bio.water': 100 });
  const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return { host, hqId };
}

const entry = (state: PlanetState, taskId: string) => getColonyQueue(state, 0, 'construction').find((e) => e.taskId === taskId);
const progressOf = (state: PlanetState, entityId: number | undefined) =>
  entityId === undefined || rowOf(state.entities, entityId) < 0 ? 0 : state.entities.cols.progress[rowOf(state.entities, entityId)];
const isBuilt = (state: PlanetState, entityId: number | undefined) =>
  entityId !== undefined && rowOf(state.entities, entityId) >= 0 && state.entities.cols.state[rowOf(state.entities, entityId)] !== ENTITY_STATE.constructing;

/**
 * Steps until the building `id()` names is built (at most `max` ticks). Every step its progress grows, the HQ stands
 * within its build reach [2, 3] of `site`: nothing is built from afar.
 */
function buildWatched(host: SimHost, hqId: number, site: { q: number; r: number }, id: () => number | undefined, watch: MotionWatch, max: number, each = () => {}): void {
  const state = host.state, cols = state.entities.cols;
  let prev = 0;
  for (let t = 0; t < max && !isBuilt(state, id()); t++) {
    host.step(1);
    watch.sample();
    each();
    const p = progressOf(state, id());
    if (p > prev && !isBuilt(state, id())) {
      const row = rowOf(state.entities, hqId);
      const d = hexDistance(cols.q[row], cols.r[row], site.q, site.r);
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(3);
    }
    prev = p;
  }
  expect(isBuilt(state, id())).toBe(true);
}

describe('dispatch v1: W02 buildings are built by the HQ on site, one after the other (W02-16, UO-D-03)', () => {
  it('two queued builds with only the HQ: it preps and builds A, then walks to B and builds it; nothing advances from afar', () => {
    const { host, hqId } = rig();
    const state = host.state;
    const cols = state.entities.cols;
    const watch = new MotionWatch(() => host.state);

    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    host.submit(cmd('enqueueTask', { taskId: 'b', task: { kind: 'build', building: 'solar', ...B } }));
    expect(host.step(1).outcomes.map((o) => o.code)).toEqual([undefined, undefined]);
    watch.sample();
    // A starts with its linked prep (its footprint is not prepared); B waits for the only builder
    expect(entry(state, 'a')).toMatchObject({ state: 'in_progress', waitReason: 'site' });
    expect(entry(state, 'b')).toMatchObject({ state: 'waiting', waitReason: 'worker' });
    const aId = entry(state, 'a')!.entityId!;
    expect(getColonyTerraformOrders(state, 0).find((o) => o.isLinkedPrep)).toMatchObject({ linkedBuildingEntityId: aId, totalJobs: 4 });

    buildWatched(host, hqId, A, () => aId, watch, 400, () => {
      expect(entry(state, 'b')?.entityId).toBeUndefined(); // B is not started while A is being built
    });
    const hqRow = rowOf(state.entities, hqId);
    expect(hexDistance(cols.q[hqRow], cols.r[hqRow], B.q, B.r)).toBeGreaterThan(3); // still at A
    expect(getColonyTerraformOrders(state, 0).find((o) => o.isLinkedPrep)).toBeUndefined(); // A's prep is finished, none left over

    // B: the HQ walks there (no progress on the way), preps and builds it
    buildWatched(host, hqId, B, () => entry(state, 'b')?.entityId, watch, 500);
    host.step(1); // the queue marks the entry done in its next step
    expect(getColonyQueue(state, 0, 'construction')).toEqual([]);
    expect(watch.maxStep).toBeLessThanOrEqual(HQ_SPEED_PER_TICK + EPS); // it walked, it never teleported
  });

  it('a build does not advance (and is not paid) while the HQ is ordered away; it walks back and finishes', () => {
    const { host, hqId } = rig();
    const state = host.state;
    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    host.step(1);
    const aId = entry(state, 'a')!.entityId!;
    for (let t = 0; t < 400 && progressOf(state, aId) < 0.3; t++) host.step(1);
    expect(progressOf(state, aId)).toBeGreaterThanOrEqual(0.3);

    host.submit(cmd('moveUnit', { entityId: hqId, q: -8, r: 0 }));
    host.step(1);
    const frozen = { progress: progressOf(state, aId), paid: { ...(getBuildingJobs(state)[aId].spentCost ?? {}) }, stock: { ...getColonyStock(state, 0) } };
    for (let t = 0; t < 30; t++) host.step(1);
    expect(progressOf(state, aId)).toBe(frozen.progress);
    expect(getBuildingJobs(state)[aId].spentCost).toEqual(frozen.paid);
    expect(getColonyStock(state, 0)).toEqual(frozen.stock);
    expect(entry(state, 'a')).toMatchObject({ state: 'in_progress', waitReason: 'worker', waitDetail: 'waiting: worker (HQ en route)' });

    // Once the move ends the HQ takes the job up again (auto work), walks back and completes it
    for (let t = 0; t < 400 && !isBuilt(state, aId); t++) host.step(1);
    expect(isBuilt(state, aId)).toBe(true);
    expect(getBuildingJobs(state)[aId]).toBeUndefined();
  });

});

describe('dispatch v1: who builds, and builds across snapshots (W02-16)', () => {
  it.each([
    ['unprepared', false, 'terraform'],
    ['prepared', true, 'build'],
  ])('a T1 worker drone takes a T1 %s site', (_label, prepared, commandKind) => {
    const host = new SimHost({ flags: parseWaves('..02') });
    host.load(createPlanet({ type: 'flat', seed: 'w02-dispatch', radius: 16 }));
    setColonyStock(host.state, 0, { 'metals.t1': 400, 'minerals.t1': 400, 'bio.biomass': 100, 'bio.water': 100 });
    if (prepared) for (const i of getFootprintTileIndices(host.state, A.q, A.r, 2, 2).indices) setTilePrep(host.state.grid, i, PREP.prepared);
    const harvId = spawnWorkerUnit(host.state, { owner: 0, q: A.q - 1, r: A.r });
    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    let saw = false;
    for (let t = 0; t < 40 && !saw; t++) {
      host.step(1);
      saw = getUnitCommand(host.state, harvId)?.kind === commandKind;
    }
    expect(saw).toBe(true);
  });
});

describe('dispatch v1: a build no eligible worker can take waits and pays nothing (W02-16, W05-02)', () => {
  it.each([
    ['unprepared (its linked prep waits too)', false, 'waiting: site (prep 0/4)'],
    ['prepared', true, 'waiting: worker (none free)'],
  ])('with no worker at all a started build on a %s site never advances and pays nothing', (_label, prepared, detail) => {
    const host = new SimHost({ flags: parseWaves('..02') });
    host.load(createPlanet({ type: 'flat', seed: 'w02-dispatch', radius: 16 }));
    setColonyStock(host.state, 0, { 'metals.t1': 400, 'minerals.t1': 400, 'bio.biomass': 100, 'bio.water': 100 });
    if (prepared) for (const i of getFootprintTileIndices(host.state, A.q, A.r, 2, 2).indices) setTilePrep(host.state.grid, i, PREP.prepared);
    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    for (let t = 0; t < 120; t++) host.step(1);
    const e = entry(host.state, 'a')!;
    expect(e.state).toBe('in_progress');
    expect(e.waitDetail).toBe(detail);
    expect(progressOf(host.state, e.entityId)).toBe(0);
    expect(Object.values(getBuildingJobs(host.state)[e.entityId!].spentCost ?? {}).every((v) => !v)).toBe(true);
  });

  it('a T1 worker never takes a tier-2 site: it does not try and back off, and the entry waits on `worker (none free)`', () => {
    const host = new SimHost({ flags: parseWaves('..02') });
    host.load(createPlanet({ type: 'flat', seed: 'w02-dispatch', radius: 16 }));
    setColonyStock(host.state, 0, { 'metals.t1': 400, 'minerals.t1': 400, 'bio.biomass': 100, 'bio.water': 100 });
    for (const i of getFootprintTileIndices(host.state, A.q, A.r, 2, 2).indices) setTilePrep(host.state.grid, i, PREP.prepared);
    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    host.step(1);
    const siteId = entry(host.state, 'a')!.entityId!;
    host.state.entities.cols.tier[rowOf(host.state.entities, siteId)] = 2; // the site is tier 2: above a T1 worker's cap
    const workerId = spawnWorkerUnit(host.state, { owner: 0, q: A.q - 1, r: A.r });
    for (let t = 0; t < 120; t++) {
      host.step(1);
      expect(getUnitCommand(host.state, workerId)?.kind ?? 'none').not.toBe('build');
    }
    expect(Object.keys(getUnitRecord(host.state, workerId)?.skip ?? {})).toEqual([]); // not even tried and backed off
    const e = entry(host.state, 'a')!;
    expect(e).toMatchObject({ state: 'in_progress', waitReason: 'worker', waitDetail: 'waiting: worker (none free)' });
    expect(progressOf(host.state, siteId)).toBe(0);
  });
});

describe('dispatch v1: builds across snapshots (W02-16)', () => {
  it('a build in progress survives snapshot / restore and both copies finish on the same tick', () => {
    const { host } = rig();
    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    for (let t = 0; t < 40; t++) host.step(1);
    const copy = new SimHost({ flags: parseWaves('..02') });
    copy.load(restore(snapshot(host.state)));
    const aId = entry(host.state, 'a')!.entityId!;
    let doneAt = -1;
    let copyDoneAt = -1;
    for (let t = 0; t < 400 && (doneAt < 0 || copyDoneAt < 0); t++) {
      host.step(1);
      copy.step(1);
      if (doneAt < 0 && isBuilt(host.state, aId)) doneAt = host.tick;
      if (copyDoneAt < 0 && isBuilt(copy.state, aId)) copyDoneAt = copy.tick;
    }
    expect(doneAt).toBeGreaterThan(0);
    expect(copyDoneAt).toBe(doneAt);
  });

  it.each([
    ['its queue entry', 'a'],
    ['its linked prep order', 'job:PREP'],
    ['the HQ task (`unit:<hq>`)', 'unit:HQ'],
  ])('cancelling a build during its linked prep through %s removes the building, the prep order and the entry', (_label, id) => {
    const { host, hqId } = rig();
    const state = host.state;
    host.submit(cmd('enqueueTask', { taskId: 'a', task: { kind: 'build', building: 'solar', ...A } }));
    for (let t = 0; t < 15; t++) host.step(1); // the HQ is grading the footprint
    const aId = entry(state, 'a')!.entityId!;
    const prep = getColonyTerraformOrders(state, 0).find((o) => o.isLinkedPrep)!;
    expect(prep.orderId).toBe(`job:${aId}/prep`);
    const taskId = id === 'job:PREP' ? prep.orderId : id === 'unit:HQ' ? `unit:${hqId}` : id;
    host.submit(cmd('cancelTask', { taskId }));
    expect(host.step(1).outcomes.map((o) => o.code)).toEqual([undefined]);
    host.step(1);
    expect(rowOf(state.entities, aId)).toBe(-1);
    expect(getBuildingJobs(state)[aId]).toBeUndefined();
    expect(getColonyTerraformOrders(state, 0)).toEqual([]);
    expect(getColonyQueue(state, 0, 'construction')).toEqual([]);
  });

  it('cancelTask / reorderTask of an id no order, entry or task has: `unknown_task`', () => {
    const { host } = rig();
    host.submit(cmd('cancelTask', { taskId: 'nope' }));
    host.submit(cmd('reorderTask', { taskId: 'nope', toIndex: 0 }));
    expect(host.step(1).outcomes.map((o) => o.code)).toEqual(['unknown_task', 'unknown_task']);
  });
});
