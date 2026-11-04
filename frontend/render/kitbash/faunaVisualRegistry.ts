import type { MaterialZoneId, MaterialZoneSpec } from './KitbashRegistry';

export type FaunaVisualSpecies = 'blackAnt' | 'blueBeetle' | 'greenSpitter';
export type FaunaVisualRole = 'bug' | 'hive';

export const FAUNA_VISUAL_SPECIES: readonly FaunaVisualSpecies[] = [
  'blackAnt',
  'blueBeetle',
  'greenSpitter',
] as const;

export const FAUNA_VISUAL_ROLES: readonly FaunaVisualRole[] = ['bug', 'hive'] as const;

/** Shared W07 canonical kitbash archetype IDs per species and role (`docs/game/fauna-hives-spec.md` §1). */
export const DEFAULT_FAUNA_ARCHETYPES: Readonly<
  Record<FaunaVisualSpecies, Readonly<Record<FaunaVisualRole, string>>>
> = {
  blackAnt: {
    bug: 'fauna.blackAnt',
    hive: 'fauna.hive.blackAnt',
  },
  blueBeetle: {
    bug: 'fauna.blueBeetle',
    hive: 'fauna.hive.blueBeetle',
  },
  greenSpitter: {
    bug: 'fauna.greenSpitter',
    hive: 'fauna.hive.greenSpitter',
  },
};

/**
 * Species-specific chitin & nest material palettes preserving `MaterialZoneId` 60/30/10 semantics
 * while keeping existing robot/building `DEFAULT_MATERIAL_ZONES` untouched (`procedural-bug-3d`).
 */
export const FAUNA_SPECIES_ZONES: Readonly<
  Record<FaunaVisualSpecies, Partial<Record<MaterialZoneId, MaterialZoneSpec>>>
> = {
  blackAnt: {
    hullPrimary: { color: 0x566074, roughness: 0.34, metalness: 0.25, emissiveIntensity: 0.0 },
    hullSecondary: { color: 0xd4944e, roughness: 0.38, metalness: 0.20, emissiveIntensity: 0.0 },
    frameGunmetal: { color: 0x242933, roughness: 0.52, metalness: 0.65, emissiveIntensity: 0.0 },
    rubberDark: { color: 0x15181f, roughness: 0.80, metalness: 0.08, emissiveIntensity: 0.0 },
  },
  blueBeetle: {
    hullPrimary: { color: 0x2e6bd2, roughness: 0.30, metalness: 0.32, emissiveIntensity: 0.0 },
    hullSecondary: { color: 0xdca450, roughness: 0.34, metalness: 0.24, emissiveIntensity: 0.0 },
    frameGunmetal: { color: 0x1d2636, roughness: 0.52, metalness: 0.68, emissiveIntensity: 0.0 },
    rubberDark: { color: 0x121722, roughness: 0.78, metalness: 0.12, emissiveIntensity: 0.0 },
  },
  greenSpitter: {
    hullPrimary: { color: 0x3b8462, roughness: 0.36, metalness: 0.20, emissiveIntensity: 0.0 },
    hullSecondary: { color: 0xd8c858, roughness: 0.38, metalness: 0.15, emissiveIntensity: 0.0 },
    frameGunmetal: { color: 0x1e2c25, roughness: 0.55, metalness: 0.55, emissiveIntensity: 0.0 },
    rubberDark: { color: 0x131c17, roughness: 0.80, metalness: 0.08, emissiveIntensity: 0.0 },
  },
};

const PLANET_TYPE_ALIASES: Readonly<Record<string, string>> = {
  dune: 'dune',
  desert: 'dune',
  ocean: 'oceanForest',
  oceanforest: 'oceanForest',
  forest: 'forestRock',
  forestrock: 'forestRock',
  temperate: 'forestRock',
};

function normalizePlanetKey(planetType?: string): string {
  if (!planetType) return '';
  const trimmed = planetType.trim();
  if (!trimmed) return '';
  return PLANET_TYPE_ALIASES[trimmed.toLowerCase()] ?? trimmed.toLowerCase();
}

function makeOverrideKey(planetKey: string, species: FaunaVisualSpecies, role: FaunaVisualRole): string {
  return `${planetKey}:${species}:${role}`;
}

const planetOverrides = new Map<string, string>();

/**
 * Registers a planet-specific visual archetype override for `(planetType, species, role)`.
 * W07 uses shared models across all planets by default; future waves can register per-planet variants here
 * without changing gameplay species/hive IDs (`docs/game/fauna-hives-spec.md` §1).
 */
export function registerFaunaVisualOverride(
  planetType: string,
  species: FaunaVisualSpecies,
  role: FaunaVisualRole,
  archetypeId: string,
): void {
  const planetKey = normalizePlanetKey(planetType);
  if (!planetKey || !archetypeId) return;
  planetOverrides.set(makeOverrideKey(planetKey, species, role), archetypeId);
}

/**
 * Resolves the kitbash archetype ID for `(species, role)` on `planetType`, falling back to the shared
 * W07 archetype when no planet-specific override is registered.
 */
export function resolveFaunaArchetypeId(
  species: FaunaVisualSpecies,
  role: FaunaVisualRole,
  planetType?: string,
): string {
  const planetKey = normalizePlanetKey(planetType);
  if (planetKey) {
    const override = planetOverrides.get(makeOverrideKey(planetKey, species, role));
    if (override) return override;
  }
  const bySpecies = DEFAULT_FAUNA_ARCHETYPES[species] ?? DEFAULT_FAUNA_ARCHETYPES.blackAnt;
  return bySpecies[role] ?? bySpecies.bug;
}

/** Clears registered planet-specific fauna visual overrides (all planets when `planetType` is omitted). */
export function clearFaunaVisualOverrides(planetType?: string): void {
  if (!planetType) {
    planetOverrides.clear();
    return;
  }
  const planetKey = normalizePlanetKey(planetType);
  for (const key of [...planetOverrides.keys()]) {
    if (key.startsWith(`${planetKey}:`)) {
      planetOverrides.delete(key);
    }
  }
}
