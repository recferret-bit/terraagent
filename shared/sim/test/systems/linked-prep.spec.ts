import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  buildLinkedPrepJobs,
  cancelConstructionOrder,
  computeSitePrepBill,
  createPlanet,
  enqueueTerraformOrder,
  ENTITY_STATE,
  getColonyTerraformOrders,
  getConstructionOrders,
  getHubFootprintTiles,
  getManualTerraformLaneCount,
  hasColonyHub,
  hexIndex,
  isBuildablePrepared,
  PREP,
  rowOf,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type SimCommand,
} from '../../src';

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0, idPrefix = 'lp'): SimCommand {
  return { colonyIndex, source: 'player', commandId: `${idPrefix}_${++cmdSeq}`, kind, args };
}

function createW01Host(radius = 12): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'linked-prep-test', radius }));
  return host;
}

function stepToFullPrep(host: SimHost): { seenCounts: number[]; seenTexts: string[] } {
  const state = host.state;
  const initial = getConstructionOrders(state, 0)[0]!;
  const seenCounts: number[] = [initial.preparedCount];
  const seenTexts: string[] = [initial.statusText];

  for (let tick = 0; tick < 200; tick++) {
    host.step(1);
    const current = getConstructionOrders(state, 0)[0]!;
    if (seenCounts[seenCounts.length - 1] !== current.preparedCount) {
      seenCounts.push(current.preparedCount);
      seenTexts.push(current.statusText);
    }
    if (current.preparedCount === 9) break;
  }
  return { seenCounts, seenTexts };
}

describe('W01-15: Linked site prep order & waiting(site: n/9) progression (UO-TF-03, UO-Q-04)', () => {
  it('acceptance: Hub on 3 Rock is rejected until the rock is broken; then one linked order with 9 Grade climbs 0/9 -> 9/9', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    const idx = hexIndex(state.grid.radius);
    const footprint = getHubFootprintTiles(3, 0);

    for (const pos of [footprint[2], footprint[5], footprint[8]]) {
      setTileTerrain(state.grid, idx.indexOf(pos.q, pos.r), TERRAIN.rock);
    }

    const bill = computeSitePrepBill(state, 3, 0, 3);
    expect(bill.unpreparedTiles).toBe(9);
    expect(bill.totalTiles).toBe(9);
    expect(bill.subJobs).toHaveLength(12);
    expect(bill.countsByOp).toEqual({ grade: 9, clear: 0, break: 3 });
    expect(bill.baseSeconds).toBe(45);
    expect(bill.hqSeconds).toBeCloseTo(30, 5);
    expect(bill.totalEnergyE).toBe(360);
    expect(bill.yields).toEqual({ 'bio.biomass': 0, 'metals.t1': 30 });

    // Rock (and trees) must be terraformed by the player first: the server rejects the placement.
    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'place_on_rock'));
    expect(host.step(1).outcomes[0]?.code).toBe('terrain_unbuildable');
    for (const pos of [footprint[2], footprint[5], footprint[8]]) {
      setTileTerrain(state.grid, idx.indexOf(pos.q, pos.r), TERRAIN.flat);
    }

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'place_hub'));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    const tfOrders = getColonyTerraformOrders(state, 0);
    expect(tfOrders).toHaveLength(1);
    const linkedOrder = tfOrders[0]!;
    expect(linkedOrder.isLinkedPrep).toBe(true);
    expect(linkedOrder.countsTowardLaneLimit).toBe(false);
    expect(getManualTerraformLaneCount(state, 0)).toBe(0);
    expect(linkedOrder.jobs).toHaveLength(9);
    expect(linkedOrder.jobs.every((j) => j.op === 'grade')).toBe(true);

    const buildOrder = getConstructionOrders(state, 0)[0]!;
    expect(buildOrder.linkedPrepOrderId).toBe(linkedOrder.orderId);
    expect(linkedOrder.linkedOrderId).toBe(buildOrder.orderId);
    expect(linkedOrder.linkedBuildingEntityId).toBe(buildOrder.entityId);
    expect(buildOrder.preparedCount).toBe(0);
    expect(buildOrder.statusText).toBe('waiting(site: 0/9)');

    const hubRow = rowOf(state.entities, buildOrder.entityId);
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.waiting);

    const { seenCounts, seenTexts } = stepToFullPrep(host);
    expect(seenCounts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(seenTexts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `waiting(site: ${n}/9)`));

    for (const pos of footprint) {
      expect(isBuildablePrepared(state.grid, idx.indexOf(pos.q, pos.r))).toBe(true);
    }
    const finalOrder = getConstructionOrders(state, 0)[0]!;
    expect(finalOrder.preparedCount).toBe(9);
    expect(finalOrder.status).toBe('in_progress');
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.constructing);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);
    expect(state.entities.cols.cell[hqSlot]).toBeCloseTo(800 - 9 * 20, 3);
  });
});

