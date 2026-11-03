import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  SimHost,
  compileData,
  createPlanet,
  getColonyStock,
  getLandingHistory,
  getLandingPods,
  hexIndex,
  refundCancelledConstruction,
  setColonyStock,
  setTileTerrain,
  spawnColonyLanding,
  spawnHqUnit,
  spendConstructionSlice,
  treasuryCtx,
  TERRAIN,
  type CompiledData,
  type ConstructionOrder,
  type EmitInput,
  type LedgerPosting,
  type SimCommand,
  type SimEvent,
} from '../../src';
import { fullStock } from './helpers';

const FLAGS = parseWaves('..01');
const data = compileData(FLAGS);

/** `data` with one row field replaced, bypassing compile (what a stale or hand-built data set could carry). */
function corrupt(table: string, row: string, field: string, value: unknown): CompiledData {
  const t = data.tables[table];
  return { ...data, tables: { ...data.tables, [table]: { ...t, [row]: { ...t[row], [field]: value } } } } as CompiledData;
}

let seq = 0;
const cmd = (kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand => ({ colonyIndex, source: 'dev', commandId: `gg_${++seq}`, kind, args });

describe('M1: a refused landing cargo lands nothing', () => {
  const badCargo = corrupt('hq', 'startingKit', 'cargo', { ...(data.tables.hq.startingKit.cargo as object), 'metals.t1': 600.5 });

  it('system.spawnColony rejects invalid_args: no pod, no colony, no landing record, no posting', () => {
    const h = new SimHost({ flags: FLAGS, data: badCargo });
    h.load(createPlanet({ type: 'temperate', seed: 'guards', radius: 28 }));
    const c = cmd('system.spawnColony', { colonyId: 'col_0' });
    h.submit(c);
    const res = h.step(1);
    expect(res.outcomes.find((o) => o.commandId === c.commandId)?.code).toBe('invalid_args');
    expect(res.postings).toEqual([]);
    expect(h.state.colonies).toEqual([]);
    expect(getLandingPods(h.state)).toEqual([]);
    expect(getLandingHistory(h.state)).toEqual([]);
    expect(h.state.entities.count).toBe(0);
  });

  it('spawnColonyLanding refuses a negative cargo entry before changing anything', () => {
    const state = createPlanet({ type: 'flat', seed: 'guards', radius: 12 });
    const before = structuredClone(state);
    const neg = corrupt('hq', 'startingKit', 'cargo', { 'metals.t1': -5 });
    expect(spawnColonyLanding(state, { colonyId: 0, data: neg })).toEqual({ ok: false, code: 'invalid_args' });
    expect(state).toEqual(before);
    // The real data lands and credits the cargo.
    expect(spawnColonyLanding(state, { colonyId: 0, data })).toMatchObject({ ok: true });
    expect(getColonyStock(state, 0)['metals.t1']).toBe(600);
  });
});

/** A flat planet with colony 0's HQ at the origin and a rock tile at (-1, 2) queued for Break. */
function breakRig(d: CompiledData = data) {
  const h = new SimHost({ flags: FLAGS, data: d });
  h.load(createPlanet({ type: 'flat', seed: 'guards-tf', radius: 12 }));
  spawnHqUnit(h.state, { owner: 0, q: 0, r: 0 });
  setTileTerrain(h.state.grid, hexIndex(h.state.grid.radius).indexOf(-1, 2), TERRAIN.rock);
  h.submit(cmd('enqueueTask', { terraform: { op: 'break', tiles: [{ q: -1, r: 2 }] } }, 0));
  const run = () => {
    const events: SimEvent[] = [];
    const postings: LedgerPosting[] = [];
    for (let t = 0; t < 40; t++) {
      const res = h.step(1);
      events.push(...res.events);
      postings.push(...res.postings);
    }
    return { events, postings, removed: events.filter((e) => e.kind === 'obstacleRemoved') };
  };
  return { h, run };
}

describe('M2: terraform yields respect the storage caps', () => {
  it('a Break at full metals and minerals (600/600) credits nothing, posts the lost 8 + 4 to sys:overflow and reports it as overflow', () => {
    const { h, run } = breakRig();
    setColonyStock(h.state, 0, { 'metals.t1': 600, 'minerals.t1': 600 });
    const { removed, postings } = run();
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(600);
    expect(getColonyStock(h.state, 0)['minerals.t1']).toBe(600);
    const legs = postings.filter((p) => p.reason === 'terraform.yield').map((p) => p.legs);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toHaveLength(4);
    expect(legs[0]).toEqual(expect.arrayContaining([
      { account: 'sys:world', asset: 'metals.t1', delta: -8 },
      { account: 'sys:overflow', asset: 'metals.t1', delta: 8 },
      { account: 'sys:world', asset: 'minerals.t1', delta: -4 },
      { account: 'sys:overflow', asset: 'minerals.t1', delta: 4 },
    ]));
    expect(removed).toHaveLength(1);
    expect(removed[0].data).toMatchObject({ op: 'break', overflow: { 'metals.t1': 8, 'minerals.t1': 4 } });
    expect(eventDef('obstacleRemoved').data.safeParse(removed[0].data).success).toBe(true);
  });

  it('a partial fit credits up to the cap; the family is shared across tiers', () => {
    const { h, run } = breakRig();
    setColonyStock(h.state, 0, { 'metals.t1': 590, 'metals.t2': 6 });
    const { removed, postings } = run();
    expect(getColonyStock(h.state, 0)).toEqual(fullStock({ 'metals.t1': 594, 'metals.t2': 6, 'minerals.t1': 4 }));
    expect(postings.filter((p) => p.reason === 'terraform.yield')).toHaveLength(1);
    expect(removed[0].data).toMatchObject({ overflow: { 'metals.t1': 4 } });
  });

  it('a yield that fits carries no overflow', () => {
    const { h, run } = breakRig();
    const { removed } = run();
    expect(getColonyStock(h.state, 0)['metals.t1']).toBe(8);
    expect(getColonyStock(h.state, 0)['minerals.t1']).toBe(4);
    expect(removed[0].data).not.toHaveProperty('overflow');
  });

  it('a refused yield (bad data) still clears the tile and emits a treasuryRejected warning', () => {
    const { h, run } = breakRig(corrupt('opsBasic', 'break', 'yields', { 'metals.t1': 10.5 }));
    const { events, removed, postings } = run();
    expect(h.state.grid.layers.terrain[hexIndex(h.state.grid.radius).indexOf(-1, 2)]).toBe(TERRAIN.flat);
    expect(removed).toHaveLength(1);
    expect(postings).toEqual([]);
    const warn = events.filter((e) => e.kind === 'treasuryRejected');
    expect(warn).toMatchObject([{ severity: 'warn', data: { reason: 'terraform.yield', code: 'invalid_amount', resource: 'metals.t1', ref: 'tile:-1,2' } }]);
    expect(eventDef('treasuryRejected').data.safeParse(warn[0].data).success).toBe(true);
  });
});

describe('construction: refused spends and refunds are visible', () => {
  const order = (over: Partial<ConstructionOrder>): ConstructionOrder =>
    ({ orderId: 'o1', colonyId: 0, building: 'commandHub', tier: 1, entityId: 42, q: 0, r: 0, status: 'in_progress', progress: 0.5, buildTimeS: 30, costPaid: true, createdAtTick: 0, ...over }) as ConstructionOrder;
  const sink = () => {
    const events: EmitInput[] = [];
    return { events, ctx: treasuryCtx(3, { record: () => {}, emit: (e) => void events.push(e) }) };
  };

  it('a corrupt cost blocks the build (not "waiting for resources") and warns once', () => {
    const state = createPlanet({ type: 'flat', seed: 'guards-c', radius: 6 });
    setColonyStock(state, 0, { 'metals.t1': 100 });
    const { events, ctx } = sink();
    const o = order({ cost: { 'metals.t1': 10, gold: 10 }, paidAmounts: {} });
    const res = spendConstructionSlice(state, o, 0.5, ctx);
    expect(res).toEqual({ ok: false, waitingReason: 'blocked(invalid_resource)' });
    o.waitingReason = res.waitingReason;
    spendConstructionSlice(state, o, 0.6, ctx);
    expect(events).toMatchObject([{ kind: 'treasuryRejected', data: { reason: 'construction.spend', code: 'invalid_resource', detail: 'gold', ref: 'order:42' } }]);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(100);
    const short = spendConstructionSlice(state, order({ cost: { 'minerals.t1': 10 }, paidAmounts: {} }), 1, ctx);
    expect(short.waitingReason).toBe('waiting(resources: minerals.t1 0/10)');
    expect(events).toHaveLength(1);
  });

  it('a fractional cost is blocked with the resource named', () => {
    const state = createPlanet({ type: 'flat', seed: 'guards-c', radius: 6 });
    setColonyStock(state, 0, { 'metals.t1': 100 });
    const { ctx } = sink();
    const res = spendConstructionSlice(state, order({ cost: { 'metals.t1': 10.5 }, paidAmounts: {} }), 1, ctx);
    expect(res.waitingReason).toBe('blocked(invalid_amount: metals.t1)');
  });

  it('a refused refund returns nothing and warns', () => {
    const state = createPlanet({ type: 'flat', seed: 'guards-c', radius: 6 });
    setColonyStock(state, 0, { 'metals.t1': 1 });
    const { events, ctx } = sink();
    expect(refundCancelledConstruction(state, order({ paidAmounts: { gold: 100 } }), data, ctx)).toEqual({});
    expect(events).toMatchObject([{ kind: 'treasuryRejected', severity: 'warn', data: { reason: 'construction.refund', code: 'invalid_resource' } }]);
    expect(refundCancelledConstruction(state, order({ paidAmounts: { 'metals.t1': 100 } }), data, ctx)).toEqual({ 'metals.t1': 75 });
    expect(getColonyStock(state, 0)['metals.t1']).toBe(76);
  });

  it('refunds are uncapped: they return what was paid', () => {
    const state = createPlanet({ type: 'flat', seed: 'guards-c', radius: 6 });
    setColonyStock(state, 0, { 'metals.t1': 600 });
    refundCancelledConstruction(state, order({ paidAmounts: { 'metals.t1': 200 } }), data, treasuryCtx(1));
    expect(getColonyStock(state, 0)['metals.t1']).toBe(750);
  });
});
