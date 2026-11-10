import { pairId, type QuoteToken, type ResourceKey, type TradeOverviewRow } from '@terra/contracts';
import {
  marketConfigFromData,
  quoteGuild,
  ratio,
  readMinNotionalAtomic,
  type CompiledDataLike,
  type GuildQuoteFixture,
  type SideQuote,
} from '@terra/sim';
import type { FundingBucket } from '../funding/exposure.js';
import type { InventoryCache } from '../guild-plan.js';
import { slotOf } from '../guild-plan.js';
import { stockOf } from '../inventory.js';
import { tier1BarterPairs, type Tier1Resource } from './pairs.js';

export interface MakerNpc {
  readonly npcId: string;
  readonly accountId: string;
  readonly tradeKeyId: string;
  readonly inventory: InventoryCache;
  /** Stored loss counter. Absent on older callers; a missing value does not block a bid. */
  readonly lossAtomic?: string;
}

export interface MakerDock {
  readonly planetId: string;
  readonly departAt: number;
}

/** One side `quoteGuild` actually priced. A paused side never becomes an intent. */
export interface GuildOrderIntent {
  readonly npcId: string;
  readonly planetId: string;
  readonly tradeKeyId: string;
  readonly accountId: string;
  readonly colonyIndex: number;
  readonly departAt: number;
  readonly base: ResourceKey;
  readonly quote: QuoteToken;
  readonly side: 'buy' | 'sell';
  readonly amount: bigint;
  readonly priceAmount: bigint;
  readonly actorKind: 'npc';
  readonly source: 'bot';
  readonly bucket: FundingBucket;
  readonly reserve: bigint;
  readonly stock: bigint;
  readonly pair: string;
  readonly ref: string;
  readonly ttlS: number;
  readonly platformFeeBp: number;
  readonly stallFeeBp: number;
  readonly maxStallFeeBp: number;
  readonly policyVersion: string;
  readonly policyHash: string;
  /** Bumped when this quote is replaced. The curated offer id includes it. Starts at 0. */
  readonly quoteSeq: number;
  /** Overview last, when that pair had one. The allowance band uses it; a missing last stays null. */
  readonly reference: { readonly num: bigint; readonly den: bigint } | null;
}

export interface QuoteContext {
  readonly npc: MakerNpc;
  readonly dock: MakerDock;
  readonly base: ResourceKey;
  readonly quote: QuoteToken;
  readonly baseStock: bigint;
  readonly quoteStock: bigint;
  readonly reference: { readonly num: bigint; readonly den: bigint } | null;
}

/** Whole units of one resource on the NPC's carried cache. Lines are summed; nothing is minted. */
export function cargoUnits(cache: InventoryCache, resource: string): bigint {
  return BigInt(stockOf(cache, resource));
}

/**
 * Stable ref for one visit. Sequence 0 keeps the original ref, so a second place at the same depart time
 * hits the same row. A later sequence is a new row.
 */
export function quoteRef(npcId: string, planetId: string, base: string, side: string, departAt: number, quoteSeq = 0): string {
  const stem = `gqm:${npcId}:${planetId}:${base}:${side}:${departAt}`;
  return quoteSeq > 0 ? `${stem}:${quoteSeq}` : stem;
}

/** Depart time and quote sequence encoded by `quoteRef`. Null when `ref` is not a guild quote. */
export function departOf(ref: string): { departAt: number; quoteSeq: number } | null {
  const parts = ref.split(':');
  if (parts.length < 6 || parts[0] !== 'gqm') return null;
  const departAt = Number(parts[5]);
  const quoteSeq = parts.length > 6 ? Number(parts[6]) : 0;
  if (!Number.isSafeInteger(departAt) || !Number.isInteger(quoteSeq) || quoteSeq < 0) return null;
  return { departAt, quoteSeq };
}

/** Inventory the funding book holds: base units on a sell, quote units (fee-inclusive) on a barter bid. */
export function reserveOf(side: SideQuote): bigint {
  if (side.side === 'sell') return side.amount;
  return side.maxSpend > 0n ? side.maxSpend : side.priceAmount;
}

/**
 * Intents for the sides the library returned. A null bid or ask is absent — this does not fill in a price.
 * Cash bids are not special-cased here: `quoteGuild` already paused them.
 */
export function intentsOf(ctx: QuoteContext, bid: SideQuote | null, ask: SideQuote | null, terms: Terms): GuildOrderIntent[] {
  const out: GuildOrderIntent[] = [];
  if (bid) out.push(intentOf(ctx, bid, terms));
  if (ask) out.push(intentOf(ctx, ask, terms));
  return out;
}

