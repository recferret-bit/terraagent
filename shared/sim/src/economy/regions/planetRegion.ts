import { RegionsContent, type ParamValue, type RegionProfileDef, type ScopeBindingDef } from '@terra/contracts';
import regionData from '../../data/regions';
import { resolveRegion, type RegionContext, type ResolveRegionResult } from './resolve';

const PRESET_PREFIX = 'preset.';

/** Planet types the `regions` table has a preset row for (`preset.<planetType>`: desert, ocean, temperate). */
export const presetPlanetTypes = (): string[] => regionData.rows.filter((r) => r.id.startsWith(PRESET_PREFIX)).map((r) => r.id.slice(PRESET_PREFIX.length));

/** The preset profile + `planetType` binding of one planet type (the §2.2 abundance table row), or `null` when it has none. */
export function presetFor(planetType: string): { profile: RegionProfileDef; binding: ScopeBindingDef } | null {
  const row = regionData.rows.find((r) => r.id === `${PRESET_PREFIX}${planetType}`);
  if (!row) return null;
  const weights = row.occurrenceWeightBp as Record<string, number>;
  const resources = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, { occurrenceWeightBp: v }])) as RegionProfileDef['resources'];
  const regionProfileId = `${PRESET_PREFIX}${planetType}`;
  return {
    profile: { regionProfileId, resources },
    binding: { scopeKind: 'planetType', planetType, planetId: '', sectorId: '', archetype: '', regionProfileId, priority: 0 },
  };
}

/**
 * Pre-W11 single region (ECON-GEO-02): the whole planet is ONE region, resolved with `{ planetType, planetId }` and no
 * sector. A game planet type with a preset row (desert / ocean / temperate) is bound to it unless the profile content
 * already binds that planet type itself; everything else inherits the global layer.
 */
export function resolvePlanetRegion(content: { readonly parameters?: Readonly<Record<string, ParamValue>>; readonly regions?: RegionsContent }, ctx: RegionContext): ResolveRegionResult {
  const regions = content.regions ?? RegionsContent.parse({});
  const bound = regions.bindings.some((b) => b.scopeKind === 'planetType' && b.planetType === ctx.planetType);
  const preset = bound ? null : presetFor(ctx.planetType);
  const merged: RegionsContent = preset ? { profiles: [preset.profile, ...regions.profiles], bindings: [preset.binding, ...regions.bindings] } : regions;
  return resolveRegion({ ...content, regions: merged }, ctx);
}
