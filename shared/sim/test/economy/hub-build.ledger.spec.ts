import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { shareBp, type Ledger } from '@terra/ledger';
import {
  PREP,
  SimHost,
  applyDiff,
  createPlanet,
  getColonyStock,
  getConstructionOrders,
  getHubFootprintTiles,
  hexIndex,
  resolveHubCost,
  resolveStartingCargo,
  restore,
  setTilePrep,
  snapshot,
  type ConstructionOrder,
  type LedgerPosting,
  type PlanetState,
  type SimCommand,
  type StepResult,
} from '../../src';
import { fullStock, hostLedger, nonZero, postAll } from './helpers';

const CARGO = resolveStartingCargo() as Record<string, number>;
const COST = resolveHubCost();

/** A planet host plus the host-side ledger fed from every step's `StepResult.postings`. */
interface Run {
  host: SimHost;
  ledger: Ledger;
  postings: LedgerPosting[];
  /** What `SimHost.onPostings` delivered, for comparison with the step results. */
  heard: LedgerPosting[];
}

const cmd = (commandId: string, kind: string, args: unknown): SimCommand => ({ colonyIndex: 0, source: 'player', commandId, kind, args });

function negate(a: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, -v]));
}

function minus(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) - v;
  return out;
}

function expectNoLedgerInState(state: PlanetState): void {
  expect(Object.keys(state.blobs)).not.toContain('ledger');
  expect(Object.keys(state.blobs)).not.toContain('colonyStock');
}

/** One step; every posting must be accepted by the host ledger, which must then match `col.stock` exactly. */
function stepChecked(run: Run): StepResult {
  const res = run.host.step(1);
  for (const p of res.postings) expect(p.at).toBe(res.stats.tick);
  run.postings.push(...res.postings);
  postAll(run.ledger, res.postings);
  const state = run.host.state;
  expect(run.ledger.verify().ok).toBe(true);
  expect(run.ledger.balances('colony:0')).toEqual(nonZero(getColonyStock(state, 0)));
  for (const v of Object.values(getColonyStock(state, 0))) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
  expectNoLedgerInState(state);
  return res;
}

/** Lands colony 0 at (0,0) through commands (cargo posted in the step), prepares a site at (3,0), orders a Hub. */
function startHubBuild(seed = 'ledger-hub'): Run {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed, radius: 12 }));
  const run: Run = { host, ledger: hostLedger(), postings: [], heard: [] };
  host.onPostings((ps) => run.heard.push(...ps));

  host.submit(cmd('land_spawn', 'system.spawnColony', { q: 0, r: 0 }));
  host.submit(cmd('land_now', 'dev.land', { colonyId: 0 }));
  const landed = stepChecked(run);
  expect(landed.outcomes.map((o) => o.code)).toEqual([undefined, undefined]);
  expect(getColonyStock(host.state, 0)).toEqual(fullStock(CARGO));

  const idx = hexIndex(host.state.grid.radius);
  for (const pos of getHubFootprintTiles(3, 0)) setTilePrep(host.state.grid, idx.indexOf(pos.q, pos.r), PREP.prepared);
  host.submit(cmd('build_hub', 'placeBuilding', { building: 'commandHub', q: 3, r: 0 }));
  expect(stepChecked(run).outcomes[0]?.code).toBeUndefined();
  return run;
}

/** Steps one tick at a time until `done` (bounded), checking the ledger against the stock every tick. */
function stepUntil(run: Run, done: (o: ConstructionOrder | undefined) => boolean, max = 600): void {
  for (let i = 0; i < max && !done(getConstructionOrders(run.host.state, 0)[0]); i++) stepChecked(run);
  expect(done(getConstructionOrders(run.host.state, 0)[0])).toBe(true);
}

