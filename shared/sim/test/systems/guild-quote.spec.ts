import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { maxBuyerSpend } from '../../src/systems/trade/market-fees';
import {
  boardRow, compileData, guildAgentParams, guildColonyInput, guildPolicy, guildQuoteParams, quoteColony, quoteGuild, ratio, scarcityRatio,
  type BoardTrade, type GuildQuoteFixture,
} from '../../src';

const on = parseWaves('..15');
const cashOn = () => compileData(on, { guild: { policy: { cashEnabled: 1 } } });
const PRICE = ratio(400_000n);
const PAIR = 'metals.t1/USDC';
const NOW = 100 * 3_600_000;

const fix = (over: Partial<GuildQuoteFixture> = {}): GuildQuoteFixture => ({
  resource: 'metals.t1', quote: 'USDC', inventory: 2500n, cash: 10n ** 18n, referencePrice: PRICE, referenceAgeS: 60, eligibleVolume: 100,
  platformFeeBp: 100, maxStallFeeBp: 100, transportPerUnit: ratio(1_000n), ownUnitCost: ratio(300_000n),
  walkAway: { localUnitCost: ratio(10n ** 12n), localMinutesPerUnit: null, minuteValue: null, needValue: null }, ...over,
});

const unit = (price: bigint, amount: bigint): bigint => price / amount;

describe('W15-06 guild quotes through quoteColony', () => {
  it('positive: a healthy reference and inventory quote a bid and an ask inside the clamp', () => {
    const data = cashOn();
    const policy = guildPolicy(data);
    const fixture = fix();
    const input = guildColonyInput(policy, fixture);
    const params = guildQuoteParams(policy, fixture.inventory, input.target);
    const q = quoteGuild(data, fixture);
    const lib = quoteColony(input, params);
    expect(q).toEqual(lib);
    expect(params).toEqual(guildAgentParams(data));
    expect(q.bid).not.toBeNull();
    expect(q.ask).not.toBeNull();
    const low = (PRICE.num * BigInt(params.clampLowBp)) / 10_000n;
    const high = (PRICE.num * BigInt(params.clampHighBp)) / 10_000n;
    expect(unit(q.bid!.priceAmount, q.bid!.amount)).toBeGreaterThanOrEqual(low);
    expect(unit(q.ask!.priceAmount, q.ask!.amount)).toBeLessThanOrEqual(high);
    expect(q.bid!.maxSpend).toBe(maxBuyerSpend(q.bid!.priceAmount, 100, 100) + q.bid!.amount * 1_000n);
    const scarce = scarcityRatio(input.target, 1n, params);
    const heavy = scarcityRatio(input.target, 10n ** 12n, params);
    expect(scarce).toEqual(ratio(BigInt(params.clampHighBp), 10_000n));
    expect(heavy).toEqual(ratio(BigInt(params.clampLowBp), 10_000n));
    const atRail = quoteGuild(data, fix({ inventory: 1n }));
    expect(atRail.bid).not.toBeNull();
    expect(atRail.ask).not.toBeNull();
    expect(atRail.mid).toEqual(quoteColony(guildColonyInput(policy, fix({ inventory: 1n })), guildQuoteParams(policy, 1n, input.target)).mid);
  });
});

