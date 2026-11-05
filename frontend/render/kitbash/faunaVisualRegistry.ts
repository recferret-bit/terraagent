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

/** Biological palettes are nonmetallic; fine surface response comes from anatomical tissue fields. */
const surface = (color: number, roughness: number): MaterialZoneSpec =>
  ({ color, roughness, metalness: 0, emissiveIntensity: 0 });
const palette = (shell: number, joint: number, accent: number, roughness = 0.34) => ({
  hullPrimary: surface(shell, roughness), frameGunmetal: surface(joint, 0.68),
  hullSecondary: surface(accent, 0.42), rubberDark: surface(joint, 0.74),
  glassVisor: surface(0x171b16, 0.14),
});
export const FAUNA_SPECIES_ZONES: Readonly<Record<FaunaVisualSpecies, Partial<Record<MaterialZoneId, MaterialZoneSpec>>>> = {
  blackAnt: palette(0x424449, 0x65534a, 0x88684c, 0.40),
  blueBeetle: palette(0x235e91, 0x343b44, 0x6a8095, 0.25),
  greenSpitter: palette(0x426c48, 0x555540, 0xa1b955, 0.38),
};
export const FAUNA_HIVE_ZONES: typeof FAUNA_SPECIES_ZONES = {
  blackAnt: palette(0x89705a, 0x69503e, 0xb59a75, 0.88),
  blueBeetle: palette(0x496581, 0x605d51, 0x889eab, 0.55),
  greenSpitter: palette(0x57664a, 0x7c8860, 0xadc565, 0.65),
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

function splitSpeciesAndPlanet(
  first: FaunaVisualSpecies | string,
  second?: FaunaVisualSpecies | string,
): { species: FaunaVisualSpecies; planetType?: string } {
  if ((FAUNA_VISUAL_SPECIES as readonly string[]).includes(first)) {
    return { species: first as FaunaVisualSpecies, planetType: second };
  }
  if (second && (FAUNA_VISUAL_SPECIES as readonly string[]).includes(second)) {
    return { species: second as FaunaVisualSpecies, planetType: first };
  }
  return { species: 'blackAnt', planetType: first };
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

/**
 * Resolves the species hive archetype ID for `(planetType, species)` (or `(species, planetType)`).
 */
export function resolveFaunaHiveArchetypeId(
  planetOrSpecies: string | FaunaVisualSpecies,
  speciesOrPlanet?: FaunaVisualSpecies | string,
): string {
  const { species, planetType } = splitSpeciesAndPlanet(planetOrSpecies, speciesOrPlanet);
  return resolveFaunaArchetypeId(species, 'hive', planetType);
}

/**
 * Resolves the species bug archetype ID for `(planetType, species)` (or `(species, planetType)`).
 */
export function resolveFaunaBugArchetypeId(
  planetOrSpecies: string | FaunaVisualSpecies,
  speciesOrPlanet?: FaunaVisualSpecies | string,
): string {
  const { species, planetType } = splitSpeciesAndPlanet(planetOrSpecies, speciesOrPlanet);
  return resolveFaunaArchetypeId(species, 'bug', planetType);
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
