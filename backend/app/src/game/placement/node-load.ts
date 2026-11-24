/** Planet counts above this no longer change the score (it is only the tie-break of equal busy shares). */
const MAX_COUNT = 999;

/**
 * Cluster load score of one worker (3.3), stored in `SimWorkerNode.loadCount` (no schema change): the mean busy share of
 * its sim threads in per-mille, times 1000, plus its planet count as the tie-break. `pickHealthyWorker` orders by it
 * ascending, so the least busy worker wins and equally busy workers fall back to the old "fewest planets" order.
 * A worker with no stats yet (or no threads) scores by planet count alone, exactly as before.
 */
export function nodeLoadScore(threads: readonly { readonly busyRatio: number }[], planets: number): number {
  const count = Math.min(MAX_COUNT, Math.max(0, Math.floor(planets)));
  if (threads.length === 0) return count;
  const mean = threads.reduce((sum, t) => sum + Math.min(1, Math.max(0, t.busyRatio || 0)), 0) / threads.length;
  return Math.round(mean * 1000) * 1000 + count;
}

/** The busy per-mille part of a score (diagnostics). */
export const busyPermilleOf = (score: number): number => Math.floor(score / 1000);
