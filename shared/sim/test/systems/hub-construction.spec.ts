import { describe, expect, it } from 'vitest';
import { eventDef } from '@terra/contracts';
import {
  cancelConstructionOrder,
  ENTITY_STATE,
  getColonyStock,
  getConstructionOrders,
  getHqView,
  getHubFootprintTiles,
  hasColonyHub,
  hexIndex,
  isBuildablePrepared,
  placeBuildingOrder,
  PREP,
  rowOf,
  setColonyStock,
  setTilePrep,
  SimHost,
  spawnHqUnit,
  type SimCommand,
} from '../../src';
import { w01Host } from '../helpers/host';
import { fullStock } from '../economy/helpers';

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0, prefix = 'hc'): SimCommand {
  return { colonyIndex, source: 'player', commandId: `${prefix}_${++cmdSeq}`, kind, args };
}

const createW01Host = (radius = 12): SimHost => w01Host({ seed: 'hub-construction-test', radius });

function prepareHubSite(host: SimHost, centerQ: number, centerR: number): Array<{ q: number; r: number }> {
  const state = host.state;
  const idx = hexIndex(state.grid.radius);
  const footprint = getHubFootprintTiles(centerQ, centerR);
  for (const pos of footprint) {
    setTilePrep(state.grid, idx.indexOf(pos.q, pos.r), PREP.prepared);
  }
  return footprint;
}

describe('W01-16: Command Hub construction payment & 75% cancel refund', () => {
  it('acceptance: cancelling Hub construction at 50% progress refunds 75% of the cost spent so far and keeps all 9 prepared tiles', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    setColonyStock(state, 0, {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
    const footprint = prepareHubSite(host, 3, 0);

    // Start Hub construction on prepared 3x3 site -> nothing is deducted up front; cost is spent over build time
    const placeRes = placeBuildingOrder(state, { colonyId: 0, q: 3, r: 0, buildingKind: 'commandHub' });
    expect(placeRes.ok).toBe(true);
    expect(placeRes.order?.status).toBe('in_progress');
    expect(placeRes.order?.costPaid).toBe(true);
    expect(getColonyStock(state, 0)).toEqual(fullStock({
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    }));
    expect(placeRes.order?.paidAmounts).toEqual({});

    // Step 50 ticks (10.0 s at 1.5x HQ work rate vs 30 s nominal build time) -> 50% progress
    host.step(50);

    const midOrder = getConstructionOrders(state, 0)[0]!;
    expect(midOrder.status).toBe('in_progress');
    expect(midOrder.progress).toBeCloseTo(0.5, 5);

    const hubRow = rowOf(state.entities, midOrder.entityId);
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.constructing);
    expect(state.entities.cols.progress[hubRow]).toBeCloseTo(0.5, 5);
    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.constructing);
    expect(getHqView(state, 0)?.currentJob).toBe('constructing');
    // Half the build -> half the cost spent (100/50/25/25)
    expect(getColonyStock(state, 0)).toEqual(fullStock({
      'metals.t1': 500,
      'minerals.t1': 300,
      'bio.biomass': 175,
      'bio.water': 175,
    }));

    // Cancel at 50% via cancelTask command -> 75% of the spent half refunded and prepared tiles kept
    host.submit(mkCmd('cancelTask', { taskId: midOrder.orderId }, 0, 'cancel_50'));
    const cancelStep = host.step(1);
    expect(cancelStep.outcomes[0]?.code).toBeUndefined();

    expect(getConstructionOrders(state, 0)).toHaveLength(0);
    expect(hasColonyHub(state, 0)).toBe(false);
    expect(rowOf(state.entities, midOrder.entityId)).toBe(-1);
    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.idle);
    expect(state.entities.cols.progress[hqSlot]).toBe(0);

    const stockAfterCancel = getColonyStock(state, 0);
    // Refund = floor(paid × 7500 / 10000) per resource: 75/37/18/18 of the 100/50/25/25 paid
    expect(stockAfterCancel).toEqual(fullStock({ 'metals.t1': 575, 'minerals.t1': 337, 'bio.biomass': 193, 'bio.water': 193 }));

    const idx = hexIndex(state.grid.radius);
    for (const pos of footprint) {
      expect(isBuildablePrepared(state.grid, idx.indexOf(pos.q, pos.r))).toBe(true);
    }
  });
});

