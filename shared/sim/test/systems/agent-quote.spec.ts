import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { maxBuyerSpend } from '../../src/systems/trade/market-fees';
import {
  WAD, agentParamsFromData, askTotal, bidTotal, compileData, desiredBuyQty, integerRoot, midPrice, minAskUnitPrice, parseAgentParams, powRatioWad,
  principalForSpend, quoteColony, ratio, referenceReasons, scarcityRatio, sellableQty, targetFromBand, toPlaceOrderArgs, validRatio, walkAwayUnitPrice, wholeLots,
  type AgentColonyInput, type AgentParams,
} from '../../src';

const P: AgentParams = agentParamsFromData(compileData(parseWaves('..13')));
const base = (over: Partial<AgentColonyInput> = {}): AgentColonyInput => ({
  resource: 'bio.water', quote: 'USDC', need: { planned: 100n, reserve: 0n, available: 0n, expectedOwn: 0n }, inventory: 500n, target: 500n,
  freeUnits: 800n, keepUnits: 500n, reference: { price: ratio(400_000n), ageS: 60, eligibleVolume: 100, basis: 'organic' },
  walkAway: { localUnitCost: ratio(1_000_000n), localMinutesPerUnit: null, minuteValue: null, needValue: null }, ownUnitCost: ratio(300_000n),
  transportPerUnit: ratio(0n), freeQuote: 10n ** 12n, budgetLeft: null, platformFeeBp: 100, maxStallFeeBp: 100, lotUnits: 1, minNotionalAtomic: 100_000n, ...over,
});

describe('fixed-point exponentiation (the one shared implementation)', () => {
  it('integerRoot is the exact floor root', () => {
    expect(integerRoot(1000n, 3)).toBe(10n);
    expect(integerRoot(999n, 3)).toBe(9n);
    expect(integerRoot(0n, 2)).toBe(0n);
    expect(integerRoot(1n, 5)).toBe(1n);
    expect(integerRoot(10n ** 60n, 2)).toBe(10n ** 30n);
    expect(integerRoot(10n ** 60n - 1n, 2)).toBe(10n ** 30n - 1n);
    expect(integerRoot(12345n, 1)).toBe(12345n);
    expect(() => integerRoot(-1n, 2)).toThrow(RangeError);
    expect(() => integerRoot(4n, 0)).toThrow(RangeError);
  });
  it('powRatioWad: exact cases, k = 0, and rejection of bad input', () => {
    expect(powRatioWad(4n, 1n, 1, 2)).toBe(2n * WAD);
    expect(powRatioWad(1n, 4n, 1, 2)).toBe(WAD / 2n);
    expect(powRatioWad(8n, 1n, 2, 3)).toBe(4n * WAD);
    expect(powRatioWad(7n, 3n, 0, 5)).toBe(WAD);
    expect(powRatioWad(3n, 3n, 7, 4)).toBe(WAD);
    expect(powRatioWad(2n, 1n, 1, 2)).toBe(1_414_213_562_373_095_048n);
    for (const bad of [powRatioWad(0n, 1n, 1, 2), powRatioWad(1n, 0n, 1, 2), powRatioWad(-1n, 1n, 1, 2), powRatioWad(1n, 1n, -1, 2), powRatioWad(1n, 1n, 1, 0), powRatioWad(1n, 1n, 1.5, 2)]) expect(bad).toBeNull();
  });
  it('is monotone in the base and deterministic', () => {
    let prev = 0n;
    for (let n = 1n; n <= 40n; n++) {
      const z = powRatioWad(n, 10n, 3, 4)!;
      expect(z).toBeGreaterThan(prev);
      expect(powRatioWad(n, 10n, 3, 4)).toBe(z);
      prev = z;
    }
  });
});

