import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  compileData,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  getColonyStock,
  getConstructionOrders,
  getHubFootprintTiles,
  hexIndex,
  insertRow,
  pathBlockedFor,
  placementWorldFromState,
  PREP,
  rowOf,
  setColonyStock,
  setTilePrep,
  spawnColonyLanding,
  spawnHqUnit,
  type SimHost,
} from '../../src';
import { playerCmd, w01Host } from '../helpers/host';

const CARGO = { 'metals.t1': 600, 'minerals.t1': 350, 'bio.biomass': 200, 'bio.water': 200 };

const send = (host: SimHost, kind: string, args: unknown, colony: number | null = 0) => {
  const c = playerCmd(kind, args, colony, 'co');
  host.submit(c);
  return host.step(1).outcomes.find((o) => o.commandId === c.commandId)!;
};

function prepared(host: SimHost, q: number, r: number): void {
  const idx = hexIndex(host.state.grid.radius);
  for (const t of getHubFootprintTiles(q, r)) setTilePrep(host.state.grid, idx.indexOf(t.q, t.r), PREP.prepared);
}

function rig(): SimHost {
  const host = w01Host({ seed: 'construction-orders', radius: 14 });
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return host;
}

describe('GP-05: only known building kinds', () => {
  it("placeBuilding { building: 'pylon' } is invalid_args and does not block the real Hub", () => {
    const host = rig();
    setColonyStock(host.state, 0, CARGO);
    prepared(host, 4, 0);
    expect(send(host, 'placeBuilding', { building: 'pylon', q: 4, r: 0 })).toMatchObject({ code: 'invalid_args', detail: 'unknown building' });
    expect(getConstructionOrders(host.state, 0)).toEqual([]);
    expect(getColonyStock(host.state, 0)['metals.t1']).toBe(600);
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }).code).toBeUndefined();
  });
});

describe('GP-31: a placement rejection carries its cause', () => {
  it('a Hub on another colony\'s ground is not_own_territory with the ghost\'s text as detail', () => {
    const host = rig();
    const idx = hexIndex(host.state.grid.radius);
    host.state.grid.layers.owner[idx.indexOf(4, 0)] = 1;
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 })).toMatchObject({ code: 'not_own_territory', detail: 'not your territory' });
  });
});

describe('GP-07 / GP-12: order state changes only when it changes', () => {
  it('an order waiting for resources is written once, not every step', () => {
    const host = rig();
    prepared(host, 4, 0);
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }).code).toBeUndefined();
    const [order] = getConstructionOrders(host.state, 0);
    expect(order.status).toBe('waiting_resources');
    expect(order.statusText).toBe('waiting(resources: metals.t1 0/200)');
    const stamped = host.state.blobs.constructionQueue.changedAt;
    host.step(10);
    expect(host.state.blobs.constructionQueue.changedAt).toBe(stamped);
  });

  it('a build paused by a shortage mid-way is waiting_resources (HQ idle) and resumes once stock covers it', () => {
    const host = rig();
    setColonyStock(host.state, 0, CARGO);
    prepared(host, 4, 0);
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }).code).toBeUndefined();
    for (let t = 0; t < 200 && (getConstructionOrders(host.state, 0)[0]?.progress ?? 0) < 0.3; t++) host.step(1);
    setColonyStock(host.state, 0, { ...CARGO, 'metals.t1': 0 });
    host.step(2);
    const [paused] = getConstructionOrders(host.state, 0);
    expect(paused.status).toBe('waiting_resources');
    expect(paused.statusText).toMatch(/^waiting\(resources: metals\.t1 0\/\d+\)$/);
    const hqRow = 0;
    expect(host.state.entities.cols.state[hqRow]).not.toBe(ENTITY_STATE.constructing);
    const progress = paused.progress;
    host.step(5);
    expect(getConstructionOrders(host.state, 0)[0].progress).toBe(progress);
    setColonyStock(host.state, 0, CARGO);
    for (let t = 0; t < 200 && getConstructionOrders(host.state, 0).length > 0; t++) host.step(1);
    expect(getConstructionOrders(host.state, 0)).toEqual([]); // completed and pruned (GP-10)
  });
});

describe('GP-15: an idle planet sends no HQ data', () => {
  it('an idle HQ with a full cell does not re-stamp the hq blob or its colony record', () => {
    const host = rig();
    host.step(2);
    const blobAt = host.state.blobs.hq.changedAt;
    const colAt = host.state.colonies[0].changedAt;
    host.step(10);
    expect(host.state.blobs.hq.changedAt).toBe(blobAt);
    expect(host.state.colonies[0].changedAt).toBe(colAt);
    expect(Object.keys(host.state.blobs.hq.value as object)).toEqual(['byColony']);
  });
});

