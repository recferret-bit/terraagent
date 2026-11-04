import { RESOURCE_KEYS, type RecipeDef } from '@terra/contracts';
import type { PostingInput } from '@terra/ledger';
import { describe, expect, it } from 'vitest';
import {
  accountFlows,
  checkResourceCoverage,
  consumption,
  creditResource,
  daysOfInventory,
  ensureColonyLedger,
  globalInventory,
  grossConsumption,
  inventoryNext,
  netConsumption,
  observedSupply,
  platformContribution,
  potentialBuy,
  rateMinutesPerUnit,
  ratio,
  ratioEquals,
  ratioToDecimal,
  recipeMinutesPerUnit,
  toMetricRow,
  totalCapped,
  totalProduction,
  unitCost,
} from '../../src';
import { colonyPlanet } from './helpers';

const W = { startTick: 0, endTick: 100 };
const M = 'metals.t1' as const;
const post = (at: number, reason: string, legs: [string, number][], asset: string = M): PostingInput => ({
  at, reason, actor: 'system:test', legs: legs.map(([account, delta]) => ({ account, asset, delta })),
});

describe('flow accounting over a window (hand-calculated)', () => {
  // Window (0, 100]. Colony 0, metals.t1:
  //   +10 production.tick, +3 production.tick credited with 2 more lost to the cap, +8 terraform.yield,
  //   +400 landing.cargo (starter grant), +50 dev.grant (subsidy)
  //   -30 construction.spend, +15 construction.refund (recovered), -4 production.consume (fuel)
  //   cargo.export -20, cargo.import +5
  // production = 10 + 3 + 8 + 400 + 50 = 471, capped = 2, consumption gross = 30 + 4 = 34, net = 34 - 15 = 19
  const postings: PostingInput[] = [
    post(1, 'production.tick', [['sys:world', -10], ['colony:0', 10]]),
    post(2, 'production.tick', [['sys:world', -5], ['colony:0', 3], ['sys:overflow', 2]]),
    post(3, 'terraform.yield', [['sys:world', -8], ['colony:0', 8]]),
    post(4, 'landing.cargo', [['sys:cargo', -400], ['colony:0', 400]]),
    post(5, 'dev.grant', [['sys:dev', -50], ['colony:0', 50]]),
    post(6, 'construction.spend', [['colony:0', -30], ['sys:construction', 30]]),
    post(7, 'construction.refund', [['sys:construction', -15], ['colony:0', 15]]),
    post(8, 'production.consume', [['colony:0', -4], ['sys:world', 4]]),
    post(9, 'cargo.export', [['colony:0', -20], ['sys:cargo', 20]]),
    post(10, 'cargo.import', [['sys:cargo', -5], ['colony:0', 5]]),
    post(0, 'production.tick', [['sys:world', -999], ['colony:0', 999]]), // at the opening boundary: not in (0, 100]
    post(101, 'production.tick', [['sys:world', -999], ['colony:0', 999]]), // after the window
  ];

  it('splits production by source (grants and subsidies apart), capped apart, consumption net of recovered', () => {
    const f = accountFlows(postings, W, 'stock').global[M];
    expect(f.production).toEqual({ production: 13n, terraform: 8n, starter_grant: 400n, subsidy: 50n });
    expect(totalProduction(f)).toBe(471n);
    expect(totalCapped(f)).toBe(2n);
    expect(f.consumption).toEqual({ construction: 30n, production_input: 4n });
    expect(grossConsumption(f)).toBe(34n);
    expect(f.recovered).toBe(15n);
    expect(netConsumption(f)).toBe(19n);
    expect([f.imports, f.exports]).toEqual([5n, 20n]);
  });

  it('inventory_next on the stock basis: 100 + 471 + 5 - 19 - 20 = 537', () => {
    const f = accountFlows(postings, W, 'stock').global[M];
    expect(inventoryNext(100n, f)).toBe(537n);
  });

  it('on the position basis cargo moves are internal: 100 + 471 - 19 = 552 (imports and exports are 0)', () => {
    const r = accountFlows(postings, W, 'position');
    const f = r.global[M];
    expect([f.imports, f.exports, f.cargoInternalIn, f.cargoInternalOut]).toEqual([0n, 0n, 5n, 20n]);
    expect(inventoryNext(100n, f)).toBe(552n);
    expect(r.byColony.get(0)![M].capped.production).toBe(2n); // capped attributed to the credited colony
  });

  it('observedSupply reports potential = produced + capped without folding capped into production', () => {
    const s = observedSupply(accountFlows(postings, W)).find((x) => x.resource === M)!;
    expect(s).toMatchObject({ produced: 471n, capped: 2n, potential: 473n });
  });
});