/** Both sides of each Tier-1 barter pair, using one overview (the caller fetched it once). */
export function planQuotes(
  data: CompiledDataLike,
  npc: MakerNpc,
  dock: MakerDock,
  rows: readonly TradeOverviewRow[],
): GuildOrderIntent[] {
  const terms = termsOf(data);
  const out: GuildOrderIntent[] = [];
  for (const pair of tier1BarterPairs()) {
    const row = rows.find((r) => r.pair === pairId(pair.base, pair.quote));
    const built = fixtureFor(data, npc, dock, pair.base, pair.quote, row);
    const quotes = quoteGuild(data, built.fixture);
    out.push(...intentsOf(built.ctx, quotes.bid, quotes.ask, terms));
  }
  return out;
}

/** Order ids of guild rows. A player or bot row is not in the list. */
export function cancelIds(rows: readonly { orderId: string; actorKind?: string | null }[]): string[] {
  return rows.filter((row) => row.actorKind === 'npc' || row.actorKind === 'guild').map((row) => row.orderId);
}

interface Terms {
  readonly ttlS: number;
  readonly platformFeeBp: number;
  readonly stallFeeBp: number;
  readonly maxStallFeeBp: number;
  readonly policyVersion: string;
  readonly policyHash: string;
}

function termsOf(data: CompiledDataLike): Terms {
  const cfg = marketConfigFromData(data);
  return {
    ttlS: cfg.ttlOptionsS[0] ?? 900,
    platformFeeBp: cfg.platformFeeBp,
    stallFeeBp: cfg.stallFeeDefaultBp,
    maxStallFeeBp: cfg.stallFeeMaxBp,
    policyVersion: cfg.policyVersion,
    policyHash: cfg.policyHash,
  };
}

function fixtureFor(
  data: CompiledDataLike,
  npc: MakerNpc,
  dock: MakerDock,
  base: Tier1Resource,
  quote: Tier1Resource,
  row: TradeOverviewRow | undefined,
): { fixture: GuildQuoteFixture; ctx: QuoteContext } {
  const cfg = marketConfigFromData(data);
  const ref = referenceOf(row);
  const baseStock = cargoUnits(npc.inventory, base);
  const quoteStock = cargoUnits(npc.inventory, quote);
  const cost = ref.price;
  const fixture: GuildQuoteFixture = {
    npcId: npc.npcId,
    resource: base,
    quote,
    inventory: baseStock,
    freeUnits: baseStock,
    cash: quoteStock,
    referencePrice: ref.price,
    referenceAgeS: ref.ageS,
    eligibleVolume: ref.eligibleVolume,
    platformFeeBp: cfg.platformFeeBp,
    maxStallFeeBp: cfg.stallFeeMaxBp,
    transportPerUnit: ratio(0n),
    ownUnitCost: cost,
    walkAway: { localUnitCost: cost, localMinutesPerUnit: null, minuteValue: null, needValue: null },
    lotUnits: cfg.baseLotUnits,
    minNotionalAtomic: readMinNotionalAtomic(data, quote),
  };
  return {
    fixture,
    ctx: {
      npc,
      dock,
      base,
      quote,
      baseStock,
      quoteStock,
      reference: ref.price ? { num: ref.price.num, den: ref.price.den } : null,
    },
  };
}

/** The overview has no age. A last price is treated as fresh; a missing last is not replaced. */
function referenceOf(row: TradeOverviewRow | undefined): {
  price: ReturnType<typeof ratio> | null;
  ageS: number | null;
  eligibleVolume: number | null;
} {
  if (!row?.last) return { price: null, ageS: null, eligibleVolume: null };
  return { price: ratio(BigInt(row.last.num), BigInt(row.last.den)), ageS: 0, eligibleVolume: row.volume24h };
}

function intentOf(ctx: QuoteContext, side: SideQuote, terms: Terms): GuildOrderIntent {
  const reserve = reserveOf(side);
  return {
    npcId: ctx.npc.npcId,
    planetId: ctx.dock.planetId,
    tradeKeyId: ctx.npc.tradeKeyId,
    accountId: ctx.npc.accountId,
    colonyIndex: slotOf(ctx.npc.accountId),
    departAt: ctx.dock.departAt,
    base: ctx.base,
    quote: side.token,
    side: side.side,
    amount: side.amount,
    priceAmount: side.priceAmount,
    actorKind: 'npc',
    source: 'bot',
    bucket: 'inventory',
    reserve,
    stock: side.side === 'sell' ? ctx.baseStock : ctx.quoteStock,
    pair: pairId(ctx.base, side.token),
    ref: quoteRef(ctx.npc.npcId, ctx.dock.planetId, ctx.base, side.side, ctx.dock.departAt),
    ttlS: terms.ttlS,
    platformFeeBp: terms.platformFeeBp,
    stallFeeBp: terms.stallFeeBp,
    maxStallFeeBp: terms.maxStallFeeBp,
    policyVersion: terms.policyVersion,
    policyHash: terms.policyHash,
    quoteSeq: 0,
    reference: ctx.reference,
  };
}
