import { describe, expect, it } from 'vitest';
import { parseExperimentManifest, parseWaves, type ResourceKey } from '@terra/contracts';
import { loadExperimentScenarios } from '../../../../tests/economy/scenarios';
import {
  MarketHarness, OrderLog, actAgent, agentParamsFromData, compileData, compileProfile, defaultBoardLimits, demandAgentParams, metricsJsonl, observedReference,
  resolveScenarios, runExperiment, type AgentWorld, type DemandAgentParams, type DemandCounters,
} from '../../src';

const FLAGS = parseWaves('..13');
const AGENT = agentParamsFromData(compileData(FLAGS));
const LIMITS = defaultBoardLimits();
const FEES = { platformFeeBp: 100, stallFeeMaxBp: 100 };

/** A bare market harness as the agents' world: inventories are tracked here, trades settle in the harness. */
class HarnessWorld implements AgentWorld {
  tick = 0;
  readonly ticksPerSecond = 5;
  readonly harness = new MarketHarness({
    policyVersion: 'bootstrap-1', platformFeeBp: 100, stallFeeMaxBp: 100, openOrderLimit: 50,
    treasury: { enabled: false, shareBp: 0, accountId: 'acct:treasury' }, ticksPerSecond: 5, tradeIdPrefix: 'dt',
  });
  private readonly inv = new Map<string, bigint>();
  private seq = 0;
  constructor(readonly n: number, holdings: (ci: number) => bigint, readonly resource: ResourceKey) {
    for (let i = 0; i < n; i++) {
      this.inv.set(`${i}|${resource}`, holdings(i));
      this.harness.fund(this.colonyId(i), 'USDC', 10n ** 12n);
    }
  }
  colonyId = (ci: number): string => `c${ci}`;
  inventory = (ci: number, r: ResourceKey): bigint => this.inv.get(`${ci}|${r}`) ?? 0n;
  freeUnits(ci: number, r: ResourceKey): bigint {
    const open = this.harness.openOrders(this.colonyId(ci)).filter((o) => o.base === r && o.side === 'sell').reduce((a, o) => a + (o.amount - o.filled), 0n);
    return this.inventory(ci, r) - open;
  }
  freeQuote = (ci: number): bigint => this.harness.freeQuote(this.colonyId(ci), 'USDC');
  hasOpen = (ci: number, r: ResourceKey, side: 'buy' | 'sell'): boolean => this.harness.openOrders(this.colonyId(ci)).some((o) => o.base === r && o.side === side);
  trades = () => this.harness.trades;
  place(ci: number, side: 'buy' | 'sell', resource: ResourceKey, amount: bigint, priceTotal: bigint, ttlS = 100): void {
    const out = this.harness.handleRequested({
      ref: `r${this.seq++}`, colonyId: this.colonyId(ci), colonyIndex: ci, side, resource, amount: Number(amount), price: { token: 'USDC', amount: priceTotal.toString() }, ttlS, stallFeeBp: 100,
    }, this.tick);
    for (const t of out.trades) {
      const b = Number(t.fill.buyerColonyId.slice(1)), s = Number(t.fill.sellerColonyId.slice(1));
      this.inv.set(`${b}|${resource}`, this.inventory(b, resource) + t.fill.qty);
      this.inv.set(`${s}|${resource}`, this.inventory(s, resource) - t.fill.qty);
    }
  }
  advance(ticks: number): void {
    this.tick += ticks;
    this.harness.expireDue(this.tick);
  }
}

const params = (over: Partial<DemandAgentParams> = {}): DemandAgentParams => ({ ...demandAgentParams(undefined), ttlS: 100, ...over });
const counters = (): DemandCounters => ({ quotes: 0, subsidyQuotes: 0, pausedBids: 0, reasons: {} });

