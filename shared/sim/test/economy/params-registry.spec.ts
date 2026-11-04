import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS, parseWaves } from '@terra/contracts';
import market from '../../src/data/market';
import {
  ParamRegistry,
  createParamRegistry,
  dataFields,
  defaultParamRegistry,
  describeSchema,
  validatePatch,
  validateValue,
} from '../../src';

const flags = parseWaves('..13');
const patch = (ops: unknown[], expectedVersion = 1) => ({ schemaVersion: 1, requestId: 'req-1', expectedVersion, ops });
const set = (path: string, value: unknown) => ({ op: 'set', path, value });
const codes = (e: { code: string }[]) => e.map((x) => x.code);
const reg = defaultParamRegistry();
const props = (describeSchema(flags).properties as Record<string, Record<string, unknown>>);

describe('economy parameter registry: schema discovery', () => {
  it('describes a versioned JSON Schema with unit, bounds, default, mutability and wave on every entry', () => {
    const s = describeSchema(flags);
    expect(s.schemaVersion).toBe(1);
    expect(s.$schema).toMatch(/json-schema/);
    expect(Object.keys(props).length).toBe(reg.size);
    for (const [path, p] of Object.entries(props)) {
      for (const k of ['description', 'default', 'x-unit', 'x-mutability', 'x-requiredWave', 'type']) expect(p[k], `${path}.${k}`).toBeDefined();
      if (p.type === 'integer') expect(p.minimum !== undefined && p.maximum !== undefined, path).toBe(true);
      if (path.endsWith('Atomic')) expect(p['x-minimum'], path).toBeDefined();
    }
    expect(JSON.stringify(describeSchema(flags))).toBe(JSON.stringify(describeSchema(flags)));
    expect(props['market.policy.platformFeeBp']).toMatchObject({ type: 'integer', default: 100, 'x-unit': 'bp', 'x-mutability': 'runtime', 'x-requiredWave': 'W13', minimum: 0, maximum: 1000 });
  });

  it('covers all ten resources', () => {
    for (const k of RESOURCE_KEYS) {
      for (const f of ['reserveHorizonS', 'targetBandLoBp', 'targetBandHiBp', 'lotUnits', 'tradable']) {
        expect(props[`market.resource.${k}.${f}`], `${k}.${f}`).toBeDefined();
      }
    }
    expect((describeSchema(flags)['x-resourceKeys'] as string[]).length).toBe(10);
  });

  it('registers every market data-table field', () => {
    for (const row of market.rows) {
      for (const f of dataFields({ ...market, rows: [row] })) expect(reg.has(`market.${row.id}.${f}`), `market.${row.id}.${f}`).toBe(true);
    }
  });

  it('marks disabled waves with x-enabled false', () => {
    const off = describeSchema(parseWaves('..07')).properties as Record<string, Record<string, unknown>>;
    expect(off['market.policy.platformFeeBp']['x-enabled']).toBe(false);
    expect(props['market.policy.platformFeeBp']['x-enabled']).toBe(true);
  });

  it('derives entries from existing data tables and rejects duplicate registration', () => {
    expect(reg.has('hub.t1.storageCapPerFamily')).toBe(true);
    expect(reg.get('opsBasic.clear.yields')?.type).toBe('intMap');
    expect(() => new ParamRegistry().register(reg.get('market.policy.platformFeeBp')!, reg.get('market.policy.platformFeeBp')!)).toThrow(/duplicate/);
    expect(createParamRegistry().size).toBe(reg.size);
  });
});

