export function isNonEmpty(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

export function parseDurationHours(val: unknown): 2 | 6 | 24 | 72 {
  if (val === 2 || val === 6 || val === 24 || val === 72) return val;
  if (val === '2') return 2;
  if (val === '6') return 6;
  if (val === '24') return 24;
  if (val === '72') return 72;
  return 24;
}

export function mapEliminationCause(
  raw: unknown,
): 'both_lost' | 'critical_timeout' | 'abandoned' | 'hub_and_hq_destroyed' {
  if (raw === 'both_lost') return 'both_lost';
  if (raw === 'critical_timeout' || raw === 'timer') return 'critical_timeout';
  if (raw === 'abandoned') return 'abandoned';
  if (raw === 'hub_and_hq_destroyed' || raw === 'hq_lost') return 'hub_and_hq_destroyed';
  return 'hub_and_hq_destroyed';
}

export function resolvePartnerColonyId(data: Record<string, unknown>, ownColonyId: string): string {
  if (isNonEmpty(data.partnerColonyId)) return data.partnerColonyId.trim();
  const rawA = data.colonyAId ?? (data.colonyA !== undefined ? String(data.colonyA) : undefined);
  const rawB = data.colonyBId ?? (data.colonyB !== undefined ? String(data.colonyB) : undefined);
  if (rawA !== undefined && rawB !== undefined) {
    const aStr = String(rawA).trim();
    const bStr = String(rawB).trim();
    if (aStr === ownColonyId || `col_${aStr}` === ownColonyId) return bStr;
    return aStr;
  }
  if (isNonEmpty(data.colonyId) && data.colonyId.trim() !== ownColonyId) {
    return data.colonyId.trim();
  }
  return '';
}

export function isColonyRelevant(
  colonyIds: readonly (string | number)[] | undefined,
  ownColonyId: string,
  data?: Record<string, unknown>,
): boolean {
  if (!colonyIds || colonyIds.length === 0) return true;
  const match = (val: unknown) => {
    if (val === undefined || val === null) return false;
    const s = String(val).trim();
    return s === ownColonyId || ownColonyId === `col_${s}` || s === `col_${ownColonyId}`;
  };
  if (colonyIds.some(match)) return true;
  if (!data) return false;
  return (
    match(data.colonyId) ||
    match(data.attackerColonyId) ||
    match(data.attackerColony) ||
    match(data.targetColonyId) ||
    match(data.targetColony) ||
    match(data.colonyAId) ||
    match(data.colonyA) ||
    match(data.colonyBId) ||
    match(data.colonyB) ||
    match(data.partnerColonyId) ||
    match(data.byColonyId) ||
    match(data.cancelledBy) ||
    match(data.cancelledByColonyId) ||
    match(data.killerColonyId)
  );
}