describe('Hub T1 build: StepResult.postings feed a host ledger that matches col.stock (integration)', () => {
  it('the landing cargo is one landing.cargo posting from sys:cargo', () => {
    const { postings } = startHubBuild();
    const cargoLegs = Object.keys(CARGO)
      .sort()
      .flatMap((asset) => [
        { account: 'sys:cargo', asset, delta: -CARGO[asset] },
        { account: 'colony:0', asset, delta: CARGO[asset] },
      ]);
    expect(postings[0]).toEqual({ at: 1, reason: 'landing.cargo', actor: 'system:landing', ref: 'colony:0', legs: cargoLegs });
    expect(postings.filter((p) => p.reason === 'landing.cargo')).toHaveLength(1);
  });

  it('a full build leaves exactly cargo − cost in stock, cost in sys:construction and −cargo in sys:cargo', () => {
    const run = startHubBuild();
    stepUntil(run, (o) => o?.status === 'completed');
    const state = run.host.state;
    const order = getConstructionOrders(state, 0)[0];
    expect(order.paidAmounts).toEqual(COST);
    expect(getColonyStock(state, 0)).toEqual(fullStock(minus(CARGO, COST)));
    expect(run.ledger.balances('sys:construction')).toEqual(COST);
    expect(run.ledger.balances('sys:cargo')).toEqual(negate(CARGO));
    expect(run.ledger.trialBalance()).toEqual({});
    expect(run.ledger.entries()).toHaveLength(run.postings.length);

    const spends = run.postings.filter((p) => p.reason === 'construction.spend');
    expect(spends.length).toBeGreaterThan(1);
    const spent: Record<string, number> = {};
    for (const p of spends) {
      expect(p).toMatchObject({ ref: `order:${order.entityId}`, actor: 'colony:0' });
      for (const leg of p.legs) {
        expect(Number.isSafeInteger(leg.delta) && leg.delta !== 0).toBe(true);
        if (leg.account === 'sys:construction') spent[leg.asset] = (spent[leg.asset] ?? 0) + leg.delta;
      }
    }
    expect(spent).toEqual(COST);
    expect(new Set(run.postings.map((p) => p.reason))).toEqual(new Set(['landing.cargo', 'construction.spend']));
    expect(run.heard).toEqual(run.postings);
  });

  it('cancelling mid-build refunds shareBp(paid, 7500) of each resource as one construction.refund posting', () => {
    const run = startHubBuild();
    stepUntil(run, (o) => (o?.progress ?? 0) >= 0.5);
    const order = getConstructionOrders(run.host.state, 0)[0];
    const paid = { ...order.paidAmounts } as Record<string, number>;
    expect(Object.keys(paid).length).toBeGreaterThan(0);
    const refund = Object.fromEntries(Object.entries(paid).map(([k, v]) => [k, shareBp(v, 7500)]));
    expect(run.ledger.balances('sys:construction')).toEqual(paid);

    run.host.submit(cmd('cancel_hub', 'cancelTask', { taskId: order.orderId }));
    const res = stepChecked(run);
    expect(res.outcomes[0]?.code).toBeUndefined();

    const state = run.host.state;
    expect(getConstructionOrders(state, 0)).toHaveLength(0);
    expect(getColonyStock(state, 0)).toEqual(fullStock(minus(CARGO, minus(paid, refund))));
    expect(run.ledger.balances('sys:construction')).toEqual(nonZero(minus(paid, refund)));
    const refunds = res.postings.filter((p) => p.reason === 'construction.refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ ref: `order:${order.entityId}`, actor: 'colony:0', at: run.host.tick });
    const credited = Object.fromEntries(refunds[0].legs.filter((l) => l.account === 'colony:0').map((l) => [l.asset, l.delta]));
    expect(credited).toEqual(nonZero(refund));
  });

  it('snapshot/restore and diff/apply keep col.stock identical and carry no ledger blob', () => {
    const run = startHubBuild();
    const replica = restore(snapshot(run.host.state));
    const from = run.host.tick;
    stepUntil(run, (o) => (o?.progress ?? 0) >= 0.3);
    const state = run.host.state;

    const restored = restore(snapshot(state));
    expect(restored.colonies[0].stock).toEqual(state.colonies[0].stock);
    expectNoLedgerInState(restored);
    applyDiff(replica, run.host.diffSince(from));
    expect(replica.colonies[0].stock).toEqual(state.colonies[0].stock);
    expect(replica.colonies[0].resources).toEqual(state.colonies[0].resources);
    expect(getColonyStock(replica, 0)).toEqual(getColonyStock(state, 0));
    expectNoLedgerInState(replica);
  });

  it('is deterministic: two identical runs produce identical postings', () => {
    const go = (): LedgerPosting[] => {
      const run = startHubBuild('ledger-determinism');
      stepUntil(run, (o) => o?.status === 'completed');
      return run.postings;
    };
    const a = go();
    expect(a.length).toBeGreaterThan(2);
    expect(go()).toEqual(a);
  });
});
