import {
  CANONICAL_PLANETS,
  CANONICAL_PLANET_IDS,
  CANONICAL_PLANET_LIST,
  canonicalPlanetById,
  isCanonicalPlanetId,
  type CanonicalPlanetDef,
  type CanonicalPlanetId,
} from '../lobby/atlas';

/**
 * Only the three shared canonical worlds support King-of-the-Hill Planetary Patronage.
 * Paid sovereign NFT planets have private governance and are explicitly excluded.
 */
export const PATRONAGE_PLANETS: readonly CanonicalPlanetDef[] = CANONICAL_PLANET_LIST;

export const PATRONAGE_PLANET_IDS: readonly [string, string, string] = CANONICAL_PLANET_IDS;

export const PATRONAGE_NON_ELIGIBLE_MESSAGE =
  'Planetary Patronage is only available on the three canonical public worlds (Kharon Dunes, Thalassa Verde, Granite Hollow); sovereign NFT planets are not eligible.';

export function isPatronageEligiblePlanetId(
  planetId: string | null | undefined,
): planetId is CanonicalPlanetId {
  return typeof planetId === 'string' && isCanonicalPlanetId(planetId.trim());
}

export function resolveDefaultPatronagePlanetId(hintPlanetId?: string | null): CanonicalPlanetId {
  if (isPatronageEligiblePlanetId(hintPlanetId)) {
    return hintPlanetId.trim() as CanonicalPlanetId;
  }
  return CANONICAL_PLANETS.temperate.id;
}

export function patronagePlanetName(planetId: string): string {
  return canonicalPlanetById(planetId)?.name ?? planetId;
}

export function formatPatronagePlanetLabel(planetId: string): string {
  const def = canonicalPlanetById(planetId);
  return def ? `${def.name} (${def.id})` : planetId;
}
