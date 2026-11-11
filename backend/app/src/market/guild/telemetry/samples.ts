import { stockOf } from '../inventory.js';
import { TIER1_RESOURCES } from '../maker/pairs.js';
import type { InventoryCache } from '../guild-plan.js';

/** NEAR §14. Whole units of one resource on one NPC. */
export const GUILD_INVENTORY = 'guild_inventory';
/** Available cash: funding cap − reserved − spent, or the quote budget when no funding row exists yet. */
export const GUILD_CASH = 'guild_cash_atomic';
/** Minus `loss_atomic`. A fill does not post that column. */
export const GUILD_PNL_REALIZED = 'guild_pnl_realized_atomic';
/** Realized PnL with inventory marked at 0. These rows store no price. */
export const GUILD_PNL_CONSERVATIVE = 'guild_pnl_conservative_atomic';
/** Open reservation. `bucket` is `cash` (atomic) or `inventory` (whole units). */
export const GUILD_EXPOSURE = 'guild_exposure_outstanding_atomic';
/** `quote_budget_atomic` of a subsidy allocation. Not reduced by spend. */
export const GUILD_SUBSIDY = 'guild_subsidy_allocation_atomic';
/** 1 when a fresh reference is stored on these rows; 0 when it is not. */
export const GUILD_REFERENCE = 'guild_reference_quality';
/** Maker skips. Process memory: a restart clears it. Gauges above do not. */
export const GUILD_QUOTE_REJECTED = 'guild_quote_rejected_total';

export const QUOTE_REJECT_REASONS = ['funding_cap', 'killed', 'cash_paused', 'inventory_short'] as const;
export type QuoteRejectReason = (typeof QUOTE_REJECT_REASONS)[number];

