import { createHash } from 'node:crypto';

const PREFIX = 'escrow:';

/**
 * `escrow:` plus 32 hex chars of sha256(opId). Stable for a given opId and fits
 * `mock_chain_escrow.id` (varchar 64). `open` has no escrowId field.
 */
export function escrowIdFromOp(opId: string): string {
  const body = createHash('sha256').update(`escrow-id:${opId}`).digest('hex').slice(0, 32);
  return PREFIX + body;
}

/** The hold account is the escrow row id. The dev explorer reads that `mock_chain_balance` row. */
export function escrowHoldAccount(escrowId: string): string {
  return escrowId;
}
