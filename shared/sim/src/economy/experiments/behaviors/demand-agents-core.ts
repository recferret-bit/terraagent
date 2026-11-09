import type { ResourceKey } from '@terra/contracts';
import { ratio } from '../../flows/ratio';
import { boardRow, defaultBoardLimits, type BoardLimits, type BoardTrade } from '../../../systems/trade/market-board';
import { quoteColony, type AgentColonyInput, type AgentParams, type AgentQuotes, type ReferenceInput, type SideQuote } from '../../../systems/trade/agent';
import type { HarnessTrade } from '../market-harness';

/**
 * Core of the scripted demand-based trader `demand-agents-v1` (ECONOMY section 4/6): every experiment bot quotes from the
 * need/value library (`systems/trade/agent`), the OBSERVED board reference (VWAP of organic finalized trades through the
 * same `boardRow` the server uses) and its own need. It never reads a typed-in fair price. The only typed-in price is the
 * explicit, bounded, expiring BOOTSTRAP reference, used when no organic reference exists and labelled `subsidy`: orders
 * placed from it are logged as subsidy and their trades never count as organic (they cannot establish the reference).
 *
 * The core talks to its world through {@link AgentWorld}, so the same code runs against the integrated sim host
 * (`demand-agents-v1.ts`) and against a bare `MarketHarness` in unit tests.
 */
export interface DemandAgentParams {
  readonly actEveryTicks: number;
  readonly ttlS: number;
  /** BOOTSTRAP (subsidy): USDC atomic per unit, used only while no organic reference exists. */
  readonly bootstrapReferenceAtomic: string;
  /** Ticks from the start of the run during which the bootstrap price may be used; after it, bids pause without an organic reference. */
  readonly bootstrapTicks: number;
  /** BOOTSTRAP: USDC budget per colony for subsidy-priced bids (cumulative cap on outstanding + spent). */
  readonly bootstrapBudgetAtomic: string;
  /** Target inventory per colony and resource (units) and what is kept back from sales. */
  readonly targetUnits: number;
  readonly keepUnits: number;
  /** Units exported to orbit at a time when stock is above `keepUnits + exportLot` (sim host only). */
  readonly exportLot: number;
  /** Units a colony plans to consume per decision interval; its desired purchase is what stock + orders do not cover. */
  readonly plannedUnits: number;
  /** Assumed own unit cost (USDC atomic per unit) and last-resort need value; experiment configuration, not game rules. */
  readonly ownUnitCostAtomic: string;
  readonly needValueAtomic: string;
  /** Experiment board limits override (null: the `market.board` data row). */
  readonly boardMinCounterparties: number | null;
}

export const DEMAND_AGENTS_V1_PARAMS: DemandAgentParams = {
  actEveryTicks: 50, ttlS: 900, bootstrapReferenceAtomic: '250000', bootstrapTicks: 6000, bootstrapBudgetAtomic: '2000000000',
  targetUnits: 250, keepUnits: 150, exportLot: 20, plannedUnits: 40, ownUnitCostAtomic: '100000', needValueAtomic: '600000', boardMinCounterparties: null,
};

export function demandAgentParams(overrides: Readonly<Record<string, unknown>> | undefined): DemandAgentParams {
  const merged: Record<string, unknown> = { ...DEMAND_AGENTS_V1_PARAMS };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    const d = (DEMAND_AGENTS_V1_PARAMS as unknown as Record<string, unknown>)[k];
    if (k in DEMAND_AGENTS_V1_PARAMS && (typeof v === typeof d || (d === null && typeof v === 'number'))) merged[k] = v;
  }
  return merged as unknown as DemandAgentParams;
}