describe('economy parameter registry: validation', () => {
  it('accepts a valid patch', () => {
    expect(validatePatch({}, patch([set('market.policy.platformFeeBp', 80), set('market.quote.USDC.minNotionalAtomic', '250000'), set('market.policy.ttlOptionsS', [900, 3600]), set('market.resource.bio.water.tradable', false), { op: 'unset', path: 'market.policy.bookPushHz' }]), flags)).toEqual([]);
  });

  it('unknown path', () => {
    const e = validatePatch({}, patch([set('market.policy.nope', 1)]), flags);
    expect(codes(e)).toEqual(['unknown_path']);
    expect(e[0]?.path).toBe('market.policy.nope');
  });

  it('wrong type', () => {
    expect(codes(validatePatch({}, patch([set('market.policy.platformFeeBp', '100')]), flags))).toEqual(['wrong_type']);
    expect(codes(validatePatch({}, patch([set('market.policy.platformFeeBp', 1.5)]), flags))).toEqual(['wrong_type']);
    expect(codes(validatePatch({}, patch([set('market.quote.USDC.minNotionalAtomic', 5)]), flags))).toEqual(['wrong_type']);
    expect(codes(validatePatch({}, patch([set('market.quote.USDC.minNotionalAtomic', '-5')]), flags))).toEqual(['wrong_type']);
    expect(codes(validatePatch({}, patch([set('market.resource.bio.water.tradable', 1)]), flags))).toEqual(['wrong_type']);
    expect(codes(validatePatch({}, patch([{ op: 'set', path: 'market.policy.platformFeeBp' }]), flags))).toEqual(['wrong_type']);
  });

  it('out of bounds', () => {
    expect(codes(validatePatch({}, patch([set('market.policy.platformFeeBp', 5000)]), flags))).toEqual(['out_of_bounds']);
    expect(codes(validatePatch({}, patch([set('market.policy.platformFeeBp', -1)]), flags))).toEqual(['out_of_bounds']);
    expect(codes(validatePatch({}, patch([set('market.quote.USDC.tickAtomic', '0')]), flags))).toEqual(['out_of_bounds']);
    expect(codes(validatePatch({}, patch([set('market.policy.ttlOptionsS', [1])]), flags))).toEqual(['out_of_bounds']);
    expect(validateValue('opsBasic.clear.yields', { gold: 1 })[0]?.code).toBe('unknown_resource');
  });

  it('fixed field is not tunable', () => {
    const e = validatePatch({}, patch([set('market.policy.policyVersion', 'bootstrap-1')]), flags);
    expect(codes(e)).toEqual(['not_tunable']);
    expect(e[0]?.message).toMatch(/new version is a new profile/);
  });

  it('disabled wave fails with wave_disabled', () => {
    expect(codes(validatePatch({}, patch([set('market.policy.platformFeeBp', 80)]), parseWaves('..07')))).toEqual(['wave_disabled']);
  });

  it('version guard and cross-field dependencies', () => {
    expect(codes(validatePatch({}, patch([], 1), flags, { currentVersion: 2 }))).toEqual(['version_conflict']);
    expect(codes(validatePatch({}, patch([set('market.resource.bio.water.targetBandLoBp', 9000)]), flags))).toEqual(['dependency_violation']);
    expect(codes(validatePatch({}, patch([set('market.policy.stallFeeMaxBp', 50)]), flags))).toEqual(['dependency_violation']);
    expect(validatePatch({}, patch([set('market.policy.stallFeeMaxBp', 50), set('market.policy.stallFeeDefaultBp', 40)]), flags)).toEqual([]);
  });

  it('malformed patches are invalid_patch; new_world_only fields are rejected for an existing world', () => {
    expect(codes(validatePatch({}, { ops: [] }, flags))).toEqual(['invalid_patch', 'invalid_patch', 'invalid_patch']);
    const r = new ParamRegistry().register({ path: 'world.x.density', description: 'd', unit: 'count', type: 'int', bounds: { min: 0, max: 9 }, default: 1, mutability: 'new_world_only', why: 'endowment', requiredWave: 'W13' });
    expect(validatePatch({}, patch([set('world.x.density', 3)]), flags, { registry: r })).toEqual([]);
    expect(codes(validatePatch({}, patch([set('world.x.density', 3)]), flags, { registry: r, target: 'existing_world' }))).toEqual(['not_tunable']);
  });

  it('is pure: the content is not mutated', () => {
    const content = { parameters: { 'market.policy.platformFeeBp': 90 } };
    validatePatch(content, patch([set('market.policy.platformFeeBp', 80)]), flags);
    expect(content.parameters['market.policy.platformFeeBp']).toBe(90);
  });
});
