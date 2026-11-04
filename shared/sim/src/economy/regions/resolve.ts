import {
  ENDOWMENT_FIELDS, RESOURCE_FIELDS, RESOURCE_KEYS, RUNTIME_FIELDS, economyError,
  type EconomyError, type ParamValue, type RegionProfileDef, type RegionResourceFields, type RegionsContent, type ResourceField, type ResourceKey,
  type ScopeBindingDef, type ScopeLevel,
} from '@terra/contracts';
import regionData from '../../data/regions';
import { canonical } from '../../data/_hash';
import { sha256Hex } from '../sha256';

/** Where a resolved value came from: the winning layer of global -> planetType -> planetId -> sectorArchetype -> sectorId. */
export type RegionSource = ScopeLevel;

export interface RegionContext {
  readonly planetType: string;
  readonly planetId: string;
  readonly sectorArchetype?: string;
  readonly sectorId?: string;
}

export interface ResolvedResource {
  readonly resource: ResourceKey;
  readonly fields: Readonly<Record<ResourceField, number>>;
  /** Per-field provenance: the layer whose value won (an explicit 0 wins like any other value). */
  readonly provenance: Readonly<Record<ResourceField, RegionSource>>;
}

export interface AppliedBinding { readonly level: RegionSource; readonly regionProfileId: string; readonly priority: number }

export interface ResolvedRegion {
  readonly context: RegionContext;
  /** All ten resources in `RESOURCE_KEYS` order. */
  readonly resources: readonly ResolvedResource[];
  readonly depositDensityPer1000Tiles: { readonly value: number; readonly source: RegionSource };
  readonly mainResource: { readonly value: ResourceKey | null; readonly source: RegionSource };
  readonly appliedBindings: readonly AppliedBinding[];
  /** Hash of everything fixed at world creation (new-world only fields, density, main resource); no provenance. */
  readonly endowmentHash: string;
  /** Hash of the operational fields (yields, renewal); changing it is a runtime activation, never a regeneration. */
  readonly runtimeHash: string;
}

export type ResolveRegionResult = { readonly ok: true; readonly region: ResolvedRegion } | { readonly ok: false; readonly errors: EconomyError[] };

/** Essential T1 access: the starter guarantee must be positive and extractable (ECON-GEO-01). */
export const ESSENTIAL_RESOURCES: readonly ResourceKey[] = ['bio.water', 'metals.t1', 'minerals.t1'];

/** The global layer: registered defaults of the `regions` data table overlaid by `regions.defaults.<field>` profile parameters. */
function globalLayer(parameters: Readonly<Record<string, ParamValue>>): { density: number; byField: Record<ResourceField, Record<string, number>> } {
  const row = regionData.rows.find((r) => r.id === 'defaults')!;
  const pick = (field: string): unknown => parameters[`regions.defaults.${field}`] ?? row[field];
  const byField = {} as Record<ResourceField, Record<string, number>>;
  for (const f of RESOURCE_FIELDS) byField[f] = { ...(pick(f) as Record<string, number>) };
  return { density: pick('depositDensityPer1000Tiles') as number, byField };
}

const LEVELS: readonly Exclude<ScopeLevel, 'global'>[] = ['planetType', 'planetId', 'sectorArchetype', 'sectorId'];

/** Whether a binding applies to `ctx`: its kind's context value is present and every non-empty scope column equals the context. */
export function bindingMatches(b: ScopeBindingDef, ctx: RegionContext): boolean {
  const cols: [string, string | undefined][] = [[b.planetType, ctx.planetType], [b.planetId, ctx.planetId], [b.sectorId, ctx.sectorId], [b.archetype, ctx.sectorArchetype]];
  return cols.every(([want, have]) => want === '' || want === have);
}

/** Two bindings of one level and priority that some context can satisfy at once (their non-empty columns do not conflict). */
export function bindingsOverlap(a: ScopeBindingDef, b: ScopeBindingDef): boolean {
  if (a.scopeKind !== b.scopeKind || a.priority !== b.priority) return false;
  return [[a.planetType, b.planetType], [a.planetId, b.planetId], [a.sectorId, b.sectorId], [a.archetype, b.archetype]].every(([x, y]) => x === '' || y === '' || x === y);
}

const describe = (b: ScopeBindingDef): string => `${b.scopeKind}[${[b.planetType, b.planetId, b.sectorId, b.archetype].filter(Boolean).join('|')}]#${b.priority}->${b.regionProfileId}`;

/** The binding applied at `level` for `ctx`, or an ambiguity/unknown-profile error. */
function pickBinding(content: RegionsContent, level: Exclude<ScopeLevel, 'global'>, ctx: RegionContext, errors: EconomyError[]): { binding: ScopeBindingDef; profile: RegionProfileDef } | null {
  if ((level === 'sectorArchetype' && ctx.sectorArchetype === undefined) || (level === 'sectorId' && ctx.sectorId === undefined)) return null;
  const hits = content.bindings.filter((b) => b.scopeKind === level && bindingMatches(b, ctx));
  if (hits.length === 0) return null;
  const top = Math.max(...hits.map((h) => h.priority));
  const winners = hits.filter((h) => h.priority === top);
  if (winners.length > 1) {
    errors.push(economyError('ambiguous_binding', `${winners.length} bindings at level ${level} and priority ${top} match this region: ${winners.map(describe).join('; ')}`, `regions.bindings.${level}`, { level, priority: top, bindings: winners.map(describe) }));
    return null;
  }
  const binding = winners[0]!;
  const profile = content.profiles.find((p) => p.regionProfileId === binding.regionProfileId);
  if (!profile) {
    errors.push(economyError('unknown_region_profile', `binding ${describe(binding)} names no region profile`, `regions.bindings.${level}`, { regionProfileId: binding.regionProfileId }));
    return null;
  }
  return { binding, profile };
}