describe('parameters', () => {
  it('come from the compiled market.agent row', () => {
    expect(P).toMatchObject({ scarcityExponentNum: 1, scarcityExponentDen: 2, clampLowBp: 5000, clampHighBp: 20000, maxOrderQuoteAtomic: 1_000_000_000n });
  });
  it('a missing or malformed row is an error, never a default', () => {
    expect(() => parseAgentParams(undefined)).toThrow(/missing/);
    expect(() => agentParamsFromData({ hash: 'x', tables: {} })).toThrow(/missing/);
    const row = { scarcityExponentNum: 1, scarcityExponentDen: 2, epsilonUnits: 10, clampLowBp: 5000, clampHighBp: 20000, bidHalfSpreadBp: 200, askHalfSpreadBp: 200, minSavingBp: 200,
      reserveMarginBp: 500, maxOrderUnits: 100, maxOrderQuoteAtomic: '1000', referenceMaxAgeS: 3600, minReferenceVolume: 10 };
    expect(parseAgentParams(row).maxOrderQuoteAtomic).toBe(1000n);
    for (const bad of [{ epsilonUnits: 0 }, { scarcityExponentDen: 0 }, { clampLowBp: 30000 }, { clampLowBp: 0 }, { bidHalfSpreadBp: 10000 }, { maxOrderUnits: 0 },
      { maxOrderQuoteAtomic: '0' }, { maxOrderQuoteAtomic: '1.5' }, { maxOrderQuoteAtomic: 5 }, { askHalfSpreadBp: -1 }, { referenceMaxAgeS: 1.5 }, { minSavingBp: '1' }]) {
      expect(() => parseAgentParams({ ...row, ...bad }), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
});

describe('need', () => {
  it('desired buy quantity is potentialBuy (never negative); surplus is above the keep level', () => {
    expect(desiredBuyQty({ planned: 100n, reserve: 20n, available: 50n, expectedOwn: 10n })).toBe(60n);
    expect(desiredBuyQty({ planned: 10n, reserve: 0n, available: 50n, expectedOwn: 0n })).toBe(0n);
    expect(desiredBuyQty({ planned: 10n ** 40n, reserve: 0n, available: 0n, expectedOwn: 0n })).toBe(10n ** 40n);
    expect(sellableQty(800n, 500n)).toBe(300n);
    expect(sellableQty(400n, 500n)).toBe(0n);
    expect(sellableQty(400n, -5n)).toBe(400n);
  });
  it('target from band and whole lots', () => {
    expect(targetFromBand(1000n, 1000, 8000)).toBe(450n);
    expect(targetFromBand(0n, 1000, 8000)).toBe(0n);
    expect(targetFromBand(1000n, 8000, 1000)).toBe(0n);
    expect(wholeLots(47n, 10)).toBe(40n);
    expect(wholeLots(9n, 10)).toBe(0n);
    expect(wholeLots(-4n, 1)).toBe(0n);
    expect(wholeLots(5n, 0)).toBe(5n);
  });
});

describe('value: walk-away bid and ask floor', () => {
  const w = (o: Partial<AgentColonyInput['walkAway']>) => ({ localUnitCost: null, localMinutesPerUnit: null, minuteValue: null, needValue: null, ...o });
  it('walk-away is the cheapest known alternative less the required saving', () => {
    expect(walkAwayUnitPrice(w({ localUnitCost: ratio(1000n) }), P).value).toEqual(ratio(980n));
    const both = walkAwayUnitPrice(w({ localUnitCost: ratio(1000n), localMinutesPerUnit: ratio(1n, 2n), minuteValue: ratio(1000n) }), P); // minutes cost 500
    expect(both.value).toEqual(ratio(490n));
    expect(walkAwayUnitPrice(w({ needValue: ratio(700n) }), P).value).toEqual(ratio(686n));
    expect(walkAwayUnitPrice(w({ localUnitCost: ratio(1000n), needValue: ratio(10n) }), P).value).toEqual(ratio(980n)); // need value is a last resort
  });
  it('unknown value is null with a reason, never a default; minutes without a minute value do not count', () => {
    expect(walkAwayUnitPrice(w({}), P)).toEqual({ value: null, reasons: ['no_walkaway_value'] });
    expect(walkAwayUnitPrice(w({ localMinutesPerUnit: ratio(1n) }), P).reasons).toEqual(['no_walkaway_value']);
    expect(walkAwayUnitPrice(w({ localUnitCost: { num: 5n, den: 0n } }), P).reasons).toEqual(['zero_denominator']);
  });
  it('min ask = own cost + reserve margin + transport; unmeasured terms pause', () => {
    expect(minAskUnitPrice(ratio(1000n), ratio(10n), P).value).toEqual(ratio(1060n)); // 1000 * 1.05 + 10
    expect(minAskUnitPrice(null, ratio(0n), P).reasons).toEqual(['no_unit_cost']);
    expect(minAskUnitPrice(ratio(1n), null, P).reasons).toEqual(['transport_unknown']);
    expect(minAskUnitPrice(ratio(1n), { num: 1n, den: 0n }, P).reasons).toEqual(['zero_denominator']);
    expect(validRatio({ num: 1n, den: 0n })).toBe(false);
  });
});

describe('quote function: mid = reference * clamp((target+eps)/(inventory+eps))^k', () => {
  const ref = ratio(400_000n);
  it('inventory at target: mid is the reference exactly; scarcity raises it, abundance lowers it', () => {
    const at = midPrice(ref, 500n, 500n, P);
    expect('mid' in at && at.mid).toEqual(ref);
    const scarce = midPrice(ref, 500n, 100n, P);
    const abundant = midPrice(ref, 500n, 5000n, P);
    if (!('mid' in scarce) || !('mid' in abundant)) throw new Error('mid expected');
    expect(scarce.mid.num * 1n).toBeGreaterThan(0n);
    expect(scarce.factorWad).toBeGreaterThan(WAD);
    expect(abundant.factorWad).toBeLessThan(WAD);
  });
  it('the clamp bounds the scarcity ratio and so the price move: factor stays within sqrt(low)..sqrt(high)', () => {
    const lo = midPrice(ref, 0n, 10n ** 9n, P), hi = midPrice(ref, 10n ** 9n, 0n, P);
    if (!('mid' in lo) || !('mid' in hi)) throw new Error('mid expected');
    expect(hi.factorWad).toBe(1_414_213_562_373_095_048n); // sqrt(2)
    expect(lo.factorWad).toBe(707_106_781_186_547_524n); // sqrt(0.5), rounded down
    expect(scarcityRatio(0n, 10n ** 9n, P)).toEqual(ratio(1n, 2n));
    expect(scarcityRatio(10n ** 9n, 0n, P)).toEqual(ratio(2n));
  });
  it('zero / non-positive denominators give no price with a reason', () => {
    expect(scarcityRatio(10n, -10n, P)).toBeNull();
    expect(scarcityRatio(10n, -50n, P)).toBeNull();
    expect(midPrice(ref, 100n, -10n, P)).toEqual({ reasons: ['zero_denominator'] });
    expect(midPrice({ num: 1n, den: 0n }, 1n, 1n, P)).toEqual({ reasons: ['no_reference'] });
    expect(midPrice(ratio(0n), 1n, 1n, P)).toEqual({ reasons: ['no_reference'] });
  });
  it('bids round the total down, asks up, with half-spreads', () => {
    expect(bidTotal(ref, 10n, P)).toBe(3_920_000n);
    expect(askTotal(ref, 10n, P)).toBe(4_080_000n);
    expect(bidTotal(ratio(1n, 3n), 1n, P)).toBe(0n);
    expect(askTotal(ratio(1n, 3n), 1n, P)).toBe(1n);
  });
  it('reference gate: none, stale, thin; bootstrap subsidy skips the volume check; clock oddities pause', () => {
    const r = (o: object) => referenceReasons({ price: ratio(5n), ageS: 10, eligibleVolume: 100, basis: 'organic', ...o }, P);
    expect(r({})).toEqual([]);
    expect(r({ price: null })).toEqual(['no_reference']);
    expect(r({ price: ratio(0n) })).toEqual(['no_reference']);
    expect(r({ ageS: 3601 })).toEqual(['stale_reference']);
    expect(r({ ageS: 3600 })).toEqual([]);
    expect(r({ ageS: null })).toEqual(['stale_reference']);
    expect(r({ ageS: -1 })).toEqual(['stale_reference']);
    expect(r({ eligibleVolume: 9 })).toEqual(['thin_reference']);
    expect(r({ eligibleVolume: null })).toEqual(['thin_reference']);
    expect(r({ ageS: 9999, eligibleVolume: 1 })).toEqual(['stale_reference', 'thin_reference']);
    expect(r({ basis: 'bootstrap_subsidy', eligibleVolume: null })).toEqual([]);
  });
});

describe('quoteColony: hard limits and reason codes', () => {
  it('quotes both sides around the reference when inventory is at target', () => {
    const q = quoteColony(base(), P);
    expect(q.basis).toBe('organic');
    expect(q.mid).toEqual(ratio(400_000n));
    expect(q.bid).toMatchObject({ side: 'buy', amount: 100n });
    expect(q.ask).toMatchObject({ side: 'sell', amount: 100n }); // capped by maxOrderUnits (300 are spare)
    expect(q.bidReasons).toEqual([]);
    expect(q.ask!.priceAmount).toBe(askTotal(ratio(400_000n), 100n, P));
  });

  it('the bid never exceeds the walk-away price including fees and transport', () => {
    const q = quoteColony(base({ walkAway: { localUnitCost: ratio(380_000n), localMinutesPerUnit: null, minuteValue: null, needValue: null }, transportPerUnit: ratio(1_000n) }), P);
    const limit = 100n * 372_400n - 100n * 1_000n;
    expect(q.bid).not.toBeNull();
    expect(maxBuyerSpend(q.bid!.priceAmount, 100, 100)).toBeLessThanOrEqual(limit);
    expect(maxBuyerSpend(q.bid!.priceAmount + 1n, 100, 100)).toBeGreaterThan(limit);
    expect(q.bid!.priceAmount).toBeLessThan(bidTotal(ratio(400_000n), 100n, P));
    expect(q.bid!.maxSpend).toBe(maxBuyerSpend(q.bid!.priceAmount, 100, 100) + 100_000n);
  });

  it('cash shortage shrinks the size, keeps the unit price; zero cash and zero budget pause', () => {
    const full = quoteColony(base(), P).bid!;
    const part = quoteColony(base({ freeQuote: full.maxSpend / 2n }), P).bid!;
    expect(part.amount).toBeLessThan(full.amount);
    expect(part.maxSpend).toBeLessThanOrEqual(full.maxSpend / 2n);
    expect(part.priceAmount).toBe(bidTotal(ratio(400_000n), part.amount, P));
    expect(quoteColony(base({ freeQuote: 0n }), P)).toMatchObject({ bid: null, bidReasons: ['no_cash'] });
    expect(quoteColony(base({ budgetLeft: 0n }), P)).toMatchObject({ bid: null, bidReasons: ['no_cash'] });
    expect(quoteColony(base({ budgetLeft: full.maxSpend / 2n }), P).bid!.amount).toBe(part.amount);
    expect(quoteColony(base({ freeQuote: -5n }), P).bidReasons).toEqual(['no_cash']);
  });

  it('per-order size and quote budget cap the order; an overflow-size need is capped, not wrapped', () => {
    const huge = quoteColony(base({ need: { planned: 10n ** 40n, reserve: 0n, available: 0n, expectedOwn: 0n }, freeQuote: 10n ** 60n }), P);
    expect(huge.bid!.amount).toBe(100n);
    const lot = quoteColony(base({ need: { planned: 95n, reserve: 0n, available: 0n, expectedOwn: 0n }, lotUnits: 10 }), P);
    expect(lot.bid!.amount).toBe(90n);
    const tiny = quoteColony(base({ reference: { price: ratio(10n ** 9n), ageS: 1, eligibleVolume: 100, basis: 'organic' }, walkAway: { localUnitCost: ratio(10n ** 12n), localMinutesPerUnit: null, minuteValue: null, needValue: null } }), P);
    expect(tiny.bid!.priceAmount).toBeLessThanOrEqual(P.maxOrderQuoteAtomic);
    expect(tiny.bid!.amount).toBeLessThan(100n);
  });

  it('pauses with explicit reasons: no need, no walk-away, unknown transport, dust order, lot larger than need', () => {
    expect(quoteColony(base({ need: { planned: 5n, reserve: 0n, available: 9n, expectedOwn: 0n } }), P).bidReasons).toEqual(['no_need']);
    expect(quoteColony(base({ walkAway: { localUnitCost: null, localMinutesPerUnit: null, minuteValue: null, needValue: null } }), P).bidReasons).toEqual(['no_walkaway_value']);
    expect(quoteColony(base({ transportPerUnit: null }), P)).toMatchObject({ bidReasons: ['transport_unknown'], askReasons: ['transport_unknown'] });
    expect(quoteColony(base({ minNotionalAtomic: 10n ** 15n }), P).bidReasons).toEqual(['below_min_notional']);
    expect(quoteColony(base({ lotUnits: 1000 }), P).bidReasons).toEqual(['size_zero']);
    expect(quoteColony(base({ walkAway: { localUnitCost: ratio(0n), localMinutesPerUnit: null, minuteValue: null, needValue: null } }), P).bidReasons).toEqual(['below_walkaway']);
  });

  it('stale, thin or missing reference pauses bids but a cost-floor ask can still seed the market', () => {
    for (const reference of [{ price: null, ageS: null, eligibleVolume: null, basis: 'organic' as const }, { price: ratio(400_000n), ageS: 99999, eligibleVolume: 100, basis: 'organic' as const }, { price: ratio(400_000n), ageS: 5, eligibleVolume: 1, basis: 'organic' as const }]) {
      const q = quoteColony(base({ reference }), P);
      expect(q.bid).toBeNull();
      expect(q.bidReasons.length).toBeGreaterThan(0);
      expect(q.ask!.priceAmount).toBe(100n * 315_000n); // own cost 300000 * 1.05, no spread, no mid
    }
  });

  it('asks never go below own cost + margin even when the mid is lower (abundant inventory)', () => {
    const q = quoteColony(base({ inventory: 50_000n, ownUnitCost: ratio(390_000n) }), P);
    expect(q.ask!.priceAmount).toBeGreaterThanOrEqual(100n * 409_500n);
  });

  it('asks need surplus and a measured cost; sells are limited to free units', () => {
    expect(quoteColony(base({ freeUnits: 400n }), P)).toMatchObject({ ask: null, askReasons: ['no_surplus'] });
    expect(quoteColony(base({ ownUnitCost: null }), P).askReasons).toEqual(['no_unit_cost']);
    expect(quoteColony(base({ freeUnits: 502n, lotUnits: 5 }), P)).toMatchObject({ ask: null, askReasons: ['size_zero'] });
    expect(quoteColony(base({ freeUnits: 507n, lotUnits: 5 }), P).ask!.amount).toBe(5n);
    expect(quoteColony(base({ minNotionalAtomic: 10n ** 15n }), P).askReasons).toEqual(['below_min_notional']);
  });

  it('zero denominator inventory pauses the bid with a reason (no fabricated mid)', () => {
    const q = quoteColony(base({ inventory: -10n }), P);
    expect(q.bid).toBeNull();
    expect(q.bidReasons).toEqual(['zero_denominator']);
  });

  it('scarce vs abundant: the same reference quotes higher where the resource is scarce', () => {
    const scarce = quoteColony(base({ inventory: 50n }), P);
    const abundant = quoteColony(base({ inventory: 5000n, freeUnits: 5000n }), P);
    const unit = (n: { mid: { num: bigint; den: bigint } | null }) => n.mid!;
    expect(unit(scarce).num * unit(abundant).den).toBeGreaterThan(unit(abundant).num * unit(scarce).den);
  });

  it('bootstrap subsidy basis is reported on the quote', () => {
    const q = quoteColony(base({ reference: { price: ratio(400_000n), ageS: 1, eligibleVolume: null, basis: 'bootstrap_subsidy' } }), P);
    expect(q.basis).toBe('bootstrap_subsidy');
    expect(q.bid).not.toBeNull();
  });

  it('principalForSpend is the exact inverse of the reservation; place-order args carry the total price', () => {
    for (const limit of [0n, 1n, 99n, 101n, 10_000n, 3_724_000n, 10n ** 30n]) {
      const p = principalForSpend(limit, 100, 100);
      expect(maxBuyerSpend(p, 100, 100)).toBeLessThanOrEqual(limit);
      if (limit > 0n) expect(maxBuyerSpend(p + 1n, 100, 100)).toBeGreaterThan(limit);
    }
    expect(principalForSpend(-4n, 100, 100)).toBe(0n);
    const q = quoteColony(base(), P);
    expect(toPlaceOrderArgs(q.bid!, 'bio.water', 900)).toEqual({ side: 'buy', resource: 'bio.water', amount: 100, price: { token: 'USDC', amount: q.bid!.priceAmount.toString() }, ttlS: 900 });
    expect(() => toPlaceOrderArgs({ ...q.bid!, amount: 10n ** 30n }, 'bio.water', 900)).toThrow(RangeError);
  });
});