describe('transfers cancel globally', () => {
  // colony 0 holds 100 and sends 40 to colony 1 (holds 10): colony 0: 100 - 40 = 60; colony 1: 10 + 40 = 50;
  // global: 110 -> 110 (transferIn 40 = transferOut 40).
  const transfer = [post(5, 'admin.correction', [['colony:0', -40], ['colony:1', 40]])];

  it('shows as out/in per colony and nets to zero globally', () => {
    const r = accountFlows(transfer, W);
    expect([r.byColony.get(0)![M].transferOut, r.byColony.get(0)![M].transferIn]).toEqual([40n, 0n]);
    expect([r.byColony.get(1)![M].transferOut, r.byColony.get(1)![M].transferIn]).toEqual([0n, 40n]);
    expect(inventoryNext(100n, r.byColony.get(0)![M])).toBe(60n);
    expect(inventoryNext(10n, r.byColony.get(1)![M])).toBe(50n);
    const g = r.global[M];
    expect(g.transferIn - g.transferOut).toBe(0n);
    expect(inventoryNext(110n, g)).toBe(110n);
    expect(netConsumption(g)).toBe(0n);
    expect(totalProduction(g)).toBe(0n);
  });

  it('the global position counts stock, orbit and in-flight once, reserved as a subset, inactive apart', () => {
    const state = colonyPlanet(3);
    const [a, b, c] = state.colonies.map((x) => ensureColonyLedger(x!));
    creditResource(a!, M, 60, 0);
    creditResource(b!, M, 50.5, 0);
    creditResource(c!, M, 7, 0);
    // colony 0: 60 stock + 20 in orbit (4 reserved by a market order) + 5 in flight; colony 1: 50 stock + 0.5 residual
    a!.cargo = { inOrbit: { [M]: 20 }, pendingMint: { x: { resource: M, amount: 5 } } };
    a!.market = { reservedInOrbit: { [M]: 4 } };
    const g = globalInventory(state.colonies, M, new Set([2]));
    // active = (60 + 20 + 5) + (50 + 0.5) = 135.5 units = 135_500_000 micro; inactive colony 2 = 7 units
    expect(g.activeMicro).toBe(135_500_000n);
    expect(g.inactiveMicro).toBe(7_000_000n);
    expect([g.stock, g.inOrbit, g.inFlight, g.reservedInOrbit]).toEqual([110n, 20n, 5n, 4n]);
  });
});

describe('demand, days of inventory, potential buy', () => {
  it('consumption = 3 * 10 + 2 * 5 - 15 recovered = 25', () => {
    expect(consumption([{ count: 3n, inputPerRun: 10n }, { count: 2n, inputPerRun: 5n }], 15n)).toBe(25n);
    expect(consumption([{ count: 1n, inputPerRun: 5n }], 15n)).toBe(0n);
  });

  it('potential_buy = max(0, 100 + 50 - 120 - 10) = 20, and never negative', () => {
    expect(potentialBuy({ planned: 100n, reserve: 50n, available: 120n, expectedOwn: 10n })).toBe(20n);
    expect(potentialBuy({ planned: 10n, reserve: 0n, available: 120n, expectedOwn: 10n })).toBe(0n);
  });

  it('days = 450 / (300 per 1000 ticks * 500 ticks per day / 1000 = 150 per day) = 3', () => {
    const m = daysOfInventory({ available: 450n, windowConsumption: 300n, window: { startTick: 0, endTick: 1000 }, ticksPerDay: 500n, scope: 'global' });
    expect(ratioEquals(m.value!, ratio(3n))).toBe(true);
    expect(m).toMatchObject({ unit: 'days', scope: 'global', window: { startTick: 0, endTick: 1000 } });
  });

  it('zero consumption is null with no_consumption (not infinity); an empty window is insufficient_data', () => {
    const none = daysOfInventory({ available: 450n, windowConsumption: 0n, window: W, ticksPerDay: 500n, scope: 'colony:0' });
    expect(none.value).toBeNull();
    expect(none.reason).toBe('no_consumption');
    const row = toMetricRow(none, 'days_of_inventory', { resource: M });
    expect(row).toMatchObject({ value: null, reason: 'no_consumption', unit: 'days', scope: 'colony:0' });
    const empty = daysOfInventory({ available: 1n, windowConsumption: 5n, window: { startTick: 7, endTick: 7 }, ticksPerDay: 500n, scope: 'global' });
    expect(empty.reason).toBe('insufficient_data');
  });
});

