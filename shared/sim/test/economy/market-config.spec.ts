import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS, parseWaves } from '@terra/contracts';
import {
  MarketConfigError, compileData, compileMarketConfig, marketConfigFromData, pairConfigOf, sha256Hex, tryCompileMarketConfig,
} from '../../src';

const flags = parseWaves('..13');
const codes = (r: ReturnType<typeof tryCompileMarketConfig>) => (r.ok ? [] : r.errors.map((e) => e.code));

describe('W13-03 market config: bootstrap defaults', () => {
  const c = compileMarketConfig({}, { flags });
  it('matches the D-44 bootstrap numbers', () => {
    expect(c).toMatchObject({
      policyVersion: 'bootstrap-1', platformFeeBp: 100, stallFeeMinBp: 0, stallFeeMaxBp: 100, stallFeeDefaultBp: 100,
      ttlOptionsS: [900, 3600, 21600, 86400], openOrderLimit: 20, baseLotUnits: 1,
    });
    expect(c.policyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('lists every tradable pair with exact decimals, tick, lot and minimum notional', () => {
    expect(c.pairs).toHaveLength(RESOURCE_KEYS.length * (RESOURCE_KEYS.length - 1 + 2));
    expect(pairConfigOf(c, 'bio.water', 'USDC')).toMatchObject({ pair: 'bio.water/USDC', lotUnits: 1, tickAtomic: '1', minNotionalAtomic: '100000', tokenDecimals: { base: 0, quote: 6 } });
    expect(pairConfigOf(c, 'bio.water', 'NEAR')!.tokenDecimals.quote).toBe(24);
    expect(pairConfigOf(c, 'bio.water', 'metals.t1')).toMatchObject({ minNotionalAtomic: '1', tokenDecimals: { base: 0, quote: 0 } });
    expect(pairConfigOf(c, 'bio.water', 'bio.water')).toBeUndefined();
  });
  it('is deeply frozen', () => {
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.pairs[0])).toBe(true);
    expect(Object.isFrozen(c.ttlOptionsS)).toBe(true);
  });
});

describe('W13-03 market config: same profile, same config on every host', () => {
  it('two independent compiles and a JSON round trip are byte-identical', () => {
    const params = { 'market.policy.platformFeeBp': 150, 'market.quote.USDC.minNotionalAtomic': '250000' };
    const a = compileMarketConfig({ parameters: params });
    const b = compileMarketConfig({ parameters: JSON.parse(JSON.stringify(params)) });
    const reordered = compileMarketConfig({ parameters: Object.fromEntries(Object.entries(params).reverse()) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(reordered)).toBe(JSON.stringify(a));
    const wire = JSON.parse(JSON.stringify(a));
    expect(wire).toEqual(a);
    expect(a.policyHash).not.toBe(compileMarketConfig({}).policyHash);
    expect(a.platformFeeBp).toBe(150);
  });
  it('the compiled data tables of two hosts give the same config as the profile', () => {
    const d1 = compileData(flags), d2 = compileData(flags);
    expect(marketConfigFromData(d1).policyHash).toBe(marketConfigFromData(d2).policyHash);
    expect(marketConfigFromData(d1)).toBe(marketConfigFromData(d1)); // cached per data object
    expect(JSON.stringify(marketConfigFromData(d1))).toBe(JSON.stringify(compileMarketConfig({})));
  });
  it('sha256 is the standard one', () => {
    for (const s of ['', 'abc', 'é€😀'.repeat(40)]) expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
  });
});

describe('W13-03 market config: invalid input fails with structured errors', () => {
  const bad = (parameters: Record<string, unknown>) => tryCompileMarketConfig({ parameters: parameters as never }, { flags });
  it('rejects unknown paths', () => {
    const r = bad({ 'market.policy.nope': 1 });
    expect(codes(r)).toEqual(['unknown_path']);
    expect(r.ok === false && r.errors[0].path).toBe('market.policy.nope');
  });
  it('rejects wrong units and types', () => {
    expect(codes(bad({ 'market.policy.platformFeeBp': '100' }))).toEqual(['wrong_type']);
    expect(codes(bad({ 'market.policy.platformFeeBp': 1.5 }))).toEqual(['wrong_type']);
    expect(codes(bad({ 'market.quote.USDC.minNotionalAtomic': 100000 }))).toEqual(['wrong_type']);
    expect(codes(bad({ 'market.quote.USDC.minNotionalAtomic': '0.1' }))).toEqual(['wrong_type']);
    expect(codes(bad({ 'market.policy.ttlOptionsS': [900, '3600'] }))).toEqual(['invalid_patch']);
  });
  it('rejects out-of-bounds values and broken dependencies', () => {
    expect(codes(bad({ 'market.policy.platformFeeBp': 1001 }))).toEqual(['out_of_bounds']);
    expect(codes(bad({ 'market.policy.openOrderLimit': 0 }))).toEqual(['out_of_bounds']);
    expect(codes(bad({ 'market.policy.ttlOptionsS': [10] }))).toEqual(['out_of_bounds']);
    expect(codes(bad({ 'market.quote.USDC.tickAtomic': '0' }))).toEqual(['out_of_bounds']);
    expect(codes(bad({ 'market.policy.stallFeeDefaultBp': 100, 'market.policy.stallFeeMaxBp': 50 }))).toContain('dependency_violation');
  });
  it('rejects a fixed field and throws a MarketConfigError from compileMarketConfig', () => {
    expect(codes(bad({ 'market.policy.policyVersion': 'bootstrap-2' }))).toEqual(['not_tunable']);
    expect(() => compileMarketConfig({ parameters: { 'market.policy.platformFeeBp': -1 } })).toThrow(MarketConfigError);
  });
  it('refuses the market rows of a host compiled without W13', () => {
    expect(() => marketConfigFromData(compileData(parseWaves('..12')))).toThrow(MarketConfigError);
  });
  it('excludes a resource that is not tradable', () => {
    const c = compileMarketConfig({ parameters: { 'market.resource.bio.t3.tradable': false } });
    expect(c.pairs.some((p) => p.base === 'bio.t3' || p.quote === 'bio.t3')).toBe(false);
    expect(c.pairs).toHaveLength(9 * (8 + 2));
  });
});
