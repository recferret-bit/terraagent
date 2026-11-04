import { describe, expect, it } from 'vitest';
import {
  RouteCache, evaluateLogistics, logisticsCoefficients, ratio, ratioToDecimal,
  type LogisticsBuilding, type LogisticsNode, type LogisticsUnit, type RouteTilesFn,
} from '../../src/economy';

const coefficients = logisticsCoefficients();
const node = (id: string, throughputPerWindow: number, p: Partial<LogisticsNode> = {}): LogisticsNode => ({
  id, domainId: 'colA', tile: { q: 0, r: 0 }, kind: 'supplyDepot', throughputPerWindow, reachTiles: 90, commissioned: true, powered: true, operational: true, ...p,
});
const bld = (id: string, weight: number, consumption: Record<string, number>, p: Partial<LogisticsBuilding> = {}): LogisticsBuilding => ({
  id, domainId: 'colA', tile: { q: 1, r: 0 }, weight, consumption, operatingBp: 10000, ...p,
});
const unit = (id: string, weight: number, p: Partial<LogisticsUnit> = {}): LogisticsUnit => ({
  id, domainId: 'colA', tile: { q: 1, r: 0 }, weight, consumption: { 'metals.t1': weight }, readiness: 'combat', ...p,
});
const near: RouteTilesFn = () => 0;
const run = (o: { buildings?: LogisticsBuilding[]; units?: LogisticsUnit[]; nodes: LogisticsNode[]; routeTiles?: RouteTilesFn }) =>
  evaluateLogistics({ buildings: o.buildings ?? [], units: o.units ?? [], nodes: o.nodes, coefficients, routeTiles: o.routeTiles ?? near });

describe('evaluateLogistics (ECON-LOG-01, W13-52)', () => {
  it('matches the ECONOMY table exactly: K=100, load 100/150/200/300 -> x1.0/1.0625/1.25/2.0, bill 20/31.875/50/120', () => {
    const rows: [number, string, string, string][] = [[100, '1', '20', '20'], [150, '1.0625', '31.875', '31.875'], [200, '1.25', '50', '50'], [300, '2', '120', '120']];
    for (const [load, mult, bill] of rows.map((r) => [r[0], r[1], r[2]] as const)) {
      const d = run({ nodes: [node('n1', 100)], buildings: [bld('b1', load, { 'metals.t1': load / 5 })] }).domains[0]!;
      expect(d.K).toBe(100);
      expect(d.L).toEqual(ratio(BigInt(load)));
      expect(ratioToDecimal(d.M!, 6)).toBe(mult);
      expect(ratioToDecimal(d.supplyCost['metals.t1']!, 6)).toBe(bill);
    }
    const d150 = run({ nodes: [node('n1', 100)], buildings: [bld('b1', 150, { 'metals.t1': 30 })] }).domains[0]!;
    expect(d150.supplyCost['metals.t1']).toEqual(ratio(255n, 8n));
    expect(d150.M).toEqual(ratio(17n, 16n));
  });

  it('caps the multiplier at maxMultiplier', () => {
    const d = run({ nodes: [node('n1', 10)], buildings: [bld('b1', 1000, { 'metals.t1': 1 })] }).domains[0]!;
    expect(d.M).toEqual(ratio(5n, 2n));
  });

  it('route 60 tiles adds 20 percent; the ratio is capped at maxDistanceRatio', () => {
    const at = (tiles: number) => run({ nodes: [node('n1', 100, { reachTiles: 500 })], buildings: [bld('b1', 100, { 'metals.t1': 20 })], routeTiles: () => tiles });
    const e = at(60).domains[0]!.entities[0]!;
    expect(e.distanceFactor).toEqual(ratio(6n, 5n));
    expect(e.supplyCost['metals.t1']).toEqual(ratio(24n));
    expect(at(0).domains[0]!.entities[0]!.distanceFactor).toEqual(ratio(1n));
    expect(at(400).domains[0]!.entities[0]!.distanceFactor).toEqual(ratio(13n, 10n));
  });

  it('K=0 is safe: unavailable with a reason, no division, no invented capacity', () => {
    const none = run({ nodes: [], buildings: [bld('b1', 100, { 'metals.t1': 20 })] }).domains[0]!;
    expect(none.K).toBe(0);
    expect(none.u).toBeNull();
    expect(none.M).toBeNull();
    expect(none.entities[0]!.unavailable).toBe('no_supply_node');
    const zero = run({ nodes: [node('n1', 0)], units: [unit('u1', 10)] }).domains[0]!;
    expect(zero.entities[0]!.unavailable).toBe('no_capacity');
    expect(zero.supplyCost).toEqual({});
  });

  it('unreachable and out-of-reach routes are unavailable, not a cheap surcharge', () => {
    const out = run({ nodes: [node('n1', 100, { reachTiles: 40 })], buildings: [bld('b1', 10, { 'metals.t1': 2 })], routeTiles: () => 41 }).domains[0]!;
    expect(out.entities[0]!.unavailable).toBe('out_of_reach');
    expect(out.unavailable.out_of_reach).toEqual(['b1']);
    expect(out.L).toEqual(ratio(0n));
    const un = run({ nodes: [node('n1', 100)], buildings: [bld('b1', 10, { 'metals.t1': 2 })], routeTiles: () => null }).domains[0]!;
    expect(un.entities[0]!.unavailable).toBe('unreachable');
    expect(un.intendedLoad).toEqual(ratio(10n));
  });

  it('splitting an army into groups or listing a node in two sectors adds no capacity', () => {
    const one = run({ nodes: [node('n1', 100)], units: [unit('u1', 80), unit('u2', 80)] });
    const split = run({
      nodes: [node('n1', 100), node('n1', 100), node('n1', 100)],
      units: [unit('u1', 80, { groupId: 'army-1' }), unit('u2', 80, { groupId: 'army-2' })],
    });
    expect(split.domains[0]!.K).toBe(100);
    expect(split.totals.K).toBe(100);
    expect(split.domains[0]!.M).toEqual(one.domains[0]!.M);
    expect(split.totals.supplyCost).toEqual(one.totals.supplyCost);
  });

  it('an unpowered, uncommissioned or non-operational node contributes nothing', () => {
    const base = [node('n1', 100)];
    for (const bad of [{ powered: false }, { commissioned: false }, { operational: false }]) {
      const d = run({ nodes: [...base, node('n2', 100, bad)], buildings: [bld('b1', 100, { 'metals.t1': 20 })] }).domains[0]!;
      expect(d.K).toBe(100);
    }
    const d = run({ nodes: [node('n2', 100, { powered: false })], buildings: [bld('b1', 100, { 'metals.t1': 20 })] }).domains[0]!;
    expect(d.K).toBe(0);
    expect(d.entities[0]!.unavailable).toBe('no_capacity');
  });

});