/** What the core needs from the world it trades in. All quantities are whole units / USDC atomic. */
export interface AgentWorld {
  readonly tick: number;
  readonly ticksPerSecond: number;
  /** Units the colony holds (stock plus units it already bought and can use). */
  inventory(colonyIndex: number, resource: ResourceKey): bigint;
  /** Units the colony can offer right now (free of open-order reservations). */
  freeUnits(colonyIndex: number, resource: ResourceKey): bigint;
  freeQuote(colonyIndex: number): bigint;
  hasOpen(colonyIndex: number, resource: ResourceKey, side: 'buy' | 'sell'): boolean;
  colonyId(colonyIndex: number): string;
  trades(): readonly HarnessTrade[];
  /** Places the order (a `market.placeOrder` for the total price). */
  place(colonyIndex: number, side: 'buy' | 'sell', resource: ResourceKey, amount: bigint, priceTotal: bigint): void;
}

export type OrderBasis = 'organic' | 'bootstrap_subsidy';

/** Remembers the basis of every order the agents placed, to classify a settled trade as organic or subsidy. */
export class OrderLog {
  private readonly rows = new Map<string, { tick: number; basis: OrderBasis }[]>();
  private readonly spent = new Map<string, bigint>();

  record(colonyId: string, side: 'buy' | 'sell', resource: string, tick: number, basis: OrderBasis, subsidyQuote = 0n): void {
    const k = `${colonyId}|${side}|${resource}`;
    this.rows.set(k, [...(this.rows.get(k) ?? []), { tick, basis }]);
    if (basis === 'bootstrap_subsidy' && subsidyQuote > 0n) this.spent.set(colonyId, (this.spent.get(colonyId) ?? 0n) + subsidyQuote);
  }

  /** Basis of the colony's latest order of that side placed at or before `tick` (organic when unknown: not placed by an agent). */
  basisAt(colonyId: string, side: 'buy' | 'sell', resource: string, tick: number): OrderBasis {
    const rows = this.rows.get(`${colonyId}|${side}|${resource}`) ?? [];
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.tick <= tick) return rows[i]!.basis;
    return 'organic';
  }

  subsidySpent(colonyId: string): bigint {
    return this.spent.get(colonyId) ?? 0n;
  }
}

/** Board trades of one pair; a trade is organic only when neither of its orders was priced from the bootstrap subsidy. */
export function boardTradesOf(world: AgentWorld, log: OrderLog, resource: ResourceKey): BoardTrade[] {
  const pair = `${resource}/USDC`;
  return world.trades().filter((t) => t.batch.base === resource && t.batch.quote === 'USDC').map((t) => ({
    pair, amount: t.batch.qty, notional: t.batch.notional, atMs: Math.floor((t.atTick * 1000) / world.ticksPerSecond),
    organic: log.basisAt(t.fill.buyerColonyId, 'buy', resource, t.atTick) === 'organic' && log.basisAt(t.fill.sellerColonyId, 'sell', resource, t.atTick) === 'organic',
    buyerId: t.fill.buyerColonyId, sellerId: t.fill.sellerColonyId,
  }));
}

export interface ObservedReference { readonly input: ReferenceInput; readonly source: 'board' | 'bootstrap_subsidy' | 'none' }

/**
 * The reference an agent quotes from: the board VWAP when the organic trades pass the board limits, else the labelled
 * bootstrap price while it has not expired, else nothing (bids pause).
 */
export function observedReference(world: AgentWorld, log: OrderLog, resource: ResourceKey, p: DemandAgentParams, limits: BoardLimits): ObservedReference {
  const trades = boardTradesOf(world, log, resource);
  const nowMs = Math.floor((world.tick * 1000) / world.ticksPerSecond);
  const row = boardRow(`${resource}/USDC`, trades, nowMs, limits);
  if (row.vwap) {
    const newest = Math.max(...trades.filter((t) => t.organic).map((t) => t.atMs));
    return { source: 'board', input: { price: ratio(BigInt(row.vwap.num), BigInt(row.vwap.den)), ageS: Math.max(0, Math.floor((nowMs - newest) / 1000)), eligibleVolume: row.eligibleVolume ?? 0, basis: 'organic' } };
  }
  if (world.tick < p.bootstrapTicks && BigInt(p.bootstrapReferenceAtomic) > 0n) {
    return { source: 'bootstrap_subsidy', input: { price: ratio(BigInt(p.bootstrapReferenceAtomic)), ageS: Math.floor(world.tick / world.ticksPerSecond), eligibleVolume: null, basis: 'bootstrap_subsidy' } };
  }
  return { source: 'none', input: { price: null, ageS: null, eligibleVolume: null, basis: 'organic' } };
}

