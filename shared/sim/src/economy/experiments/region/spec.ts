import { RegionsContent, type ResourceKey } from '@terra/contracts';

/** One sector of a fixture: which resolution scope its region comes from (pre-W11: colonies map onto fixture sectors). */
export interface SectorSpec { readonly sectorId: string; readonly archetype?: string }

/**
 * `assumptions.region` of a region experiment scenario (ECONOMY §9). Everything is data: a seeded planet generated from the
 * resolved region, one or more colonies with a Command Hub, powered Supply Depots and a logistics load (operating extractors,
 * 20 load units each at the baseline row) placed `routeTiles` from the Hub.
 */
export interface RegionFixtureSpec {
  readonly planetType: 'desert' | 'temperate' | 'ocean';
  readonly regions: RegionsContent;
  /** Sector of colony i (`"0"` -> ...); unlisted colonies use the planet region (`sector:0`). */
  readonly sectors: Readonly<Record<string, SectorSpec>>;
  readonly colonies: number;
  /** Extra Supply Depots per colony (throughput 60 each at the baseline row): the `fixed` vs `expanded` depot grid axis. */
  readonly depots: number;
  /** Operating extractors per colony (load 20 each). */
  readonly extractors: number;
  readonly units: number;
  readonly routeTiles: number;
  readonly stock: Readonly<Partial<Record<ResourceKey, number>>>;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : d);

/** Parses `assumptions.region`; `null` when absent (a non-region scenario). */
export function parseRegionSpec(assumptions: Readonly<Record<string, unknown>>): RegionFixtureSpec | null {
  const raw = assumptions.region as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const pt = raw.planetType;
  return {
    planetType: pt === 'temperate' || pt === 'ocean' ? pt : 'desert',
    regions: RegionsContent.parse(raw.regions ?? {}),
    sectors: (raw.sectors ?? {}) as Record<string, SectorSpec>,
    colonies: Math.max(1, num(raw.colonies, 1)),
    depots: num(raw.depots, 0),
    extractors: num(raw.extractors, 2),
    units: num(raw.units, 0),
    routeTiles: num(raw.routeTiles, 4),
    stock: (raw.stock ?? {}) as Partial<Record<ResourceKey, number>>,
  };
}

export const sectorKey = (spec: RegionFixtureSpec, colony: number): string => `sector:${spec.sectors[String(colony)]?.sectorId ?? '0'}`;
