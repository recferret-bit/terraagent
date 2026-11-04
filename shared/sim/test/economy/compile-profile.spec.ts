import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, compileProfile, defaultParamRegistry, splitParamPath, tryCompileProfile } from '../../src';

const flags = parseWaves('..13').list;
const content = { parameters: { 'market.policy.platformFeeBp': 80, 'market.quote.USDC.minNotionalAtomic': '250000' } };

describe('compileProfile (D-35 override shape, identical on every host)', () => {
  it('baseline defaults compile to no overrides and the stock data hash', () => {
    const c = compileProfile({ parameters: defaultParamRegistry().defaults() }, flags);
    expect(c.overrides).toEqual({});
    expect(c.dataHash).toBe(compileData(new Set(flags), {}).hash);
    expect(c.marketConfig?.platformFeeBp).toBe(100);
  });

  it('turns parameters into overrides (dotted row ids) and changes data and market config', () => {
    const c = compileProfile(content, flags);
    expect(c.overrides).toEqual({ market: { policy: { platformFeeBp: 80 }, 'quote.USDC': { minNotionalAtomic: '250000' } } });
    expect(c.dataHash).not.toBe(compileData(new Set(flags), {}).hash);
    expect(c.marketConfig?.platformFeeBp).toBe(80);
    expect(splitParamPath('market.quote.USDC.tickAtomic')).toEqual({ table: 'market', row: 'quote.USDC', field: 'tickAtomic' });
  });

  it('same content gives the same hashes after a JSON round trip (server = browser = experiment host)', () => {
    const a = compileProfile(content, flags);
    const b = compileProfile(JSON.parse(JSON.stringify({ parameters: Object.fromEntries(Object.entries(content.parameters).reverse()) })), flags);
    expect(b.dataHash).toBe(a.dataHash);
    expect(b.overridesHash).toBe(a.overridesHash);
    expect(b.marketConfig?.policyHash).toBe(a.marketConfig?.policyHash);
    // The browser compiles the overrides it receives (welcome.overrides) to the same data hash.
    expect(compileData(new Set(flags), JSON.parse(JSON.stringify(a.overrides)) as typeof a.overrides).hash).toBe(a.dataHash);
    expect(structuredClone(a)).toEqual(a);
    expect(Object.isFrozen(a.overrides)).toBe(true);
  });

  it('returns structured errors for bad parameters and disabled waves', () => {
    const bad = tryCompileProfile({ parameters: { 'market.policy.platformFeeBp': 5000, 'nope.x.y': 1 } }, flags);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.code).sort()).toEqual(['out_of_bounds', 'unknown_path']);
    const off = tryCompileProfile(content, parseWaves('..07').list);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.errors[0]?.code).toBe('wave_disabled');
    expect(tryCompileProfile({}, parseWaves('..07').list).ok).toBe(true);
  });
});
