import { economyError, type EconomyError, type RegionsContent, type LogisticsContent } from '@terra/contracts';
import { bindingsOverlap } from './resolve';

/**
 * Static checks of a profile's region/logistics sections (no context needed): duplicate profile ids, bindings naming unknown
 * profiles, bindings that can both match one region at the same level and priority (`ambiguous_binding`), reserve ordering,
 * duplicate logistics rows. Context-dependent checks (essential access, main-resource badge) are in `resolveRegion`.
 */
export function validateRegionContent(regions: RegionsContent, logistics: LogisticsContent): EconomyError[] {
  const errors: EconomyError[] = [];
  const ids = new Set<string>();
  for (const p of regions.profiles) {
    if (ids.has(p.regionProfileId)) errors.push(economyError('invalid_region', `duplicate region profile "${p.regionProfileId}"`, `regions.profiles.${p.regionProfileId}`));
    ids.add(p.regionProfileId);
    for (const [k, f] of Object.entries(p.resources)) {
      if (f.reserveUnitsMin !== undefined && f.reserveUnitsMax !== undefined && f.reserveUnitsMin > f.reserveUnitsMax) {
        errors.push(economyError('invalid_region', `${p.regionProfileId}.${k}: reserveUnitsMin exceeds reserveUnitsMax`, `regions.profiles.${p.regionProfileId}.resources.${k}`));
      }
    }
  }
  regions.bindings.forEach((b, i) => {
    if (!ids.has(b.regionProfileId)) errors.push(economyError('unknown_region_profile', `binding ${i} names unknown region profile "${b.regionProfileId}"`, `regions.bindings.${i}`));
    const col = { planetType: b.planetType, planetId: b.planetId, sectorId: b.sectorId, archetype: b.archetype }[b.scopeKind === 'sectorArchetype' ? 'archetype' : b.scopeKind];
    if (col === '') errors.push(economyError('invalid_region', `binding ${i} of kind ${b.scopeKind} must set its own scope column`, `regions.bindings.${i}`));
    for (let j = i + 1; j < regions.bindings.length; j++) {
      if (bindingsOverlap(b, regions.bindings[j]!)) errors.push(economyError('ambiguous_binding', `bindings ${i} and ${j} are both ${b.scopeKind} priority ${b.priority} and can match the same region`, `regions.bindings.${i}`, { other: j }));
    }
  });
  const seen = new Set<string>();
  for (const e of logistics.entries) {
    const id = `${e.kind}:${e.subjectId}:${e.tier}`;
    if (seen.has(id)) errors.push(economyError('invalid_manifest', `duplicate logistics row ${id}`, `logistics.entries.${id}`));
    seen.add(id);
    const isNode = e.kind === 'node';
    if (isNode !== (e.throughputMilli !== null && e.reachTiles !== null) || (!isNode && (e.throughputMilli !== null || e.reachTiles !== null))) {
      errors.push(economyError('invalid_manifest', `${id}: only supply nodes carry throughput and reach (and every node must)`, `logistics.entries.${id}`));
    }
  }
  return errors;
}