/** Runs `rounds` decision rounds of every colony; returns the VWAP of all trades as quote atomic per unit (test arithmetic only). */
function runMarket(w: HarnessWorld, p: DemandAgentParams, rounds: number, c = counters(), log = new OrderLog()): { vwap: number; units: bigint; log: OrderLog; c: DemandCounters } {
  for (let r = 0; r < rounds; r++) {
    for (let ci = 0; ci < w.n; ci++) actAgent(w, log, ci, w.resource, p, AGENT, FEES, LIMITS, c);
    w.advance(p.actEveryTicks);
  }
  const trades = w.harness.trades;
  const units = trades.reduce((a, t) => a + t.batch.qty, 0n);
  const notional = trades.reduce((a, t) => a + t.batch.notional, 0n);
  return { vwap: units === 0n ? 0 : Number(notional) / Number(units), units, log, c };
}

const region = (resource: ResourceKey, sellers: bigint, buyers: bigint): HarnessWorld => new HarnessWorld(6, (ci) => (ci < 3 ? sellers : buyers), resource);

describe('demand-agents-v1: price discovery follows scarcity, not the absolute price level', () => {
  const scaled = (k: number): Partial<DemandAgentParams> => ({
    bootstrapReferenceAtomic: String(250_000 * k), ownUnitCostAtomic: String(100_000 * k), needValueAtomic: String(600_000 * k), bootstrapBudgetAtomic: String(2_000_000_000 * k),
  });
  const premium = (res: ResourceKey, sellers: bigint, buyers: bigint, k: number): number => {
    const r = runMarket(region(res, sellers, buyers), params(scaled(k)), 40);
    expect(r.units).toBeGreaterThan(0n);
    return r.vwap / (250_000 * k);
  };

  it('a scarce region trades at a higher price relative to its reference than an abundant one', () => {
    const scarce = premium('metals.t1', 400n, 20n, 1);
    const abundant = premium('bio.water', 800n, 200n, 1);
    expect(scarce).toBeGreaterThan(abundant * 1.05);
  });

  it('the relative premium is the same at a 4x absolute price level (scarcity, not level)', () => {
    const lo = premium('metals.t1', 400n, 20n, 1);
    const hi = premium('metals.t1', 400n, 20n, 4);
    expect(Math.abs(lo - hi) / lo).toBeLessThan(0.05);
    const aLo = premium('bio.water', 800n, 200n, 1);
    const aHi = premium('bio.water', 800n, 200n, 4);
    expect(Math.abs(aLo - aHi) / aLo).toBeLessThan(0.05);
  });

  it('quotes stay inside the clamp envelope of the reference', () => {
    const r = runMarket(region('metals.t1', 400n, 20n), params(), 40);
    const spreadUp = Math.sqrt(2) * 1.02 * 1.0001;
    expect(r.vwap).toBeLessThanOrEqual(250_000 * spreadUp);
    expect(r.vwap).toBeGreaterThanOrEqual(250_000 * Math.sqrt(0.5) * 0.98 * 0.9999);
  });
});