/**
 * Resolves the effective regional endowment of ONE sector (or a whole planet) for all ten resources (ECON-GEO-01/02). Layers replace
 * explicitly supplied fields only; omitted fields inherit, an explicit 0 is a value. Never multiplies layers. Pure and deterministic.
 * Errors (never thrown): `ambiguous_binding`, `unknown_region_profile`, `invalid_region` (reserve min > max),
 * `missing_essential_access` (starter guarantee of essential T1 water/metals/minerals unmet), `contradictory_main_resource`.
 */
export function resolveRegion(content: { readonly parameters?: Readonly<Record<string, ParamValue>>; readonly regions?: RegionsContent }, ctx: RegionContext): ResolveRegionResult {
  const regions: RegionsContent = content.regions ?? { profiles: [], bindings: [] };
  const errors: EconomyError[] = [];
  const base = globalLayer(content.parameters ?? {});
  const fields = new Map<ResourceKey, Record<ResourceField, number>>();
  const prov = new Map<ResourceKey, Record<ResourceField, RegionSource>>();
  for (const k of RESOURCE_KEYS) {
    fields.set(k, Object.fromEntries(RESOURCE_FIELDS.map((f) => [f, base.byField[f][k] ?? 0])) as Record<ResourceField, number>);
    prov.set(k, Object.fromEntries(RESOURCE_FIELDS.map((f) => [f, 'global'])) as Record<ResourceField, RegionSource>);
  }
  let density = { value: base.density, source: 'global' as RegionSource };
  let main: ResolvedRegion['mainResource'] = { value: null, source: 'global' };
  const applied: AppliedBinding[] = [];
  for (const level of LEVELS) {
    const hit = pickBinding(regions, level, ctx, errors);
    if (!hit) continue;
    applied.push({ level, regionProfileId: hit.profile.regionProfileId, priority: hit.binding.priority });
    if (hit.profile.depositDensityPer1000Tiles !== undefined) density = { value: hit.profile.depositDensityPer1000Tiles, source: level };
    if (hit.profile.mainResource !== undefined) main = { value: hit.profile.mainResource, source: level };
    for (const [k, over] of Object.entries(hit.profile.resources) as [ResourceKey, RegionResourceFields][]) {
      for (const f of RESOURCE_FIELDS) {
        if (over[f] === undefined) continue;
        fields.get(k)![f] = over[f];
        prov.get(k)![f] = level;
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const resources: ResolvedResource[] = RESOURCE_KEYS.map((resource) => ({ resource, fields: fields.get(resource)!, provenance: prov.get(resource)! }));
  errors.push(...checkResolved(resources, main.value));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, region: { context: ctx, resources, depositDensityPer1000Tiles: density, mainResource: main, appliedBindings: applied, ...hashesOf(resources, density.value, main.value) } };
}

/** Expected recoverable output (relative units): occurrence weight x mean reserve x yield. Used to validate main-resource badges. */
export function expectedRecoverable(f: Readonly<Record<ResourceField, number>>): number {
  return (f.occurrenceWeightBp * (f.reserveUnitsMin + f.reserveUnitsMax) * f.extractionYieldBp) / 2;
}

function checkResolved(resources: readonly ResolvedResource[], main: ResourceKey | null): EconomyError[] {
  const errors: EconomyError[] = [];
  for (const r of resources) {
    if (r.fields.reserveUnitsMin > r.fields.reserveUnitsMax) {
      errors.push(economyError('invalid_region', `${r.resource}: reserveUnitsMin ${r.fields.reserveUnitsMin} exceeds reserveUnitsMax ${r.fields.reserveUnitsMax}`, `regions.${r.resource}.reserveUnitsMin`));
    }
  }
  for (const k of ESSENTIAL_RESOURCES) {
    const f = resources.find((r) => r.resource === k)!.fields;
    if (f.starterGuarantee <= 0 || f.extractionYieldBp <= 0) {
      errors.push(economyError('missing_essential_access', `${k}: essential T1 access needs a positive starter guarantee (${f.starterGuarantee}) and extraction yield (${f.extractionYieldBp} bp)`, `regions.${k}.starterGuarantee`, { resource: k }));
    }
  }
  if (main !== null) {
    const best = Math.max(...resources.map((r) => expectedRecoverable(r.fields)));
    const mine = expectedRecoverable(resources.find((r) => r.resource === main)!.fields);
    if (mine < best) errors.push(economyError('contradictory_main_resource', `mainResource ${main} is not the resource with the highest expected recoverable output`, 'regions.mainResource', { mainResource: main }));
  }
  return errors;
}

function hashesOf(resources: readonly ResolvedResource[], density: number, main: ResourceKey | null): { endowmentHash: string; runtimeHash: string } {
  const part = (names: readonly ResourceField[]) => Object.fromEntries(resources.map((r) => [r.resource, Object.fromEntries(names.map((n) => [n, r.fields[n]]))]));
  return {
    endowmentHash: `sha256:${sha256Hex(canonical({ density, main, resources: part(ENDOWMENT_FIELDS) }))}`,
    runtimeHash: `sha256:${sha256Hex(canonical({ resources: part(RUNTIME_FIELDS) }))}`,
  };
}