export interface GuildGaugeSample {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

/** One `chain.guild_npc` row the scrape already parsed. */
export interface NpcMetricSource {
  readonly npcId: string;
  readonly inventory: InventoryCache;
  readonly quoteBudgetAtomic: string;
  readonly spendAtomic: string;
  readonly lossAtomic: string;
  readonly allocationId: string;
  readonly quoteLabel: string;
}

/** One `chain.guild_funding` row. Amounts are decimal strings. `scope` is an npc id or `global`. */
export interface FundingMetricSource {
  readonly scope: string;
  readonly cashCapAtomic: string;
  readonly cashReservedAtomic: string;
  readonly cashSpentAtomic: string;
  readonly inventoryReserved: string;
}

export function isQuoteRejectReason(reason: string): reason is QuoteRejectReason {
  return (QUOTE_REJECT_REASONS as readonly string[]).includes(reason);
}

/** Atomic decimal string to a double. Non-digits and non-finite values are 0. Exact below 2^53. */
export function atomicNumber(raw: string): number {
  if (!/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gauge samples for one scrape (W15-27). `npcs` is the inventory and the subsidy.
 * `funding` is cash on hand and outstanding exposure. An npc id in neither list is absent.
 * Tier-1 cargo with no line is 0, so a sold-out resource stays on the scrape.
 */
export function guildGaugeSamples(
  npcs: readonly NpcMetricSource[],
  funding: readonly FundingMetricSource[] = [],
): GuildGaugeSample[] {
  const books = indexFunding(funding);
  return [
    ...inventorySamples(npcs),
    ...cashSamples(npcs, books, funding),
    ...pnlSamples(npcs),
    ...exposureSamples(npcs, books, funding),
    ...subsidySamples(npcs),
    ...referenceSamples(npcs),
  ];
}

/** The sample for `name` and `labels`, or undefined when that series was not emitted. */
export function gaugeValue(
  samples: readonly GuildGaugeSample[],
  name: string,
  labels: Readonly<Record<string, string>>,
): number | undefined {
  const hit = samples.find((row) => row.name === name && sameLabels(row.labels, labels));
  return hit?.value;
}

function inventorySamples(npcs: readonly NpcMetricSource[]): GuildGaugeSample[] {
  const out: GuildGaugeSample[] = [];
  for (const npc of npcs) {
    const seen = new Set<string>();
    for (const resource of TIER1_RESOURCES) {
      seen.add(resource);
      out.push(sample(GUILD_INVENTORY, { npc: npc.npcId, resource }, stockOf(npc.inventory, resource)));
    }
    for (const line of npc.inventory.lines) {
      if (seen.has(line.resource)) continue;
      const value = stockOf(npc.inventory, line.resource);
      if (value <= 0) continue;
      seen.add(line.resource);
      out.push(sample(GUILD_INVENTORY, { npc: npc.npcId, resource: line.resource }, value));
    }
  }
  return out;
}

function cashSamples(
  npcs: readonly NpcMetricSource[],
  books: ReadonlyMap<string, FundingMetricSource>,
  funding: readonly FundingMetricSource[],
): GuildGaugeSample[] {
  const out: GuildGaugeSample[] = [];
  const seen = new Set<string>();
  for (const npc of npcs) {
    seen.add(npc.npcId);
    const book = books.get(npc.npcId);
    const value = book ? freeCash(book) : atomicNumber(npc.quoteBudgetAtomic);
    out.push(sample(GUILD_CASH, { npc: npc.npcId }, value));
  }
  for (const row of funding) {
    if (seen.has(row.scope)) continue;
    seen.add(row.scope);
    out.push(sample(GUILD_CASH, { npc: row.scope }, freeCash(row)));
  }
  return out;
}

function pnlSamples(npcs: readonly NpcMetricSource[]): GuildGaugeSample[] {
  const out: GuildGaugeSample[] = [];
  for (const npc of npcs) {
    const realized = realizedPnl(npc.lossAtomic);
    out.push(sample(GUILD_PNL_REALIZED, { npc: npc.npcId }, realized));
    out.push(sample(GUILD_PNL_CONSERVATIVE, { npc: npc.npcId }, realized));
  }
  return out;
}

function exposureSamples(
  npcs: readonly NpcMetricSource[],
  books: ReadonlyMap<string, FundingMetricSource>,
  funding: readonly FundingMetricSource[],
): GuildGaugeSample[] {
  const scopes = new Set<string>();
  for (const npc of npcs) scopes.add(npc.npcId);
  for (const row of funding) scopes.add(row.scope);
  const out: GuildGaugeSample[] = [];
  for (const scope of scopes) {
    const book = books.get(scope);
    out.push(sample(GUILD_EXPOSURE, { npc: scope, bucket: 'cash' }, atomicNumber(book?.cashReservedAtomic ?? '0')));
    out.push(sample(GUILD_EXPOSURE, { npc: scope, bucket: 'inventory' }, atomicNumber(book?.inventoryReserved ?? '0')));
  }
  return out;
}

function subsidySamples(npcs: readonly NpcMetricSource[]): GuildGaugeSample[] {
  const out: GuildGaugeSample[] = [];
  for (const npc of npcs) {
    if (npc.quoteLabel !== 'subsidy') continue;
    out.push(sample(GUILD_SUBSIDY, { npc: npc.npcId, allocation: npc.allocationId }, atomicNumber(npc.quoteBudgetAtomic)));
  }
  return out;
}

function referenceSamples(npcs: readonly NpcMetricSource[]): GuildGaugeSample[] {
  return npcs.map((npc) => sample(GUILD_REFERENCE, { npc: npc.npcId }, 0));
}

function indexFunding(funding: readonly FundingMetricSource[]): Map<string, FundingMetricSource> {
  const books = new Map<string, FundingMetricSource>();
  for (const row of funding) books.set(row.scope, row);
  return books;
}

function freeCash(row: FundingMetricSource): number {
  const left = atomicNumber(row.cashCapAtomic) - atomicNumber(row.cashReservedAtomic) - atomicNumber(row.cashSpentAtomic);
  return Number.isFinite(left) && left > 0 ? left : 0;
}

function realizedPnl(lossAtomic: string): number {
  const loss = atomicNumber(lossAtomic);
  return loss === 0 ? 0 : -loss;
}

function sample(name: string, labels: Record<string, string>, value: number): GuildGaugeSample {
  return { name, labels, value };
}

function sameLabels(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(right);
  if (Object.keys(left).length !== keys.length) return false;
  return keys.every((key) => left[key] === right[key]);
}