/** The library input of one colony and resource from the world's state and the experiment configuration. */
export function inputFor(world: AgentWorld, ci: number, resource: ResourceKey, ref: ReferenceInput, p: DemandAgentParams, log: OrderLog, platformFeeBp: number, stallFeeMaxBp: number): AgentColonyInput {
  const inv = world.inventory(ci, resource);
  const budget = ref.basis === 'bootstrap_subsidy' ? BigInt(p.bootstrapBudgetAtomic) - log.subsidySpent(world.colonyId(ci)) : null;
  return {
    resource, quote: 'USDC', need: { planned: BigInt(p.plannedUnits), reserve: BigInt(p.targetUnits), available: inv, expectedOwn: 0n },
    inventory: inv, target: BigInt(p.targetUnits), freeUnits: world.freeUnits(ci, resource), keepUnits: BigInt(p.keepUnits), reference: ref,
    walkAway: { localUnitCost: null, localMinutesPerUnit: null, minuteValue: null, needValue: ratio(BigInt(p.needValueAtomic)) },
    ownUnitCost: ratio(BigInt(p.ownUnitCostAtomic)), transportPerUnit: ratio(0n), freeQuote: world.freeQuote(ci), budgetLeft: budget !== null && budget < 0n ? 0n : budget,
    platformFeeBp, maxStallFeeBp: stallFeeMaxBp, lotUnits: 1, minNotionalAtomic: 100_000n,
  };
}

export interface DemandCounters { quotes: number; subsidyQuotes: number; pausedBids: number; reasons: Record<string, number> }

function submit(world: AgentWorld, log: OrderLog, ci: number, resource: ResourceKey, q: SideQuote, basis: OrderBasis, c: DemandCounters): void {
  world.place(ci, q.side, resource, q.amount, q.priceAmount);
  log.record(world.colonyId(ci), q.side, resource, world.tick, basis, q.side === 'buy' ? q.maxSpend : 0n);
  c.quotes++;
  if (basis === 'bootstrap_subsidy') c.subsidyQuotes++;
}

const count = (c: DemandCounters, key: string): void => { c.reasons[key] = (c.reasons[key] ?? 0) + 1; };

/** One decision of one colony for one resource: quote both sides (one open order per side) and place what is not paused. */
export function actAgent(
  world: AgentWorld, log: OrderLog, ci: number, resource: ResourceKey, p: DemandAgentParams, params: AgentParams,
  fees: { platformFeeBp: number; stallFeeMaxBp: number }, limits: BoardLimits, c: DemandCounters,
): AgentQuotes {
  const ref = observedReference(world, log, resource, p, limits);
  const q = quoteColony(inputFor(world, ci, resource, ref.input, p, log, fees.platformFeeBp, fees.stallFeeMaxBp), params);
  const basis: OrderBasis = ref.source === 'bootstrap_subsidy' ? 'bootstrap_subsidy' : 'organic';
  if (q.bid && !world.hasOpen(ci, resource, 'buy')) submit(world, log, ci, resource, q.bid, basis, c);
  else if (!q.bid) { c.pausedBids++; for (const r of q.bidReasons) count(c, `bid:${r}`); }
  if (q.ask && !world.hasOpen(ci, resource, 'sell')) submit(world, log, ci, resource, q.ask, basis === 'bootstrap_subsidy' && q.mid ? 'bootstrap_subsidy' : 'organic', c);
  return q;
}

export { defaultBoardLimits };