describe('W15-06 guild quotes: reference pause, cash and non-organic fills', () => {
  it('negative: a stale or thin reference pauses the bid, and a guild fill does not become the reference', () => {
    const data = cashOn();
    const stale = quoteGuild(data, fix({ referenceAgeS: 3601 }));
    const fresh = quoteGuild(data, fix({ referenceAgeS: 3600 }));
    const thin = quoteGuild(data, fix({ eligibleVolume: 9 }));
    const enough = quoteGuild(data, fix({ eligibleVolume: 10 }));
    expect(fresh.bid).not.toBeNull();
    expect(enough.bid).not.toBeNull();
    expect(stale.bid).toBeNull();
    expect(stale.bidReasons).toEqual(['stale_reference']);
    expect(thin.bid).toBeNull();
    expect(thin.bidReasons).toEqual(['thin_reference']);
    expect(stale.ask).toEqual(quoteColony(guildColonyInput(guildPolicy(data), fix({ referenceAgeS: 3601 })), guildAgentParams(data)).ask);
    const off = compileData(on);
    const staleOff = fix({ referenceAgeS: 3601 });
    const paused = quoteGuild(off, staleOff);
    expect(paused.bidReasons).toEqual(quoteColony(guildColonyInput(guildPolicy(off), staleOff), guildAgentParams(off)).bidReasons);
    expect(paused.bidReasons).toEqual(['stale_reference']);
    const guildBook = nonOrganicBook();
    const row = boardRow(PAIR, guildBook, NOW);
    expect(row.vwap).toBeNull();
    expect(row.classification).toBe('fixture');
    const missing = fix({ referencePrice: null, referenceAgeS: null, eligibleVolume: row.eligibleVolume });
    const fromBoard = quoteGuild(data, missing);
    const missingLib = quoteColony(guildColonyInput(guildPolicy(data), missing), guildAgentParams(data));
    expect(fromBoard.bid).toBeNull();
    expect(fromBoard.mid).toBeNull();
    expect(fromBoard.bidReasons).toEqual(missingLib.bidReasons);
    expect(fromBoard.bidReasons).toEqual(['no_reference', 'no_reference']);
    const organic = organicBook();
    const mixed = boardRow(PAIR, [...organic, ...guildBook], NOW);
    expect(mixed.vwap).toEqual(boardRow(PAIR, organic, NOW).vwap);
    expect(mixed.classification).toBe('mixed');
  });

  it('corner: inventory at the target does not widen; one unit below widens the ask only', () => {
    const data = cashOn();
    const policy = guildPolicy(data);
    const target = BigInt(policy.roster[0]!.targets['metals.t1']!);
    expect(policy.thinHalfSpreadBp).toBeGreaterThan(policy.params.askHalfSpreadBp);
    const atFix = fix({ inventory: target });
    const at = quoteGuild(data, atFix);
    const atInput = guildColonyInput(policy, atFix);
    expect(guildQuoteParams(policy, target, target)).toEqual(policy.params);
    expect(at).toEqual(quoteColony(atInput, policy.params));
    const belowFix = fix({ inventory: target - 1n });
    const belowInput = guildColonyInput(policy, belowFix);
    const wide = guildQuoteParams(policy, target - 1n, target);
    const below = quoteGuild(data, belowFix);
    expect(wide.askHalfSpreadBp).toBe(policy.thinHalfSpreadBp);
    expect(wide.bidHalfSpreadBp).toBe(policy.params.bidHalfSpreadBp);
    expect(below).toEqual(quoteColony(belowInput, wide));
    expect(below.ask!.priceAmount).toBeGreaterThan(quoteColony(belowInput, policy.params).ask!.priceAmount);
    expect(below.bid!.priceAmount).toBe(quoteColony(belowInput, policy.params).bid!.priceAmount);
    const aboveFix = fix({ inventory: target + 1n });
    const aboveParams = guildQuoteParams(policy, target + 1n, target);
    expect(aboveParams.bidHalfSpreadBp).toBe(policy.thinHalfSpreadBp);
    expect(aboveParams.askHalfSpreadBp).toBe(policy.params.askHalfSpreadBp);
    expect(quoteGuild(data, aboveFix).bid!.priceAmount).toBeLessThan(quoteColony(guildColonyInput(policy, aboveFix), policy.params).bid!.priceAmount);
  });

  it('corner: cash 0 pauses a USDC or NEAR bid; barter still quotes; the fee-inclusive max matches the library', () => {
    const data = cashOn();
    const policy = guildPolicy(data);
    const zero = fix({ cash: 0n });
    const zeroQ = quoteGuild(data, zero);
    const zeroLib = quoteColony(guildColonyInput(policy, zero), guildQuoteParams(policy, zero.inventory, guildColonyInput(policy, zero).target));
    expect(zeroQ.bidReasons).toEqual(zeroLib.bidReasons);
    expect(zeroQ.bidReasons).toEqual(['no_cash']);
    const off = compileData(on);
    expect(guildPolicy(off).cashEnabled).toBe(0);
    const usdc = quoteGuild(off, fix());
    const near = quoteGuild(off, fix({ quote: 'NEAR' }));
    expect(usdc.bidReasons).toEqual(['no_cash']);
    expect(near.bidReasons).toEqual(['no_cash']);
    expect(usdc.ask).not.toBeNull();
    const barter = quoteGuild(off, fix({ quote: 'minerals.t1', cash: 10n ** 12n }));
    expect(barter.bid).not.toBeNull();
    expect(barter.ask).not.toBeNull();
    expect(barter.bidReasons).toEqual([]);
    const full = quoteGuild(data, fix());
    const exact = fix({ cash: full.bid!.maxSpend });
    const input = guildColonyInput(policy, exact);
    const lib = quoteColony(input, guildQuoteParams(policy, exact.inventory, input.target));
    const q = quoteGuild(data, exact);
    expect(q).toEqual(lib);
    expect(q.bidReasons).toEqual(lib.bidReasons);
    expect(q.bidReasons).toEqual([]);
    expect(q.bid!.maxSpend).toBe(exact.cash);
  });
});

function fill(over: Partial<BoardTrade> & { price?: bigint }, n: number): BoardTrade {
  const price = over.price ?? 400_000n;
  const amount = over.amount ?? 10n;
  return {
    pair: over.pair ?? PAIR, amount, notional: amount * price, atMs: over.atMs ?? NOW - 1000 * (n + 1),
    organic: over.organic ?? true, buyerId: over.buyerId ?? `b${n % 4}`, sellerId: over.sellerId ?? `s${n % 4}`,
  };
}

/** Organic player fills that clear the board's trade, volume and counterparty limits. */
function organicBook(): BoardTrade[] {
  return Array.from({ length: 6 }, (_, n) => fill({}, n));
}

/** Guild, fixture, subsidy and same-owner fills. W13-62 `isOrganicFill` already records these `organic: false`. */
function nonOrganicBook(): BoardTrade[] {
  const sides: ReadonlyArray<readonly [string, string]> = [
    ['guild-1.npc.terraagent.mock', 'player-a'],
    ['fixture.bot', 'player-b'],
    ['subsidy.bot', 'player-c'],
    ['colony-own', 'colony-own-b'],
  ];
  return sides.flatMap(([buyerId, sellerId], i) => Array.from({ length: 4 }, (_, n) => fill({
    organic: false, price: 9_000_000n, amount: 40n, buyerId, sellerId, atMs: NOW - 1000 * (i * 4 + n + 1),
  }, n)));
}
