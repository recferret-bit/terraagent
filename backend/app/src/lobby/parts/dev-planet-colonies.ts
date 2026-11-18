import { W11_SEVEN_SECTOR_COORDS, formatSectorId, type PlanetType } from '@terra/contracts';
import type { ColonyRecord, HomeRepository } from '../../core/home/home.repository';
import type { PlanetSectorRecord } from '../lobby-persistence.types';

const ENDED_STATES: ReadonlySet<string> = new Set(['ENDED', 'PLANET_ENDED', 'ARCHIVED']);
const LIVING_STATES: ReadonlySet<string> = new Set(['ACTIVE', 'ALIVE', 'FOUNDING']);
const LAND_SECTOR_IDS: readonly string[] = W11_SEVEN_SECTOR_COORDS.map(([q, r]) => formatSectorId(q, r));
const LAND_SECTOR_SET: ReadonlySet<string> = new Set(LAND_SECTOR_IDS);
const SECTOR_CAPACITY = 4;
const MAX_MAPPED_COLONIES = LAND_SECTOR_IDS.length * SECTOR_CAPACITY - 1;

function inferDevPlanetType(planetId: string, dbType?: string | null): PlanetType {
  if (dbType === 'desert' || dbType === 'ocean' || dbType === 'temperate') return dbType;
  const lower = planetId.toLowerCase();
  if (lower.includes('ocean')) return 'ocean';
  if (lower.includes('temperate') || lower.includes('forest')) return 'temperate';
  return 'desert';
}

/**
 * When canonical world sectors are unprovisioned (`sectors.length === 0`, e.g. dev-shard seating on `pl_dev*`),
 * aggregates active colonies across the matching planet family's dev shards and distributes them across the
 * 7 canonical land sectors so `GET /v1/planets` and the orbital sector picker report real founded & free spots.
 */
export async function resolveDevFamilyColoniesForSummary(
  type: PlanetType,
  sectors: readonly PlanetSectorRecord[],
  canonicalColonies: readonly ColonyRecord[],
  homeRepo?: HomeRepository,
): Promise<readonly ColonyRecord[]> {
  if (!homeRepo || sectors.length > 0 || canonicalColonies.length > 0) return canonicalColonies;

  const [planets, allColonies] = await Promise.all([homeRepo.listPlanets(), homeRepo.listColonies()]);
  const archived = new Set<string>();
  const typesById = new Map<string, PlanetType>();
  for (const p of planets) {
    if (ENDED_STATES.has(p.state) || ENDED_STATES.has(p.status)) archived.add(p.id);
    else typesById.set(p.id, inferDevPlanetType(p.id, p.type));
  }

  const matching = allColonies
    .filter((c) => {
      if (archived.has(c.planetId)) return false;
      if (!LIVING_STATES.has(c.status) && !LIVING_STATES.has(c.state)) return false;
      return inferDevPlanetType(c.planetId, typesById.get(c.planetId)) === type;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, MAX_MAPPED_COLONIES);

  if (matching.length === 0) return canonicalColonies;

  const counts = new Map<string, number>();
  const takeSector = (preferred?: string): string => {
    if (preferred && preferred !== 'sec_0_0' && LAND_SECTOR_SET.has(preferred) && (counts.get(preferred) ?? 0) < SECTOR_CAPACITY) {
      counts.set(preferred, (counts.get(preferred) ?? 0) + 1);
      return preferred;
    }
    for (const sid of LAND_SECTOR_IDS) {
      const used = counts.get(sid) ?? 0;
      if (used < SECTOR_CAPACITY) {
        counts.set(sid, used + 1);
        return sid;
      }
    }
    return LAND_SECTOR_IDS[0]!;
  };

  return matching.map((col) => ({
    ...col,
    foundingSectorId: takeSector(col.foundingSectorId),
  }));
}
