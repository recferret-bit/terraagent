import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  cancelQueueTask,
  createRegistryPipeline,
  createState,
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  enqueueQueueTask,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  getFootprintTileIndices,
  hexIndex,
  insertRow,
  refundCost,
  rowOf,
  setTileDeposit,
  spawnHarvesterUnit,
  spawnHqUnit,
  step,
  type ColonyWithLedger,
  type PlanetState,
} from '../../src';

/** W02 review fixes (2026-11-03): queue cancel races, unit batches, ETA, harvest weights colony, refunds, evacuation. */

const pipeline = () => createRegistryPipeline({ flags: parseWaves('..02') });

function colonyPlanet(seed: string, stock: Partial<Record<string, number>> = {}): { state: PlanetState; colony: ColonyWithLedger } {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 10 });
  const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'Alpha', color: 0xff6b00, status: 'active', changedAt: 0 });
  state.colonies.push(colony);
  for (const [k, v] of Object.entries(stock)) creditResource(colony, k as never, v ?? 0, 0);
  return { state, colony };
}

/** An active Command Hub at (0, 0): grid power and the Harvester spawn edge. */
function addActiveHub(state: PlanetState): number {
  const cols = state.entities.cols;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  cols.kind[row] = ENTITY_KIND.commandHub;
  cols.owner[row] = 0;
  cols.footprintW[row] = 3;
  cols.footprintD[row] = 3;
  cols.hp[row] = 1500;
  cols.hpMax[row] = 1500;
  cols.state[row] = ENTITY_STATE.active;
  return id;
}

const harvesterCount = (state: PlanetState): number => {
  let n = 0;
  for (let r = 0; r < state.entities.count; r++) if (state.entities.cols.kind[r] === ENTITY_KIND.harvester) n++;
  return n;
};

const RICH = { 'metals.t1': 400, 'minerals.t1': 400, 'bio.biomass': 300, 'bio.water': 300 };

describe('cancel never removes a finished building', () => {
  it('rejects cancelTask building:<id> on an active building and keeps it', () => {
    const { state, colony } = colonyPlanet('cancel-active', RICH);
    spawnHqUnit(state, { owner: 0, q: -3, r: 0 });
    const res = enqueueQueueTask(state, { colonyIndex: 0, task: { kind: 'build', building: 'solar', q: 3, r: 0 } });
    if (!res.ok) throw new Error(res.code);
    const p = pipeline();
    for (let i = 0; i < 80 && rowOf(state.entities, res.entry.entityId ?? -1) < 0; i++) step(state, [], 1, p);
    const entityId = getColonyQueue(state, 0, 'construction')[0]?.entityId ?? res.entry.entityId!;
    for (let i = 0; i < 120 && state.entities.cols.state[rowOf(state.entities, entityId)] !== ENTITY_STATE.active; i++) step(state, [], 1, p);
    step(state, [], 2, p);
    expect(state.entities.cols.state[rowOf(state.entities, entityId)]).toBe(ENTITY_STATE.active);
    const metals = colony.stock['metals.t1'];

    const out = cancelQueueTask(state, `building:${entityId}`, 0);
    expect(out.ok).toBe(false);
    expect(rowOf(state.entities, entityId)).toBeGreaterThanOrEqual(0);
    expect(colony.stock['metals.t1']).toBe(metals);
  });

  it('cancelling the queue entry in the step its building completed keeps the building and refunds nothing', () => {
    const { state, colony } = colonyPlanet('cancel-race', RICH);
    spawnHqUnit(state, { owner: 0, q: -3, r: 0 });
    const res = enqueueQueueTask(state, { colonyIndex: 0, taskId: 'race', task: { kind: 'build', building: 'solar', q: 3, r: 0 } });
    if (!res.ok) throw new Error(res.code);
    const p = pipeline();
    let entityId = -1;
    for (let i = 0; i < 200; i++) {
      step(state, [], 1, p);
      entityId = getColonyQueue(state, 0, 'construction').find((e) => e.taskId === 'race')?.entityId ?? entityId;
      const row = rowOf(state.entities, entityId);
      if (row >= 0 && state.entities.cols.state[row] === ENTITY_STATE.active) break;
    }
    // the building just completed (slot 6); the queue (slot 4) still lists the entry as in progress
    expect(getColonyQueue(state, 0, 'construction').find((e) => e.taskId === 'race')?.state).toBe('in_progress');
    const metals = colony.stock['metals.t1'];
    cancelQueueTask(state, 'race', 0);
    expect(rowOf(state.entities, entityId)).toBeGreaterThanOrEqual(0);
    expect(colony.stock['metals.t1']).toBe(metals);
  });
});

