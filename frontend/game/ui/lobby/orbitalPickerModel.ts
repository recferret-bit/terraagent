import {
  CANONICAL_PLANETS,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_SEVEN_SECTOR_COORDS,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  formatSectorId,
  planetLookForType,
  planetTypeForLook,
  type PlanetListV1,
  type PlanetSummaryV1,
  type PlanetType,
  type SectorId,
  type SectorPlacementIntentV1,
  type SectorSummaryV1,
} from '@terra/contracts';
import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';

/**
 * Player's sector selection in the W11 orbital picker (MATCHMAKING §0.2 MM-32..34, §0.3):
 * - `{ mode: 'auto' }` — explicit automatic sector placement on the selected canonical planet
 * - `{ mode: 'chosen', sectorId }` — explicit chosen land sector on the selected canonical planet
 */
export type SectorIntentV1 =
  | { readonly mode: 'auto' }
  | { readonly mode: 'chosen'; readonly sectorId: SectorId };

export type SectorIntentInput =
  | SectorIntentV1
  | SectorPlacementIntentV1
  | 'auto'
  | SectorId
  | null
  | undefined;

export function planetTypeForMenuKind(kind: PlanetKind): PlanetType {
  return planetTypeForLook(kind);
}

export function menuKindForPlanetType(type: PlanetType): PlanetKind {
  return planetLookForType(type);
}

export function normalizeSectorIntent(input?: SectorIntentInput): SectorIntentV1 {
  if (!input || input === 'auto') {
    return { mode: 'auto' };
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed && trimmed !== 'auto'
      ? { mode: 'chosen', sectorId: trimmed }
      : { mode: 'auto' };
  }
  if ('mode' in input) {
    return input.mode === 'chosen' && input.sectorId
      ? { mode: 'chosen', sectorId: input.sectorId }
      : { mode: 'auto' };
  }
  if ('kind' in input) {
    return input.kind === 'chosen' && input.sectorId
      ? { mode: 'chosen', sectorId: input.sectorId }
      : { mode: 'auto' };
  }
  return { mode: 'auto' };
}

export function toSectorPlacementIntentV1(intent: SectorIntentV1): SectorPlacementIntentV1 {
  return intent.mode === 'chosen'
    ? { kind: 'chosen', sectorId: intent.sectorId }
    : { kind: 'auto' };
}

const DEFAULT_OCEAN_HALO_COORDS: readonly (readonly [number, number])[] = [
  [2, 0],
  [2, -1],
] as const;

export function buildDefaultSectorSummaries(type: PlanetType, updatedAt: string): SectorSummaryV1[] {
  const mainResourceByType: Readonly<Record<PlanetType, SectorSummaryV1['mainResource']>> = {
    desert: 'metals.t1',
    ocean: 'bio.water',
    temperate: 'minerals.t1',
  };
  const land: SectorSummaryV1[] = W11_SEVEN_SECTOR_COORDS.map(([macroQ, macroR]) => {
    const sectorId = formatSectorId(macroQ, macroR);
    const cap = W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
    return {
      sectorId,
      continentId: 'cont_0',
      macroQ,
      macroR,
      centerQ: macroQ * 37,
      centerR: macroR * 37,
      kind: 'land',
      foundingCapacity: cap,
      validatedCapacity: cap,
      reservedSeats: 0,
      foundedSeats: 0,
      freeSeats: cap,
      livingColonies: null,
      presentColonies: null,
      onlinePlayers: null,
      availability: 'open',
      mainResource: mainResourceByType[type],
    };
  });
  const ocean: SectorSummaryV1[] = DEFAULT_OCEAN_HALO_COORDS.map(([macroQ, macroR]) => ({
    sectorId: formatSectorId(macroQ, macroR),
    continentId: null,
    macroQ,
    macroR,
    centerQ: macroQ * 37,
    centerR: macroR * 37,
    kind: 'ocean',
    foundingCapacity: 0,
    validatedCapacity: 0,
    reservedSeats: 0,
    foundedSeats: 0,
    freeSeats: 0,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    availability: 'full',
  }));
  void updatedAt;
  return [...land, ...ocean];
}

export function buildDefaultPlanetSummaryV1(
  kind: PlanetKind,
  updatedAt = '2026-11-08T00:00:00.000Z',
): PlanetSummaryV1 {
  const type = planetTypeForMenuKind(kind);
  const def = CANONICAL_PLANETS[type];
  const sectors = buildDefaultSectorSummaries(type, updatedAt);
  const landSectors = sectors.filter((s) => s.kind === 'land');
  const oceanSectors = sectors.filter((s) => s.kind === 'ocean');
  const nominalCapacity = landSectors.reduce((acc, s) => acc + s.foundingCapacity, 0);
  const validatedCapacity = landSectors.reduce((acc, s) => acc + s.validatedCapacity, 0);
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    look: def.look,
    lifecycle: 'ACTIVE',
    health: 'OK',
    admission: 'OPEN',
    availability: 'open',
    atlasVersion: 1,
    atlasHash: `w11-canonical-atlas-${def.type}`,
    configHash: `w11-canonical-config-${def.type}`,
    totalSectors: sectors.length,
    landSectors: landSectors.length,
    oceanSectors: oceanSectors.length,
    nominalCapacity,
    validatedCapacity,
    reservedSeats: 0,
    foundedSeats: 0,
    freeSeats: validatedCapacity,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    updatedAt,
    sectors,
  };
}

