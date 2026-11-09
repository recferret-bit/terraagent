import { describe, expect, it } from 'vitest';
import {
  agentParamsFromData, applyStrategyToColonyInput, compileData, findForbiddenPriceField, nextInt,
  quoteColonyWithStrategy, resolveStrategyArg, seedStream, validateAgentStrategy, type AgentColonyInput,
} from '../../src';

const params = agentParamsFromData(compileData(new Set(['W13'])));
const r = (num: number | bigint, den: number | bigint = 1n) => ({ num: BigInt(num), den: BigInt(den) });

function baseInput(over: Partial<AgentColonyInput> = {}): AgentColonyInput {
  return {
    resource: 'bio.water',
    quote: 'USDC',
    need: { planned: 300n, reserve: 100n, available: 100n, expectedOwn: 50n },
    inventory: 200n,
    target: 200n,
    freeUnits: 500n,
    keepUnits: 100n,
    reference: { price: r(10_000), ageS: 60, eligibleVolume: 1_000, basis: 'organic' },
    walkAway: { localUnitCost: r(20_000), localMinutesPerUnit: null, minuteValue: null, needValue: null },
    ownUnitCost: r(8_000),
    transportPerUnit: r(0),
    freeQuote: 100_000_000n,
    budgetLeft: 50_000_000n,
    platformFeeBp: 100,
    maxStallFeeBp: 100,
    lotUnits: 1,
    minNotionalAtomic: 1_000n,
    ...over,
  };
}

describe('W13-61 validateAgentStrategy & free-price boundary', () => {
  it('positive: accepts valid scripted and exporter strategies and normalises goals', () => {
    const valid = validateAgentStrategy({
      specialisation: 'balanced',
      risk: 'moderate',
      goals: ['surplus_export', 'shortfall_cover', 'surplus_export'],
      reserveTargets: {
        'bio.water': { reserve: '100', target: 250, keep: 80n, planned: 150, expectedOwn: '40', ownUnitCost: '8000/1', localUnitCost: { num: 20000, den: 1 }, transportPerUnit: '0' },
      },
      maxOrderTtlS: 1800,
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.value.goals).toEqual(['surplus_export', 'shortfall_cover']);
    expect(valid.value.reserveTargets['bio.water']?.reserve).toBe(100n);
    expect(valid.value.reserveTargets['bio.water']?.ownUnitCost).toEqual({ num: 8000n, den: 1n });
  });

  it('negative: rejects any free price at top level, nested in reserveTargets, or inside arrays', () => {
    const payloads = [
      { specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, price: '10000' },
      { specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, bidPrice: 500 },
      { specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, askPrice: 600 },
      { specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, limitPrice: '1000' },
      { specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, notional: '50000' },
      { specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: { 'bio.water': { reserve: 10, target: 20, keep: 10, unitPrice: '999' } } },
      { specialisation: 'balanced', risk: 'moderate', goals: [{ targetPrice: 123 }], reserveTargets: {} },
    ];
    for (const p of payloads) {
      const res = validateAgentStrategy(p);
      expect(res).toMatchObject({ ok: false, code: 'free_price_forbidden' });
      expect(findForbiddenPriceField(p)).not.toBeNull();
    }
  });

  it('negative: rejects non-objects, unknown fields, invalid enums, target < reserve, zero denominator, and bad TTL', () => {
    expect(validateAgentStrategy(null)).toMatchObject({ ok: false, code: 'invalid_strategy' });
    expect(validateAgentStrategy([])).toMatchObject({ ok: false, code: 'invalid_strategy' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, extra: 1 })).toMatchObject({ ok: false, code: 'unknown_field' });
    expect(validateAgentStrategy({ specialisation: 'wizard', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {} })).toMatchObject({ ok: false, code: 'invalid_specialisation' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'yolo', goals: ['surplus_export'], reserveTargets: {} })).toMatchObject({ ok: false, code: 'invalid_risk' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'moderate', goals: [], reserveTargets: {} })).toMatchObject({ ok: false, code: 'invalid_goals' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: { 'unobtainium': { reserve: 1, target: 2, keep: 1 } } })).toMatchObject({ ok: false, code: 'invalid_resource' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: { 'bio.water': { reserve: 100, target: 50, keep: 10 } } })).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: { 'bio.water': { reserve: 10, target: 20, keep: 10, ownUnitCost: '100/0' } } })).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(validateAgentStrategy({ specialisation: 'balanced', risk: 'moderate', goals: ['surplus_export'], reserveTargets: {}, maxOrderTtlS: 10 })).toMatchObject({ ok: false, code: 'invalid_ttl' });
  });
});

describe('W13-61 & W13-66 quoteColonyWithStrategy, property tests & scripted bot step', () => {
  it('gates bid and ask sides by strategy goals and specialisation', () => {
    const exportOnly = resolveStrategyArg('exporter');
    const qExport = quoteColonyWithStrategy(exportOnly, baseInput(), params);
    expect(qExport.ask).not.toBeNull();
    expect(qExport.bid).toBeNull();

    const autarky = validateAgentStrategy({
      specialisation: 'autarky', risk: 'conservative', goals: ['surplus_export', 'shortfall_cover'],
      reserveTargets: { 'bio.water': { reserve: 100, target: 200, keep: 100 } },
    });
    expect(autarky.ok).toBe(true);
    if (!autarky.ok) return;
    const qAutarky = quoteColonyWithStrategy(autarky.value, baseInput(), params);
    expect(qAutarky.ask).toBeNull();
    expect(qAutarky.bid).not.toBeNull();
  });

  it('property: across 40 seeded colonies, conservative risk keeps at least as much reserve as aggressive and never invents a price without reference', () => {
    const rng = seedStream('13067', 'misc');
    const cons = resolveStrategyArg(JSON.stringify({
      specialisation: 'balanced', risk: 'conservative', goals: ['surplus_export', 'shortfall_cover'],
      reserveTargets: { 'bio.water': { reserve: 120, target: 240, keep: 120 } },
    }));
    const aggr = resolveStrategyArg(JSON.stringify({
      specialisation: 'balanced', risk: 'aggressive', goals: ['surplus_export', 'shortfall_cover'],
      reserveTargets: { 'bio.water': { reserve: 120, target: 240, keep: 120 } },
    }));
    for (let i = 0; i < 40; i++) {
      const inv = BigInt(nextInt(rng, 10, 600));
      const free = BigInt(nextInt(rng, 0, 600));
      const inp = baseInput({ inventory: inv, freeUnits: free });
      const cIn = applyStrategyToColonyInput(cons, inp);
      const aIn = applyStrategyToColonyInput(aggr, inp);
      expect(cIn.keepUnits).toBeGreaterThanOrEqual(aIn.keepUnits);
      expect(cIn.need.reserve).toBeGreaterThanOrEqual(aIn.need.reserve);

      const noRef = quoteColonyWithStrategy(cons, baseInput({ inventory: inv, freeUnits: free, reference: { price: null, ageS: null, eligibleVolume: null, basis: 'organic' } }), params);
      expect(noRef.bid).toBeNull();
      expect(noRef.bidReasons).toContain('no_reference');
    }
  });
});
