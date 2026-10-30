export interface RetentionRow {
  readonly id: bigint;
  readonly tick: bigint;
  readonly kind: string;
  readonly savedAt: Date;
}

export const KEEP_LAST = 10;
export const HOURLY_WINDOW_MS = 48 * 3600_000;
const HOUR_MS = 3600_000;

/**
 * DATA_MODEL §6: ids of snapshots that may be deleted. Kept: the last 10 by tick, the first snapshot of each wall-clock
 * hour for 48 h, every `END` and the most recent `SEAL`.
 */
export function prunableIds(rows: readonly RetentionRow[], now: Date): bigint[] {
  const byTick = [...rows].sort((a, b) => (a.tick < b.tick ? 1 : a.tick > b.tick ? -1 : 0));
  const keep = new Set<bigint>(byTick.slice(0, KEEP_LAST).map((r) => r.id));
  const firstOfHour = new Map<number, RetentionRow>();
  for (const r of [...rows].sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime())) {
    if (now.getTime() - r.savedAt.getTime() > HOURLY_WINDOW_MS) continue;
    const h = Math.floor(r.savedAt.getTime() / HOUR_MS);
    if (!firstOfHour.has(h)) firstOfHour.set(h, r);
  }
  for (const r of firstOfHour.values()) keep.add(r.id);
  for (const r of rows) if (r.kind === 'END') keep.add(r.id);
  const seal = byTick.find((r) => r.kind === 'SEAL');
  if (seal) keep.add(seal.id);
  return rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
}