export function createDefaultCanonicalPlanetMap(): Record<PlanetKind, PlanetSummaryV1> {
  return {
    dune: buildDefaultPlanetSummaryV1('dune'),
    oceanForest: buildDefaultPlanetSummaryV1('oceanForest'),
    forestRock: buildDefaultPlanetSummaryV1('forestRock'),
  };
}

function normalizeSectorSummary(
  sec: SectorSummaryV1,
  world: Pick<PlanetSummaryV1, 'lifecycle' | 'health' | 'admission'>,
): SectorSummaryV1 {
  const validatedCapacity = sec.kind === 'ocean' ? 0 : sec.validatedCapacity;
  const freeSeats =
    typeof sec.freeSeats === 'number'
      ? Math.max(0, sec.freeSeats)
      : Math.max(0, validatedCapacity - sec.reservedSeats - sec.foundedSeats);
  const derived = deriveSectorOccupancy({
    kind: sec.kind,
    foundingCapacity: sec.foundingCapacity,
    validatedCapacity,
    reservedSeats: sec.reservedSeats,
    foundedSeats: sec.foundedSeats,
    livingColonies: sec.livingColonies ?? null,
    presentColonies: sec.presentColonies ?? null,
    onlinePlayers: sec.onlinePlayers ?? null,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
  });
  const availability =
    world.lifecycle !== 'ACTIVE' || world.health !== 'OK' || world.admission !== 'OPEN'
      ? derived.availability
      : (sec.availability ?? derived.availability);
  return {
    ...sec,
    validatedCapacity,
    freeSeats,
    availability,
  };
}

export function normalizePlanetSummaryV1(summary: PlanetSummaryV1): PlanetSummaryV1 {
  const lifecycle = summary.lifecycle ?? 'ACTIVE';
  const health = summary.health ?? 'OK';
  const admission = summary.admission ?? 'OPEN';
  const rawSectors =
    Array.isArray(summary.sectors) && summary.sectors.length > 0
      ? summary.sectors
      : buildDefaultSectorSummaries(summary.type, summary.updatedAt);
  const sectors = rawSectors.map((s) => normalizeSectorSummary(s, { lifecycle, health, admission }));
  const landCount = sectors.filter((s) => s.kind === 'land').length;
  const oceanCount = sectors.filter((s) => s.kind === 'ocean').length;
  const validatedCapacity =
    typeof summary.validatedCapacity === 'number'
      ? summary.validatedCapacity
      : sectors.filter((s) => s.kind === 'land').reduce((sum, s) => sum + s.validatedCapacity, 0);
  const reservedSeats =
    typeof summary.reservedSeats === 'number'
      ? summary.reservedSeats
      : sectors.filter((s) => s.kind === 'land').reduce((sum, s) => sum + s.reservedSeats, 0);
  const foundedSeats =
    typeof summary.foundedSeats === 'number'
      ? summary.foundedSeats
      : sectors.filter((s) => s.kind === 'land').reduce((sum, s) => sum + s.foundedSeats, 0);
  const freeSeats =
    typeof summary.freeSeats === 'number'
      ? Math.max(0, summary.freeSeats)
      : Math.max(0, validatedCapacity - reservedSeats - foundedSeats);
  const derivedAvail = deriveWorldAvailability({ lifecycle, health, admission, freeSeats });
  const availability =
    lifecycle !== 'ACTIVE' || health !== 'OK' || admission !== 'OPEN' || freeSeats <= 0
      ? derivedAvail
      : (summary.availability ?? derivedAvail);
  return {
    ...summary,
    look: planetLookForType(summary.type),
    lifecycle,
    health,
    admission,
    availability,
    totalSectors: summary.totalSectors ?? sectors.length,
    landSectors: summary.landSectors ?? Math.max(1, landCount),
    oceanSectors: summary.oceanSectors ?? oceanCount,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies: summary.livingColonies ?? null,
    presentColonies: summary.presentColonies ?? null,
    onlinePlayers: summary.onlinePlayers ?? null,
    sectors,
  };
}

export function mergePlanetListIntoCanonicalMap(
  source: PlanetListV1 | readonly PlanetSummaryV1[],
  existing?: Readonly<Record<PlanetKind, PlanetSummaryV1>>,
): Record<PlanetKind, PlanetSummaryV1> {
  const base = existing ? { ...existing } : createDefaultCanonicalPlanetMap();
  const list = Array.isArray(source) ? source : (source as PlanetListV1).planets;
  if (!Array.isArray(list)) return base;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const kind: PlanetKind | null =
      item.look && PLANET_KINDS.includes(item.look as PlanetKind)
        ? (item.look as PlanetKind)
        : item.type === 'desert' || item.type === 'ocean' || item.type === 'temperate'
          ? menuKindForPlanetType(item.type)
          : null;
    if (!kind) continue;
    base[kind] = normalizePlanetSummaryV1(item);
  }
  return base;
}