describe('Units lane: count and repeat (W02-10, W02-24)', () => {
  it('builds `count` Harvesters from one buildUnit entry, then the entry is done', () => {
    const { state } = colonyPlanet('unit-count', RICH);
    addActiveHub(state);
    const res = enqueueQueueTask(state, { colonyIndex: 0, taskId: 'three', task: { kind: 'buildUnit', unit: 'harvester', count: 3 } });
    if (!res.ok) throw new Error(res.code);
    step(state, [], 1, pipeline());
    const p = pipeline();
    for (let i = 0; i < 60; i++) step(state, [], 5, p);
    expect(harvesterCount(state)).toBe(3);
    expect(getColonyQueue(state, 0, 'units')).toHaveLength(0);
  });

  it('stops at the supply cap: the rest of the batch waits on supply', () => {
    const { state, colony } = colonyPlanet('unit-supply', { 'metals.t1': 500, 'minerals.t1': 500, 'bio.biomass': 500 });
    addActiveHub(state);
    const res = enqueueQueueTask(state, { colonyIndex: 0, taskId: 'eleven', task: { kind: 'buildUnit', unit: 'harvester', count: 11 } });
    if (!res.ok) throw new Error(res.code);
    const p = pipeline();
    for (let i = 0; i < 140; i++) {
      for (const k of ['metals.t1', 'minerals.t1', 'bio.biomass'] as const) colony.stock[k] = 400;
      step(state, [], 5, p);
    }
    expect(harvesterCount(state)).toBe(10);
    const entry = getColonyQueue(state, 0, 'units').find((e) => e.taskId === 'eleven');
    expect(entry?.state).toBe('waiting');
    expect(entry?.waitReason).toBe('supply');
  });

  it('a repeat entry refills after each unit', () => {
    const { state } = colonyPlanet('unit-repeat', RICH);
    addActiveHub(state);
    const res = enqueueQueueTask(state, { colonyIndex: 0, taskId: 'rep', task: { kind: 'buildUnit', unit: 'harvester', count: 1, repeat: true } });
    if (!res.ok) throw new Error(res.code);
    const p = pipeline();
    for (let i = 0; i < 25; i++) step(state, [], 5, p);
    expect(harvesterCount(state)).toBeGreaterThanOrEqual(2);
    expect(getColonyQueue(state, 0, 'units').some((e) => e.taskId === 'rep')).toBe(true);
  });
});

describe('queue ETA reads the production ledger', () => {
  it('a Harvester mining metals gives no Minerals ETA', () => {
    const { state } = colonyPlanet('eta', { 'metals.t1': 200, 'minerals.t1': 1, 'bio.biomass': 100, 'bio.water': 100 });
    addActiveHub(state);
    const idx = hexIndex(state.grid.radius);
    setTileDeposit(state, idx.indexOf(5, 0), DEPOSIT.metals, 10000, 0);
    spawnHarvesterUnit(state, { owner: 0, q: 4, r: 1 });
    const p = pipeline();
    for (let i = 0; i < 20; i++) step(state, [], 1, p);
    const res = enqueueQueueTask(state, { colonyIndex: 0, taskId: 'eta', task: { kind: 'build', building: 'solar', q: -4, r: 3 } });
    if (!res.ok) throw new Error(res.code);
    expect(res.entry.waitReason).toBe('resources');
    expect(res.entry.etaSeconds).toBeNull();
    expect(res.entry.waitDetail).toContain('(no ETA)');
  });
});