describe('W01-16: Command Hub 20.0 s construction progress & buildingCompleted event', () => {
  it('builds Command Hub in 20.0 s (100 ticks) with HQ 1.5x workRate against 30 s buildTimeS and emits buildingCompleted', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    setColonyStock(state, 0, {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
    prepareHubSite(host, 3, 0);

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'build_full'));

    const allEvents = [];
    for (let t = 1; t <= 99; t++) {
      const res = host.step(1);
      if (t === 1) {
        expect(res.outcomes[0]?.code).toBeUndefined();
        // 1% progress -> floor(1% of 200/100/50/50) whole units spent
        expect(getColonyStock(state, 0)).toEqual(fullStock({
          'metals.t1': 598,
          'minerals.t1': 349,
          'bio.biomass': 200,
          'bio.water': 200,
        }));
      }
      allEvents.push(...res.events);
    }

    expect(host.tick).toBe(99);
    const order99 = getConstructionOrders(state, 0)[0]!;
    expect(order99.status).toBe('in_progress');
    expect(order99.progress).toBeCloseTo(0.99, 5);
    expect(allEvents.filter((e) => e.kind === 'buildingCompleted')).toHaveLength(0);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(402);

    const step100 = host.step(1);
    allEvents.push(...step100.events);
    expect(host.tick).toBe(100);
    expect(host.tick * 0.2).toBeCloseTo(20.0, 5);

    // A completed order leaves the queue (GP-10); its result is the active Hub
    expect(getConstructionOrders(state, 0)).toEqual([]);
    const order100 = order99;
    // Fully paid exactly at completion
    const finalStock = getColonyStock(state, 0);
    expect(finalStock).toEqual(fullStock({ 'metals.t1': 400, 'minerals.t1': 250, 'bio.biomass': 150, 'bio.water': 150 }));

    const hubRow = rowOf(state.entities, order100.entityId);
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.active);
    expect(state.entities.cols.progress[hubRow]).toBe(1);
    expect(state.entities.cols.hp[hubRow]).toBe(1500);
    expect(state.entities.cols.hpMax[hubRow]).toBe(1500);

    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.idle);
    expect(state.entities.cols.progress[hqSlot]).toBe(0);
    expect(getHqView(state, 0)?.currentJob).toBe('idle');

    const completedEvents = allEvents.filter((e) => e.kind === 'buildingCompleted');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].data).toEqual({
      colonyId: 'col_0',
      entityId: order100.entityId,
      building: 'commandHub',
      tier: 1,
      q: 3,
      r: 0,
    });
    expect(eventDef('buildingCompleted').data.safeParse(completedEvents[0].data).success).toBe(true);

    // Completed order cannot be cancelled
    expect(cancelConstructionOrder(state, 0, order100.orderId)).toBe(false);
  });
});

describe('W01-16: Pay-on-start after linked prep & waiting_resources behavior (UO-Q-01..03)', () => {
  it('pays nothing while waiting_site during linked prep, then spends 200/100/50/50 gradually once 9/9 tiles are prepared and builds in 20 s', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setColonyStock(state, 0, {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });

    // Place on 9 unprepared Flat tiles -> 9 Grade jobs * 10 ticks = 90 ticks (18.0 s) of work, plus the HQ's walks
    // between tiles (it is never teleported onto a tile).
    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'prep_then_pay'));
    const prepared = () => getConstructionOrders(state, 0)[0]?.preparedCount ?? 0;
    let ticks = 0;
    for (; ticks < 80 && prepared() < 4; ticks++) host.step(1);

    const waitingOrder = getConstructionOrders(state, 0)[0]!;
    expect(waitingOrder.status).toBe('waiting_site');
    expect(waitingOrder.preparedCount).toBe(4);
    expect(waitingOrder.costPaid).toBe(false);
    // Stock untouched while still preparing site (UO-Q-01)
    expect(getColonyStock(state, 0)).toEqual(fullStock({
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    }));

    // Finish the site prep -> 9/9 prepared, cost paid on start. The HQ works every tile from outside the footprint
    // (buildings block ground movement), so walking around the site adds a few seconds to the 18 s of work.
    for (; ticks < 200 && prepared() < 9; ticks++) host.step(1);
    expect(ticks).toBeGreaterThanOrEqual(90);
    expect(ticks).toBeLessThanOrEqual(135);
    const startedOrder = getConstructionOrders(state, 0)[0]!;
    expect(startedOrder.preparedCount).toBe(9);
    expect(startedOrder.status).toBe('in_progress');
    expect(startedOrder.costPaid).toBe(true);
    expect(getColonyStock(state, 0)['metals.t1']).toBeGreaterThan(590);

    // 20.0 s (100 ticks) of building completes the Hub, after a short walk out of the footprint
    const buildEvents = [];
    for (let t = 0; t < 110 && getConstructionOrders(state, 0).length > 0; t++) {
      buildEvents.push(...host.step(1).events);
    }
    expect(getConstructionOrders(state, 0)).toEqual([]); // completed orders leave the queue (GP-10)
    expect(buildEvents.some((e) => e.kind === 'buildingCompleted')).toBe(true);
  });

  it('waits in waiting_resources when stock is insufficient and starts automatically once resources are granted', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setColonyStock(state, 0, {
      'metals.t1': 120,
      'minerals.t1': 100,
      'bio.biomass': 50,
      'bio.water': 50,
    });
    prepareHubSite(host, 3, 0);

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'wait_res'));
    host.step(5);

    const waitingOrder = getConstructionOrders(state, 0)[0]!;
    expect(waitingOrder.status).toBe('waiting_resources');
    expect(waitingOrder.costPaid).toBe(false);
    expect(waitingOrder.waitingReason).toBe('waiting(resources: metals.t1 120/200)');
    const hubRow = rowOf(state.entities, waitingOrder.entityId);
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.waiting);

    // Grant the missing 80 metals.t1 -> the site pays and goes in_progress (construction slot), the builder takes it
    // up in the next step's units slot and works it in that step's construction slot
    host.submit({
      colonyIndex: 0,
      source: 'dev',
      commandId: 'grant_metals',
      kind: 'dev.grant',
      args: { resource: 'metals.t1', amount: 80 },
    });
    host.step(1);
    expect(getConstructionOrders(state, 0)[0]!.progress).toBe(0);
    host.step(1);

    const activeOrder = getConstructionOrders(state, 0)[0]!;
    expect(activeOrder.status).toBe('in_progress');
    expect(activeOrder.costPaid).toBe(true);
    expect(activeOrder.progress).toBeCloseTo(0.01, 5);
    // Only the first 1% slice was spent; the rest is paid as the build advances
    expect(getColonyStock(state, 0)['metals.t1']).toBe(198);
    expect(getColonyStock(state, 0)['bio.water']).toBe(50); // floor(0.5) = 0 spent so far
  });
});