describe('W01-15: Forest/Rock prep planning & cancel propagation (UO-TF-03, UO-Q-02)', () => {
  it('plans Clear + Grade for Forest tiles and skips already Prepared/Living tiles', () => {
    const host = createW01Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const footprint = getHubFootprintTiles(3, 0);

    setTilePrep(state.grid, idx.indexOf(footprint[0].q, footprint[0].r), PREP.prepared);
    setTilePrep(state.grid, idx.indexOf(footprint[1].q, footprint[1].r), PREP.living);
    setTileTerrain(state.grid, idx.indexOf(footprint[2].q, footprint[2].r), TERRAIN.forest);
    setTileTerrain(state.grid, idx.indexOf(footprint[3].q, footprint[3].r), TERRAIN.forest);
    setTileTerrain(state.grid, idx.indexOf(footprint[4].q, footprint[4].r), TERRAIN.rock);

    const jobs = buildLinkedPrepJobs(state, footprint);
    expect(jobs).toHaveLength(10);
    expect(jobs.filter((j) => j.op === 'clear')).toHaveLength(2);
    expect(jobs.filter((j) => j.op === 'break')).toHaveLength(1);
    expect(jobs.filter((j) => j.op === 'grade')).toHaveLength(7);

    const bill = computeSitePrepBill(state, 3, 0, 3);
    expect(bill.unpreparedTiles).toBe(7);
    expect(bill.totalTiles).toBe(9);
    expect(bill.yields).toEqual({ 'bio.biomass': 10, 'metals.t1': 10 });
  });

  it('cancelling construction mid-prep cancels the linked terraform order, removes the pending Hub, and keeps prepared tiles', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    const idx = hexIndex(state.grid.radius);
    const footprint = getHubFootprintTiles(3, 0);

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'cancel_hub'));
    host.step(1);
    for (let t = 0; t < 29; t++) {
      host.step(1);
    }

    const midOrder = getConstructionOrders(state, 0)[0]!;
    expect(midOrder.preparedCount).toBe(3);
    expect(midOrder.statusText).toBe('waiting(site: 3/9)');
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(1);

    host.submit(mkCmd('cancelTask', { taskId: midOrder.orderId }, 0, 'cancel_cmd'));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    expect(getConstructionOrders(state, 0)).toHaveLength(0);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);
    expect(hasColonyHub(state, 0)).toBe(false);
    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.idle);

    const preparedAfterCancel = footprint.filter((pos) =>
      isBuildablePrepared(state.grid, idx.indexOf(pos.q, pos.r)),
    );
    expect(preparedAfterCancel).toHaveLength(3);

    enqueueTerraformOrder(state, { colonyId: 0, op: 'grade', tiles: [{ q: -2, r: 0 }] });
    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 're_place_hub'));
    host.step(1);

    expect(getColonyTerraformOrders(state, 0)).toHaveLength(2);
    expect(getManualTerraformLaneCount(state, 0)).toBe(1);

    const secondOrder = getConstructionOrders(state, 0)[0]!;
    expect(cancelConstructionOrder(state, 0, secondOrder.entityId, state.meta.tick)).toBe(true);
    expect(getConstructionOrders(state, 0)).toHaveLength(0);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(1);
    expect(getManualTerraformLaneCount(state, 0)).toBe(1);
  });
});
