import { describe, expect, it } from 'vitest';
import { badgesOf, boundsText, buildOps, diffParams, fieldsOf, groupOf, mapErrors, parseFieldInput, type EconomySchema } from './model';

const prop = (over: Record<string, unknown>) => ({ description: 'd', default: 1, type: 'integer', 'x-unit': 'bp', 'x-mutability': 'runtime', 'x-requiredWave': 'W13', 'x-enabled': true, ...over });
const schema = {
  schemaVersion: 1,
  properties: {
    'market.policy.platformFeeBp': prop({ default: 100, minimum: 0, maximum: 1000 }),
    'market.policy.policyVersion': prop({ type: 'string', enum: ['bootstrap-1'], default: 'bootstrap-1', 'x-mutability': 'fixed', 'x-unit': 'enum' }),
    'market.policy.ttlOptionsS': prop({ type: 'array', default: [900, 3600], 'x-unit': 'seconds' }),
    'market.quote.USDC.minNotionalAtomic': prop({ type: 'string', default: '100000', 'x-unit': 'atomic', 'x-minimum': '0', 'x-maximum': '999' }),
    'market.resource.bio.water.tradable': prop({ type: 'boolean', default: true, 'x-unit': 'flag' }),
    'opsBasic.clear.yields': prop({ type: 'object', default: { 'bio.biomass': 5 }, 'x-mutability': 'new_world_only', 'x-enabled': false }),
  },
} as unknown as EconomySchema;
const fields = fieldsOf(schema);
const field = (p: string) => fields.find((f) => f.path === p)!;

describe('economy form model', () => {
  it('groups registered paths and derives field kinds', () => {
    expect(groupOf('market.policy.platformFeeBp')).toBe('market');
    expect(groupOf('market.resource.bio.water.lotUnits')).toBe('resources');
    expect(groupOf('hub.t1.storageCapPerFamily')).toBe('budgets');
    expect(fields.map((f) => f.kind)).toEqual(['int', 'enum', 'intList', 'atomic', 'bool', 'intMap']);
  });

  it('shows runtime / new-world-only / fixed and wave badges', () => {
    expect(badgesOf(field('market.policy.platformFeeBp'))).toEqual([{ label: 'RUNTIME', tone: 'ok' }, { label: 'W13', tone: 'ai' }]);
    expect(badgesOf(field('market.policy.policyVersion'))[0]).toEqual({ label: 'FIXED', tone: 'alert' });
    expect(badgesOf(field('opsBasic.clear.yields'))).toEqual([{ label: 'NEW WORLD ONLY', tone: 'away' }, { label: 'W13', tone: 'alert' }]);
    expect(boundsText(field('market.policy.platformFeeBp'))).toBe('0…1000');
    expect(boundsText(field('market.quote.USDC.minNotionalAtomic'))).toBe('0…999');
  });

  it('parses and rejects inputs per kind', () => {
    expect(parseFieldInput(field('market.policy.platformFeeBp'), ' 80 ')).toEqual({ ok: true, value: 80 });
    expect(parseFieldInput(field('market.policy.platformFeeBp'), '8.5').ok).toBe(false);
    expect(parseFieldInput(field('market.quote.USDC.minNotionalAtomic'), '250000')).toEqual({ ok: true, value: '250000' });
    expect(parseFieldInput(field('market.quote.USDC.minNotionalAtomic'), '0.5').ok).toBe(false);
    expect(parseFieldInput(field('market.policy.ttlOptionsS'), '900, 3600')).toEqual({ ok: true, value: [900, 3600] });
    expect(parseFieldInput(field('market.resource.bio.water.tradable'), 'maybe').ok).toBe(false);
    expect(parseFieldInput(field('opsBasic.clear.yields'), '{"bio.biomass": 7}')).toEqual({ ok: true, value: { 'bio.biomass': 7 } });
    expect(parseFieldInput(field('opsBasic.clear.yields'), '[1]').ok).toBe(false);
  });

  it('builds minimal patch ops: set, unset back to the default, nothing for unchanged, field errors for bad input', () => {
    const params = { 'market.policy.platformFeeBp': 80 };
    const r = buildOps(fields, params, {
      'market.policy.platformFeeBp': '100', // back to the default → unset
      'market.quote.USDC.minNotionalAtomic': '250000', // set
      'market.policy.ttlOptionsS': '900,3600', // unchanged
      'market.resource.bio.water.tradable': 'nope', // bad
    });
    expect(r.ops).toEqual([{ op: 'unset', path: 'market.policy.platformFeeBp' }, { op: 'set', path: 'market.quote.USDC.minNotionalAtomic', value: '250000' }]);
    expect(Object.keys(r.errors)).toEqual(['market.resource.bio.water.tradable']);
  });

  it('maps structured server errors onto fields, including ops.N paths', () => {
    const ops = [{ op: 'set' as const, path: 'a.b.c', value: 1 }, { op: 'set' as const, path: 'market.policy.platformFeeBp', value: 9999 }];
    const m = mapErrors([
      { code: 'out_of_bounds', path: 'market.policy.platformFeeBp', message: '9999 not in [0, 1000]' },
      { code: 'invalid_patch', path: 'ops.0.value', message: 'bad' },
      { code: 'version_conflict', message: 'stale' },
    ], ops);
    expect(m['market.policy.platformFeeBp']).toEqual(['out_of_bounds: 9999 not in [0, 1000]']);
    expect(m['a.b.c']).toEqual(['invalid_patch: bad']);
    expect(m._).toEqual(['version_conflict: stale']);
  });

  it('diffs effective values with defaults filled in', () => {
    const rows = diffParams(fields, { 'market.policy.platformFeeBp': 80 }, { 'market.policy.ttlOptionsS': [60] });
    expect(rows).toEqual([
      { path: 'market.policy.platformFeeBp', unit: 'bp', from: '80', to: '100' },
      { path: 'market.policy.ttlOptionsS', unit: 'seconds', from: '[900,3600]', to: '[60]' },
    ]);
  });
});
