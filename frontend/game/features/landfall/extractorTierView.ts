import { ENTITY_KIND, resolveTierGateSpecs } from '@terra/sim';
import { viewColony } from '../shared/colony';

export interface ExtractorTierView {
  unlockedTier: 1 | 2 | 3;
  ringTerraformedPct: number;
  ringLivingPct: number;
  shares: { t1Share: number; t2Share: number; t3Share: number };
  incomePerSByKey?: Partial<Record<string, number>>;
  summaryText: string;
}

export function resolveExtractorTierView(
  rawView: unknown,
  owner: number,
  entityId: number,
  kind: number,
): ExtractorTierView | undefined {
  if (
    kind !== ENTITY_KIND.metalsExtractor &&
    kind !== ENTITY_KIND.mineralsQuarry &&
    kind !== ENTITY_KIND.waterExtractor &&
    kind !== ENTITY_KIND.petroleumWell
  ) {
    return undefined;
  }
  const col = viewColony(rawView, owner) as Record<string, unknown> | undefined;
  const prod = col?.production as { extractors?: Record<number, Record<string, unknown>> } | undefined;
  const bonuses = col?.extractorBonuses as Record<number, Record<string, unknown>> | undefined;
  const rec = prod?.extractors?.[entityId] ?? bonuses?.[entityId];
  if (!rec || typeof rec !== 'object') return undefined;

  const rawTier = Number(rec.unlockedTier ?? 1);
  const unlockedTier: 1 | 2 | 3 = rawTier === 3 ? 3 : rawTier === 2 ? 2 : 1;
  const ringTerraformedPct = typeof rec.ringTerraformedPct === 'number' ? rec.ringTerraformedPct : 0;
  const ringLivingPct = typeof rec.ringLivingPct === 'number' ? rec.ringLivingPct : 0;
  const rawShares = rec.shares as { t1Share?: number; t2Share?: number; t3Share?: number } | undefined;
  // Missing shares: the D-34 data rows' split for the unlocked tier (`resolveTierGateSpecs`), not a copied table.
  const specs = resolveTierGateSpecs();
  const split = unlockedTier === 3 ? specs.tier3 : unlockedTier === 2 ? specs.tier2 : { t1Share: 1, t2Share: 0, t3Share: 0 };
  const shares = {
    t1Share: typeof rawShares?.t1Share === 'number' ? rawShares.t1Share : split.t1Share,
    t2Share: typeof rawShares?.t2Share === 'number' ? rawShares.t2Share : split.t2Share,
    t3Share: typeof rawShares?.t3Share === 'number' ? rawShares.t3Share : split.t3Share,
  };
  const incomePerSByKey = rec.incomePerSByKey as Partial<Record<string, number>> | undefined;

  const fam = kind === ENTITY_KIND.metalsExtractor ? 'metals' : kind === ENTITY_KIND.mineralsQuarry ? 'minerals' : 'bio';
  const t1Pct = Math.round(shares.t1Share * 100);
  const t2Pct = Math.round(shares.t2Share * 100);
  const t3Pct = Math.round(shares.t3Share * 100);
  let splitText = `100 % ${fam === 'bio' ? 'bio.water' : `${fam}.t1`}`;
  if (fam === 'metals' || fam === 'minerals') {
    if (unlockedTier === 3) {
      splitText = `${t1Pct} % ${fam}.t1 / ${t2Pct} % ${fam}.t2 / ${t3Pct} % ${fam}.t3`;
    } else if (unlockedTier === 2) {
      splitText = `${t1Pct} % ${fam}.t1 / ${t2Pct} % ${fam}.t2`;
    } else {
      splitText = `100 % ${fam}.t1`;
    }
  }
  const summaryText = `T${unlockedTier} · ${splitText} · Ring ${ringTerraformedPct}%`;
  return {
    unlockedTier,
    ringTerraformedPct,
    ringLivingPct,
    shares,
    ...(incomePerSByKey ? { incomePerSByKey } : {}),
    summaryText,
  };
}