describe('setHarvestWeights needs the command colony (GP-46 class)', () => {
  it('rejects a planet-level command instead of changing colony 0', () => {
    const { state } = colonyPlanet('weights');
    const out = step(state, [{ commandId: 'w', colonyIndex: null, source: 'player', kind: 'setHarvestWeights', args: { metals: 0 } }], 1, pipeline());
    expect(out.outcomes[0]?.code).toBe('not_own_colony');
    expect((state.colonies[0]?.harvestWeights as { metals?: number } | undefined)?.metals).toBeUndefined();
  });
});

describe('refunds are not production', () => {
  it('refundCost credits stock without counting it as produced', () => {
    const { colony } = colonyPlanet('refund');
    refundCost(colony, { 'metals.t1': 40 }, 0.5, 1);
    expect(colony.stock['metals.t1']).toBe(20);
    expect(colony.production.produced['metals.t1']).toBe(0);
  });
});

describe('a new footprint evacuates a harvesting Harvester', () => {
  it('the Harvester leaves the footprint and does not stay on it', () => {
    const { state } = colonyPlanet('evac', RICH);
    addActiveHub(state);
    const idx = hexIndex(state.grid.radius);
    setTileDeposit(state, idx.indexOf(6, 0), DEPOSIT.minerals, 10000, 0);
    const hId = spawnHarvesterUnit(state, { owner: 0, q: 5, r: 0 });
    spawnHqUnit(state, { owner: 0, q: 3, r: 2 });
    const p = pipeline();
    step(state, [], 5, p);
    const hRow = rowOf(state.entities, hId);
    expect(state.entities.cols.state[hRow]).toBe(ENTITY_STATE.harvesting);
    const res = enqueueQueueTask(state, { colonyIndex: 0, task: { kind: 'build', building: 'solar', q: 4, r: 0 } }); // (4..5, 0..1): the stand tile, not the deposit
    if (!res.ok) throw new Error(res.code);
    for (let i = 0; i < 40; i++) step(state, [], 1, p);
    const fp = getFootprintTileIndices(state, 4, 0, 2, 2, 0);
    const row = rowOf(state.entities, hId);
    expect(fp.indices).not.toContain(idx.indexOf(state.entities.cols.q[row], state.entities.cols.r[row]));
  });
});

describe('buildingCompleted (W02 build path) matches the contract and the W01 shape', () => {
  it('carries colonyIds [colony id string], data.colonyId / playerId, building, kind and tier', () => {
    const { state, colony } = colonyPlanet('bc-event', RICH);
    colony.id = 'col-alpha';
    (colony as { playerId?: string }).playerId = 'pl_1';
    spawnHqUnit(state, { owner: 0, q: -3, r: 0 });
    const res = enqueueQueueTask(state, { colonyIndex: 0, task: { kind: 'build', building: 'solar', q: 3, r: 0 } });
    if (!res.ok) throw new Error(res.code);
    const p = pipeline();
    let ev: { colonyIds: unknown[]; data: unknown } | undefined;
    for (let i = 0; i < 200 && !ev; i++) ev = step(state, [], 1, p).events.find((e) => e.kind === 'buildingCompleted');
    expect(ev?.colonyIds).toEqual(['col-alpha']);
    expect(ev?.data).toMatchObject({ colonyId: 'col-alpha', playerId: 'pl_1', building: 'solar', kind: 'solar', tier: 1 });
    expect(eventDef('buildingCompleted').data.safeParse(ev?.data).success).toBe(true);
  });
});
