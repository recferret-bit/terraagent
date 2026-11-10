import type { DeedMilestonePatch } from '../deed-projector.service.js';
import type { StoredDeedRecord } from '../deed.repository.js';

export function buildDeedBumpPatch(
  record: StoredDeedRecord,
  prior: DeedMilestonePatch | null,
  field: 'terraform' | 'stage' | 'walls' | 'tradeVolume' | 'truces' | 'rank',
  value: number,
): DeedMilestonePatch {
  const baseMeta = record.metadata;
  if (field === 'terraform') {
    const curBp = prior?.terraformBp ?? baseMeta.terraformBp ?? 0;
    const deltaBp = Math.abs(value) <= 100 ? Math.round(value * 100) : Math.round(value);
    const nextBp = Math.max(0, Math.min(10_000, curBp + deltaBp));
    const pct = Math.round(nextBp / 100);
    return {
      colonyId: record.colonyId,
      planetId: record.planetId,
      terraformBp: nextBp,
      change: `Terraform ${pct} %`,
    };
  }
  if (field === 'stage') {
    const nextStage = Math.max(0, Math.min(10, Math.round(value)));
    return {
      colonyId: record.colonyId,
      planetId: record.planetId,
      stage: nextStage,
      change: `Stage ${nextStage}`,
    };
  }
  const nextVal = Math.max(0, Math.round(value));
  return {
    colonyId: record.colonyId,
    planetId: record.planetId,
    [field]: nextVal,
    change: `${field} ${nextVal}`,
  };
}
