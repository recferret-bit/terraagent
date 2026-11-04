import { RegionsContent, type RegionProfileDef, type ScopeBindingDef } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { defaultParamRegistry, resolveRegion, validateRegionContent, type RegionContext } from '../../src/economy';

const bind = (b: Partial<ScopeBindingDef> & Pick<ScopeBindingDef, 'scopeKind' | 'regionProfileId'>): ScopeBindingDef => ({ planetType: '', planetId: '', sectorId: '', archetype: '', priority: 0, ...b });
const regions = (profiles: RegionProfileDef[], bindings: ScopeBindingDef[]) => RegionsContent.parse({ profiles, bindings });
const ctx = (c: Partial<RegionContext> = {}): RegionContext => ({ planetType: 'desert', planetId: 'pl_dune', ...c });
const field = (r: ReturnType<typeof resolveRegion>, k: string, f: string) => {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const x = r.region.resources.find((y) => y.resource === k)!;
  return { value: (x.fields as Record<string, number>)[f], source: (x.provenance as Record<string, string>)[f] };
};

const desert: RegionProfileDef = { regionProfileId: 'desert', resources: { 'minerals.t3': { occurrenceWeightBp: 1500 }, 'bio.water': { occurrenceWeightBp: 3000 } } };
const ridge: RegionProfileDef = { regionProfileId: 'crystal-ridge', resources: { 'minerals.t3': { occurrenceWeightBp: 8000 } } };
const content = regions([desert, ridge], [bind({ scopeKind: 'planetType', planetType: 'desert', regionProfileId: 'desert' }), bind({ scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', regionProfileId: 'crystal-ridge' })]);

describe('resolveRegion (ECON-GEO-01, W13-50)', () => {
  it('desert crystal 15 vs ridge override 80, everything else inherits with per-field provenance', () => {
    const plain = resolveRegion({ regions: content }, ctx());
    expect(field(plain, 'minerals.t3', 'occurrenceWeightBp')).toEqual({ value: 1500, source: 'planetType' });
    expect(field(plain, 'bio.water', 'occurrenceWeightBp')).toEqual({ value: 3000, source: 'planetType' });
    expect(field(plain, 'metals.t1', 'occurrenceWeightBp')).toEqual({ value: 10000, source: 'global' });

    const sector = resolveRegion({ regions: content }, ctx({ sectorArchetype: 'crystal-ridge', sectorId: 'sec_42' }));
    expect(field(sector, 'minerals.t3', 'occurrenceWeightBp')).toEqual({ value: 8000, source: 'sectorArchetype' });
    // per field, never multiplied: the ridge changed only crystal weight; its other fields keep their layer
    expect(field(sector, 'minerals.t3', 'reserveUnitsMax')).toEqual({ value: 200, source: 'global' });
    expect(field(sector, 'bio.water', 'occurrenceWeightBp')).toEqual({ value: 3000, source: 'planetType' });
    if (!sector.ok || !plain.ok) throw new Error('unreachable');
    expect(sector.region.resources).toHaveLength(10);
    expect(sector.region.appliedBindings.map((b) => b.level)).toEqual(['planetType', 'sectorArchetype']);
    expect(sector.region.endowmentHash).not.toBe(plain.region.endowmentHash);
    expect(sector.region.runtimeHash).toBe(plain.region.runtimeHash);
  });

  it('an explicit zero beats inheriting, at every level', () => {
    const zero = regions([...content.profiles, { regionProfileId: 'barren', resources: { 'bio.biomass': { occurrenceWeightBp: 0, renewableUnitsPerSimHour: 0 } } }],
      [...content.bindings, bind({ scopeKind: 'sectorId', sectorId: 'sec_dry', regionProfileId: 'barren' })]);
    const r = resolveRegion({ regions: zero }, ctx({ sectorId: 'sec_dry' }));
    expect(field(r, 'bio.biomass', 'occurrenceWeightBp')).toEqual({ value: 0, source: 'sectorId' });
    expect(field(r, 'bio.biomass', 'renewableUnitsPerSimHour')).toEqual({ value: 0, source: 'sectorId' });
    expect(field(resolveRegion({ regions: zero }, ctx({ sectorId: 'sec_other' })), 'bio.biomass', 'occurrenceWeightBp')).toEqual({ value: 10000, source: 'global' });
  });

  it('higher priority wins within a level; equal priority that both match is ambiguous', () => {
    const wide = bind({ scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', regionProfileId: 'desert' });
    const narrow = bind({ scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', planetType: 'desert', regionProfileId: 'crystal-ridge', priority: 5 });
    const ok = regions([desert, ridge], [wide, narrow]);
    expect(field(resolveRegion({ regions: ok }, ctx({ sectorArchetype: 'crystal-ridge' })), 'minerals.t3', 'occurrenceWeightBp').value).toBe(8000);
    const tie = regions([desert, ridge], [wide, { ...narrow, priority: 0 }]);
    const r = resolveRegion({ regions: tie }, ctx({ sectorArchetype: 'crystal-ridge' }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatchObject({ code: 'ambiguous_binding' });
    // the same pair on another planet type does not overlap in practice, but static validation flags the potential overlap
    expect(validateRegionContent(tie, { entries: [] }).map((e) => e.code)).toContain('ambiguous_binding');
    expect(validateRegionContent(ok, { entries: [] })).toEqual([]);
  });

  it('rejects missing essential access (starter guarantee of water / metals / minerals)', () => {
    const noWater = regions([{ regionProfileId: 'dry', resources: { 'bio.water': { starterGuarantee: 0 } } }], [bind({ scopeKind: 'planetId', planetId: 'pl_dune', regionProfileId: 'dry' })]);
    const r = resolveRegion({ regions: noWater }, ctx());
    expect(!r.ok && r.errors[0]).toMatchObject({ code: 'missing_essential_access', details: { resource: 'bio.water' } });
    // zero extraction yield is also no access; a non-essential resource with zero guarantee is fine
    const noYield = regions([{ regionProfileId: 'y', resources: { 'metals.t1': { extractionYieldBp: 0 } } }], [bind({ scopeKind: 'planetId', planetId: 'pl_dune', regionProfileId: 'y' })]);
    expect(resolveRegion({ regions: noYield }, ctx()).ok).toBe(false);
    // a global parameter override is the global layer
    const params = { 'regions.defaults.starterGuarantee': { 'metals.t1': 300, 'minerals.t1': 300, 'bio.water': 0 } };
    expect(resolveRegion({ parameters: params, regions: { profiles: [], bindings: [] } }, ctx()).ok).toBe(false);
  });

  it('rejects a contradictory main-resource badge and reserve min > max; accepts a matching badge', () => {
    const bind1 = (id: string) => [bind({ scopeKind: 'planetId', planetId: 'pl_dune', regionProfileId: id })];
    const bad = regions([{ regionProfileId: 'm', mainResource: 'minerals.t3', resources: {} }], bind1('m'));
    expect(resolveRegion({ regions: bad }, ctx())).toMatchObject({ ok: false, errors: [{ code: 'contradictory_main_resource' }] });
    const good = regions([{ regionProfileId: 'm', mainResource: 'minerals.t3', resources: { 'minerals.t3': { occurrenceWeightBp: 90000 } } }], bind1('m'));
    const r = resolveRegion({ regions: good }, ctx());
    expect(r.ok && r.region.mainResource).toEqual({ value: 'minerals.t3', source: 'planetId' });
    const inverted = regions([{ regionProfileId: 'i', resources: { 'metals.t2': { reserveUnitsMin: 900, reserveUnitsMax: 100 } } }], bind1('i'));
    expect(resolveRegion({ regions: inverted }, ctx())).toMatchObject({ ok: false, errors: [{ code: 'invalid_region' }] });
  });

  it('runtime fields change only the runtime hash; endowment fields only the endowment hash', () => {
    const base = resolveRegion({ regions: content }, ctx());
    const yielded = resolveRegion({ regions: regions([{ ...desert, resources: { ...desert.resources, 'metals.t1': { extractionYieldBp: 12000 } } }, ridge], content.bindings) }, ctx());
    if (!base.ok || !yielded.ok) throw new Error('unreachable');
    expect(yielded.region.runtimeHash).not.toBe(base.region.runtimeHash);
    expect(yielded.region.endowmentHash).toBe(base.region.endowmentHash);
  });

  it('is deterministic and registers the new-world vs runtime split', () => {
    expect(JSON.stringify(resolveRegion({ regions: content }, ctx()))).toBe(JSON.stringify(resolveRegion({ regions: content }, ctx())));
    const reg = defaultParamRegistry();
    expect(reg.get('regions.defaults.occurrenceWeightBp')?.mutability).toBe('new_world_only');
    expect(reg.get('regions.defaults.extractionYieldBp')?.mutability).toBe('runtime');
    expect(reg.get('logistics.coefficients.alphaBp')).toMatchObject({ mutability: 'runtime', default: 2500 });
    expect(Object.keys(reg.get('regions.defaults.occurrenceWeightBp')!.default as object)).toHaveLength(10);
  });
});