describe('unit cost and production minutes', () => {
  it('unit_cost = (3 * 5/2 + 2 * 4 + 3/2 + 2 + 1) / 4 = (7.5 + 8 + 1.5 + 2 + 1) / 4 = 20 / 4 = 5', () => {
    const m = unitCost({
      inputs: [{ units: 3n, price: ratio(5n, 2n) }, { units: 2n, price: ratio(4n) }],
      amortization: ratio(3n, 2n), transport: ratio(2n), expectedLosses: ratio(1n), saleableOutput: 4n,
    }, W, 'colony:0');
    expect(ratioEquals(m.value!, ratio(5n))).toBe(true);
    expect(m.unit).toBe('quote_atomic_per_unit');
    expect(toMetricRow(m, 'unit_cost', { resource: M }).value).toBe('5');
  });

  it('an unknown input price is null / uncertain_price; a missing transport term or no output is insufficient_data', () => {
    const base = { amortization: ratio(0n), transport: ratio(0n), expectedLosses: ratio(0n), saleableOutput: 4n };
    expect(unitCost({ ...base, inputs: [{ units: 3n, price: null }] }, W, 'g')).toMatchObject({ value: null, reason: 'uncertain_price' });
    expect(unitCost({ ...base, inputs: [{ units: 0n, price: null }] }, W, 'g').value).not.toBeNull(); // unused input: price irrelevant
    expect(unitCost({ ...base, transport: null, inputs: [] }, W, 'g')).toMatchObject({ value: null, reason: 'insufficient_data' });
    expect(unitCost({ ...base, saleableOutput: 0n, inputs: [] }, W, 'g')).toMatchObject({ value: null, reason: 'insufficient_data' });
  });

  it('recipe minutes per unit: 300 ticks * 200 ms = 60 s = 1 min, 4 units out -> 1/4 min; a fact output is null', () => {
    const recipe = { recipeId: 'r', activityKind: 'a', durationTicks: 300, eligibility: [], inputs: {}, output: { kind: 'resource', resource: M, amount: '4' }, enabledWave: 'W13' } as unknown as RecipeDef;
    expect(ratioEquals(recipeMinutesPerUnit(recipe, 200, W, 'g').value!, ratio(1n, 4n))).toBe(true);
    const fact = { ...recipe, output: { kind: 'fact', factId: 'p' } } as RecipeDef;
    expect(recipeMinutesPerUnit(fact, 200, W, 'g')).toMatchObject({ value: null, reason: 'no_resource_output' });
  });

  it('extractor at 7/8 per second: 1/60 min / (7/8) = 2/105 min per unit', () => {
    expect(ratioEquals(rateMinutesPerUnit(ratio(7n, 8n), W, 'g').value!, ratio(2n, 105n))).toBe(true);
    expect(rateMinutesPerUnit(ratio(0n), W, 'g').reason).toBe('insufficient_data');
  });
});

describe('platform contribution keeps realized and estimated apart', () => {
  // fee 100 bp = 1 %. realized: 1_000_000 * 1 % = 10_000 - (2_000 + 1_000 + 500 + 500) = 6_000
  // estimated: 500_000 * 1 % = 5_000 - (400 + 300 + 200 + 100) = 4_000; combined 10_000
  it('matches the hand calculation', () => {
    const c = platformContribution({
      eligibleQuoteVolume: { realized: 1_000_000n, estimated: 500_000n }, platformFeeBp: 100,
      treasuryAllocations: { realized: 2_000n, estimated: 400n }, executionCosts: { realized: 1_000n, estimated: 300n },
      subsidies: { realized: 500n, estimated: 200n }, attributedOperatingCosts: { realized: 500n, estimated: 100n },
    });
    expect(ratioEquals(c.realized, ratio(6_000n))).toBe(true);
    expect(ratioEquals(c.estimated, ratio(4_000n))).toBe(true);
    expect(ratioEquals(c.combined, ratio(10_000n))).toBe(true);
  });
});

describe('exact decimals and coverage', () => {
  it('formats rationals with half-away-from-zero rounding', () => {
    expect(ratioToDecimal(ratio(7n, 2n))).toBe('3.5');
    expect(ratioToDecimal(ratio(1n, 3n))).toBe('0.333333');
    expect(ratioToDecimal(ratio(2n, 3n), 2)).toBe('0.67');
    expect(ratioToDecimal(ratio(-5n, 2n), 0)).toBe('-3');
    expect(ratioToDecimal(ratio(0n))).toBe('0');
  });

  it('reports missing_resource_coverage per resource and per empty role (reusing checkProfileContent)', () => {
    const policies = RESOURCE_KEYS.filter((k) => k !== 'bio.t3').map((resource) => ({
      resource, sources: ['s'], consumers: ['c'], producerCohorts: ['p'], buyerCohorts: ['b'], reserveHorizonTicks: 0, targetBand: { loBp: 0, hiBp: 1 },
    }));
    policies[0] = { ...policies[0]!, consumers: [], buyerCohorts: [] };
    const errs = checkResourceCoverage({ resourcePolicies: policies, recipes: [], marketPolicies: [] });
    expect(errs.map((e) => e.code)).toEqual(['missing_resource_coverage', 'missing_resource_coverage']);
    expect(errs[0]).toMatchObject({ path: `resourcePolicies.${policies[0]!.resource}`, details: { missing: ['consumers', 'buyerCohorts'] } });
    expect(errs[1]).toMatchObject({ path: 'resourcePolicies.bio.t3', details: { resource: 'bio.t3' } });
    expect(checkResourceCoverage({ resourcePolicies: [...policies.slice(1), ...[policies[0]!].map((p) => ({ ...p, consumers: ['c'], buyerCohorts: ['b'] })), { ...policies[1]!, resource: 'bio.t3' as const }], recipes: [], marketPolicies: [] })).toEqual([]);
  });
});
