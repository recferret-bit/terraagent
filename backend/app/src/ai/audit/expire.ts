import type { DirectorContextRecord, DirectorDecisionRecord, DirectorRowsToDelete } from './types.js';

/**
 * Indexed expiry cleanup (AI_ORCHESTRATOR §10). Returns context and decision rows to delete
 * (`expiresAtMs <= nowMs`). Does not mutate the inputs.
 * Policy is durable: player preferences are not an input and this function never deletes them.
 */
export function partitionExpired(
  nowMs: number,
  contexts: readonly DirectorContextRecord[],
  decisions: readonly DirectorDecisionRecord[],
): DirectorRowsToDelete {
  return {
    contexts: contexts.filter((row) => row.expiresAtMs <= nowMs),
    decisions: decisions.filter((row) => row.expiresAtMs <= nowMs),
  };
}
