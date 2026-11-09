export type SummaryFreshness = 'fresh' | 'stale' | 'unknown' | 'unloaded' | 'unavailable';

export interface SectorSummaryInput {
  readonly sectorId: string;
  readonly relevant: boolean;
  readonly freshness: SummaryFreshness;
  readonly resources?: readonly { id: string; amount: number }[];
}

export interface SectorSummary {
  readonly sectorId: string;
  readonly freshness: SummaryFreshness;
  readonly resources: readonly { id: string; amount: number }[] | null;
}

export interface SummaryPage {
  readonly summaries: readonly SectorSummary[];
  readonly omitted: number;
  readonly residency: 'partial';
  readonly worldCreated: false;
}

const DEFAULT_CAP = 64;

/**
 * Bounded summaries for a synthetic world (AI §5). Unknown and unloaded stay distinct.
 * Missing resources are null, not a fake zero. The page never requests full residency.
 */
export function summarizeRelevant(sectors: readonly SectorSummaryInput[], cap = DEFAULT_CAP): SummaryPage {
  const relevant = sectors.filter((sector) => sector.relevant);
  const kept = relevant.slice(0, cap).map((sector) => ({
    sectorId: sector.sectorId,
    freshness: sector.freshness,
    resources: sector.freshness === 'unknown' || sector.freshness === 'unloaded' || sector.freshness === 'unavailable'
      ? null
      : [...(sector.resources ?? [])],
  }));
  return {
    summaries: kept,
    omitted: Math.max(0, relevant.length - kept.length),
    residency: 'partial',
    worldCreated: false,
  };
}

/** 450-sector synthetic world: one relevant home, the rest irrelevant. */
export function syntheticWorld(count = 450): SectorSummaryInput[] {
  return Array.from({ length: count }, (_, i) => ({
    sectorId: `sec_${i}`,
    relevant: i === 0 || i === 7,
    freshness: i === 0 ? 'fresh' : i === 7 ? 'stale' : 'unloaded',
    resources: i === 0 ? [{ id: 'metals.t1', amount: 10 }] : undefined,
  }));
}
