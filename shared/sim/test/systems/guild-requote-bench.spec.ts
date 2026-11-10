/**
 * W15-33 `guild-60-planets`: one core re-quotes 60 synthetic planet books.
 * The timed path is `quoteGuild` plus this in-memory plan (the inputs `planQuotes` would pass).
 * It does not start Postgres or 60 hosts. Live-host CPU% is not measured (LED-43).
 *
 * npx vitest run shared/sim/test/systems/guild-requote-bench.spec.ts
 */
import { parseWaves, type ResourceKey } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  compileData,
  guildColonyInput,
  guildPolicy,
  guildQuoteParams,
  marketConfigFromData,
  quoteColony,
  quoteGuild,
  ratio,
  readMinNotionalAtomic,
  type AgentQuotes,
  type CompiledDataLike,
  type GuildQuoteFixture,
} from '../../src';

const PLANETS = 60;
const BUDGET_MS = 1000;
/** The four Tier-1 barter books the maker rests. Cash books stay out: `cashEnabled` is 0. */
const PAIRS: readonly (readonly [ResourceKey, ResourceKey])[] = [
  ['metals.t1', 'minerals.t1'],
  ['minerals.t1', 'bio.water'],
  ['bio.water', 'bio.biomass'],
  ['bio.biomass', 'metals.t1'],
];
const NPCS = ['kestrel', 'vanguard'] as const;

interface BookRow {
  readonly lastNum: bigint;
  readonly volume24h: number;
}

/** One planet's book and the NPC cargo a re-quote would read. Nothing here is a database row. */
interface PlanetBook {
  readonly planetId: string;
  readonly npcId: string;
  readonly stock: Readonly<Partial<Record<ResourceKey, bigint>>>;
  readonly rows: readonly BookRow[];
}

describe('guild-60-planets re-quote bench (W15-33)', () => {
  it('re-quotes 60 books × 4 pairs through quoteGuild in under 1000 ms', () => {
    const data = compileData(parseWaves('..15'));
    marketConfigFromData(data);
    const books = syntheticBooks();
    expect(books).toHaveLength(PLANETS);
    expect(PAIRS).toHaveLength(4);
    expect(new Set(books.map((book) => book.planetId)).size).toBe(PLANETS);
    expect(new Set(books.map((book) => book.npcId))).toEqual(new Set(NPCS));

    const started = performance.now();
    const quotes = requoteBooks(data, books);
    const ms = performance.now() - started;
    console.log(`guild-60-planets re-quote ${ms.toFixed(3)} ms`);

    expect(quotes).toHaveLength(PLANETS * PAIRS.length);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(quotes.every(bothSides)).toBe(true);
    const first = books[0]!;
    expect(quotes[0]).toEqual(libraryQuote(data, fixtureFor(data, first, 0)));
    expect(metalsBid(data, 2501n)).toBeLessThan(metalsBid(data, 2500n));
    const dry = quoteGuild(data, fixtureFor(data, { ...first, stock: { ...first.stock, 'minerals.t1': 0n } }, 0));
    expect(dry.bid).toBeNull();
    expect(dry.bidReasons).toEqual(['no_cash']);
    expect(dry.ask).not.toBeNull();
  });
});

/** 60 planets × 4 pairs × `quoteGuild`. Building the fixture is the in-memory plan; no order is inserted. */
function requoteBooks(data: CompiledDataLike, books: readonly PlanetBook[]): AgentQuotes[] {
  const quotes: AgentQuotes[] = [];
  for (const book of books) {
    for (let pair = 0; pair < PAIRS.length; pair++) quotes.push(quoteGuild(data, fixtureFor(data, book, pair)));
  }
  return quotes;
}

/**
 * Same inputs `planQuotes` passes to `quoteGuild` (`backend/app/src/market/guild/maker/plan.ts`).
 * A last price is fresh; a missing last is not invented. Overview age is not on the row, so age is 0.
 */
function fixtureFor(data: CompiledDataLike, book: PlanetBook, pairIndex: number): GuildQuoteFixture {
  const [base, quote] = PAIRS[pairIndex]!;
  const cfg = marketConfigFromData(data);
  const row = book.rows[pairIndex]!;
  const price = ratio(row.lastNum, 1n);
  const baseStock = book.stock[base] ?? 0n;
  const quoteStock = book.stock[quote] ?? 0n;
  return {
    npcId: book.npcId,
    resource: base,
    quote,
    inventory: baseStock,
    freeUnits: baseStock,
    cash: quoteStock,
    referencePrice: price,
    referenceAgeS: 0,
    eligibleVolume: row.volume24h,
    platformFeeBp: cfg.platformFeeBp,
    maxStallFeeBp: cfg.stallFeeMaxBp,
    transportPerUnit: ratio(0n),
    ownUnitCost: price,
    walkAway: { localUnitCost: price, localMinutesPerUnit: null, minuteValue: null, needValue: null },
    lotUnits: cfg.baseLotUnits,
    minNotionalAtomic: readMinNotionalAtomic(data, quote),
  };
}

/** The quote the W13 library returns for this fixture. The bench must match it, not a stub. */
function libraryQuote(data: CompiledDataLike, fixture: GuildQuoteFixture): AgentQuotes {
  const policy = guildPolicy(data);
  const input = guildColonyInput(policy, fixture);
  return quoteColony(input, guildQuoteParams(policy, input.inventory, input.target));
}

function bothSides(quote: AgentQuotes): boolean {
  return (
    quote.bid !== null &&
    quote.ask !== null &&
    quote.bid.priceAmount > 0n &&
    quote.ask.priceAmount > 0n &&
    quote.bidReasons.length === 0 &&
    quote.askReasons.length === 0
  );
}

/** Metals bid at a chosen inventory. Above the 2500 target the thin half-spread lowers it. */
function metalsBid(data: CompiledDataLike, metals: bigint): bigint {
  const book = bookAt(0);
  const quote = quoteGuild(data, fixtureFor(data, { ...book, stock: { ...book.stock, 'metals.t1': metals } }, 0));
  expect(quote.bid).not.toBeNull();
  return quote.bid!.priceAmount;
}

function syntheticBooks(): PlanetBook[] {
  return Array.from({ length: PLANETS }, (_, i) => bookAt(i));
}

/** Deterministic cargo near the 2500 target and a fresh barter last of 2, so both sides can price. */
function bookAt(index: number): PlanetBook {
  const shift = BigInt((index % 5) - 2);
  const units = 2500n + shift;
  return {
    planetId: `pl_bench_${index}`,
    npcId: NPCS[index % NPCS.length]!,
    stock: { 'metals.t1': units, 'minerals.t1': units, 'bio.water': units, 'bio.biomass': units },
    rows: PAIRS.map(() => ({ lastNum: 2n, volume24h: 100 })),
  };
}