describe('GP-08: one blob shape per queue', () => {
  it('terraformTasks is { byColony } and constructionQueue is { orders }, written through setBlob', () => {
    const host = rig();
    setColonyStock(host.state, 0, CARGO);
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }).code).toBeUndefined();
    expect(Object.keys(host.state.blobs.terraformTasks)).toEqual(['changedAt', 'value']);
    expect(Object.keys(host.state.blobs.terraformTasks.value as object)).toEqual(['byColony']);
    expect(Object.keys(host.state.blobs.constructionQueue.value as object)).toEqual(['orders']);
  });
});

describe('GP-06: where a Hub may stand relative to the landings', () => {
  it('a Hub must be within hubMaxDistFromLanding of its pod and not closer to another colony\'s pod', () => {
    const host = w01Host({ seed: 'construction-orders', radius: 30 });
    expect(spawnColonyLanding(host.state, { colonyId: 0, q: 0, r: 0 }).ok).toBe(true);
    expect(spawnColonyLanding(host.state, { colonyId: 1, q: 12, r: 0 }).ok).toBe(true);
    const world = placementWorldFromState(host.state);
    const at = (q: number, r: number) => evaluatePlacement(world, { colonyId: 0, q, r, requireBuilder: false });
    expect(at(3, 0).ok).toBe(true);
    expect(at(7, 0)).toMatchObject({ ok: false, block: 'nearOtherColony', code: 'site_blocked' });
    expect(at(-13, 0)).toMatchObject({ ok: false, block: 'farFromLanding', code: 'site_blocked' });
  });
});

describe('GP-23: one "occupies ground" rule', () => {
  it('a destroyed Hub neither blocks placement nor ground movement', () => {
    const host = rig();
    const row = insertRow(host.state.entities, host.state.meta.nextEntityId++, 0);
    const cols = host.state.entities.cols;
    cols.kind[row] = ENTITY_KIND.hub;
    cols.owner[row] = 1;
    cols.q[row] = 5;
    cols.r[row] = 0;
    cols.hpMax[row] = 1500;
    cols.hp[row] = 0;
    const idx = hexIndex(host.state.grid.radius);
    expect(pathBlockedFor(host.state, 'ground')?.(idx.indexOf(5, 0)) ?? false).toBe(false);
    cols.hp[row] = 1500;
    expect(pathBlockedFor(host.state, 'ground')?.(idx.indexOf(5, 0))).toBe(true);
    expect(rowOf(host.state.entities, cols.id[row])).toBe(row);
  });

  it('GP-38: ground movement blocks the tuned Hub footprint, the same tiles placement treats as occupied', () => {
    const host = rig();
    const row = insertRow(host.state.entities, host.state.meta.nextEntityId++, 0);
    const cols = host.state.entities.cols;
    cols.kind[row] = ENTITY_KIND.hub;
    cols.q[row] = 5;
    cols.r[row] = 0;
    cols.hpMax[row] = cols.hp[row] = 1500;
    const idx = hexIndex(host.state.grid.radius);
    const ring2 = idx.indexOf(7, 0); // two tiles from the centre: outside a 3x3 footprint, inside a 5x5 one
    const wide = compileData(parseWaves('..01'), { hub: { t1: { footprint: 5 } } });
    expect(pathBlockedFor(host.state, 'ground', -1, host.pipeline.config.data)?.(ring2)).toBe(false);
    expect(pathBlockedFor(host.state, 'ground', -1, wide)?.(ring2)).toBe(true);
    expect(pathBlockedFor(host.state, 'ground', -1, host.pipeline.config.data)?.(ring2)).toBe(false); // cache keyed by size
  });
});

describe('GP-04: provider priority', () => {
  it('a ready Hub is built before a large manual terraform order is worked', () => {
    const host = rig();
    setColonyStock(host.state, 0, CARGO);
    const tiles = [];
    for (let q = -6; q <= -2; q++) for (let r = 1; r <= 3; r++) tiles.push({ q, r });
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles } }).code).toBeUndefined();
    prepared(host, 4, 0);
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }).code).toBeUndefined();
    for (let t = 0; t < 140 && getConstructionOrders(host.state, 0).length > 0; t++) host.step(1);
    expect(getConstructionOrders(host.state, 0)).toEqual([]); // the Hub is done …
    const idx = hexIndex(host.state.grid.radius);
    const graded = tiles.filter((t) => host.state.grid.layers.prep[idx.indexOf(t.q, t.r)] === PREP.prepared).length;
    expect(graded).toBeLessThan(3); // … while the manual order waited (at most the job under way when the Hub was placed)
  });
});