describe('demand-agents-v1: bootstrap subsidy and organic reference', () => {
  it('subsidy-priced trades are labelled and never become the reference; the bootstrap expires and bids then pause', () => {
    const w = region('metals.t1', 400n, 20n);
    const p = params({ bootstrapTicks: 1000 });
    const r = runMarket(w, p, 40);
    expect(r.c.subsidyQuotes).toBeGreaterThan(0);
    expect(w.harness.trades.length).toBeGreaterThan(0);
    expect(observedReference(w, r.log, 'metals.t1', p, LIMITS).source).toBe('none'); // tick 2000 > bootstrapTicks, no organic trade
    expect(r.c.reasons['bid:no_reference']).toBeGreaterThan(0);
    const before = r.c.quotes;
    runMarket(w, p, 2, r.c, r.log);
    expect(r.c.quotes - before).toBeLessThanOrEqual(2 * 3); // only asks (cost floor) keep quoting, bids are paused
  });

  it('an organic board reference replaces the bootstrap price: quotes follow the observed VWAP', () => {
    const w = new HarnessWorld(4, () => 250n, 'metals.t1');
    const log = new OrderLog(); // orders placed outside the agents are organic
    for (const [s, b] of [[0, 1], [2, 3], [0, 2], [1, 3]] as const) {
      w.place(s, 'sell', 'metals.t1', 5n, 1_500_000n); // 5 units at 300000
      w.place(b, 'buy', 'metals.t1', 5n, 1_600_000n);
      w.advance(10);
    }
    const p = params({ bootstrapReferenceAtomic: '999999' });
    const ref = observedReference(w, log, 'metals.t1', p, LIMITS);
    expect(ref.source).toBe('board');
    expect(ref.input.price).toEqual({ num: 300_000n, den: 1n });
    expect(ref.input.basis).toBe('organic');
    const c = counters();
    const q = actAgent(w, log, 1, 'metals.t1', p, AGENT, FEES, LIMITS, c);
    expect(q.basis).toBe('organic');
    expect(q.mid).toEqual({ num: 300_000n, den: 1n }); // inventory at target: mid is the observed reference exactly
    expect(c.subsidyQuotes).toBe(0);
    expect(q.bid!.priceAmount).toBeLessThan(q.bid!.amount * 300_000n);
    expect(q.bid!.priceAmount).toBeGreaterThan(q.bid!.amount * 250_000n);
  });

  it('too few counterparties keep the reference withheld (thin market): bootstrap or nothing', () => {
    const w = new HarnessWorld(2, () => 250n, 'metals.t1');
    for (let i = 0; i < 4; i++) { w.place(0, 'sell', 'metals.t1', 5n, 1_500_000n); w.place(1, 'buy', 'metals.t1', 5n, 1_600_000n); w.advance(10); }
    expect(observedReference(w, new OrderLog(), 'metals.t1', params(), LIMITS).source).toBe('bootstrap_subsidy');
    expect(observedReference(w, new OrderLog(), 'metals.t1', params({ bootstrapTicks: 0 }), LIMITS).source).toBe('none');
  });

  it('subsidy budget is bounded: an exhausted bootstrap budget pauses bids with no_cash', () => {
    const w = region('metals.t1', 400n, 20n);
    const c = counters();
    runMarket(w, params({ bootstrapBudgetAtomic: '1' }), 3, c);
    expect(c.reasons['bid:no_cash']).toBeGreaterThan(0);
  });

  it('parameter overrides keep their type; unknown keys are ignored', () => {
    expect(demandAgentParams({ ttlS: 5, nope: 1, targetUnits: 'x' }).ttlS).toBe(5);
    expect(demandAgentParams({ targetUnits: 'x' }).targetUnits).toBe(250);
    expect(demandAgentParams({ boardMinCounterparties: 2 }).boardMinCounterparties).toBe(2);
  });
});

describe('demand-agents-v1 inside the integrated experiment runner', () => {
  const baseline = compileProfile({ parameters: {} }, [...FLAGS.list]);
  const scenarios = loadExperimentScenarios();
  const manifest = () => {
    const parsed = parseExperimentManifest({
      schemaVersion: 1, profile: { id: 'baseline', version: 1, hash: baseline.overridesHash }, engineCommit: 'workspace', waves: '..13',
      scenarios: [{ id: 'baseline-two-colony', version: 1 }], seeds: [101], warmupTicks: 100, measureTicks: 1200, sampleEveryTicks: 400, ticksPerSecond: 5,
      budget: { maxRuns: 2, maxWallSeconds: 120, maxWorkers: 1 }, behaviorProfile: 'demand-agents-v1',
      demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' },
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.value;
  };
  it('runs deterministically, quotes through bot-source commands, reports subsidy quotes and keeps every hard gate', () => {
    const m = manifest();
    const a = runExperiment(m, resolveScenarios(m, scenarios), baseline, {}, {});
    const b = runExperiment(m, resolveScenarios(m, scenarios), baseline, {}, {});
    expect(metricsJsonl(a)).toBe(metricsJsonl(b));
    const run = a.runs[0]!.run;
    expect(run.summary.behavior.notes?.quotes).toBeGreaterThan(0);
    expect(run.summary.behavior.notes?.subsidyQuotes).toBeGreaterThan(0);
    expect(run.summary.placedOrders).toBeGreaterThan(0);
    expect(Object.keys(run.summary.behavior.rejected).filter((k) => k.endsWith('not_authorized'))).toEqual([]);
    expect(a.runs[0]!.gates.filter((g) => g.gateId.startsWith('hard.')).every((g) => g.outcome === 'pass')).toBe(true);
  });
});