describe('evaluateLogistics assignment and domains', () => {
  it('assigns the nearest node, ties by node id, and weighs units by readiness', () => {
    const tiles: Record<string, number> = { a: 10, b: 5, c: 5 };
    const r = run({
      nodes: [node('a', 50), node('c', 50), node('b', 50)],
      units: [unit('u1', 100, { readiness: 'ready' }), unit('u2', 100, { readiness: 'reserve' })],
      routeTiles: (_e, n) => tiles[n.id]!,
    }).domains[0]!;
    expect(r.entities.map((e) => e.id)).toEqual(['u1']);
    expect(r.entities[0]!.nodeId).toBe('b');
    expect(r.L).toEqual(ratio(25n));
  });

  it('domains are independent and totals aggregate them', () => {
    const r = run({
      nodes: [node('n1', 100), node('n2', 50, { domainId: 'colB' })],
      buildings: [bld('b1', 100, { 'metals.t1': 20 }), bld('b2', 50, { 'metals.t1': 10 }, { domainId: 'colB' })],
    });
    expect(r.domains.map((d) => d.domainId)).toEqual(['colA', 'colB']);
    expect(r.totals.K).toBe(150);
    expect(r.totals.supplyCost['metals.t1']).toEqual(ratio(30n));
  });

  it('RouteCache memoises by (node, tile, routeVersion) and invalidates on a new version', () => {
    let calls = 0;
    const cache = new RouteCache(1, () => { calls++; return 7; });
    const e = { id: 'e', tile: { q: 2, r: 3 } };
    const n = node('n1', 10);
    expect([cache.routeTiles(e, n), cache.routeTiles(e, n)]).toEqual([7, 7]);
    expect(calls).toBe(1);
    cache.invalidate(2);
    cache.routeTiles(e, n);
    expect(calls).toBe(2);
  });
});
