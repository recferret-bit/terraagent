import type { DbClient } from '@terra/db';
import { NearException } from '../../../domain/errors.js';

/** Row after a successful one-shot transition out of `open`. */
export interface OpenEscrowRow {
  readonly id: string;
  readonly opener: string;
  readonly beneficiary: string | null;
  readonly tokenId: string;
  readonly amount: { toFixed(digits?: number): string };
  readonly status: string;
}

/**
 * Moves `open` → `claimed` or `refunded` inside the caller's transaction.
 * Missing id is `NEAR_ESCROW_NOT_FOUND`. Any other status is `NEAR_ESCROW_STATE`.
 */
export async function takeOpenEscrow(tx: DbClient, escrowId: string, next: 'claimed' | 'refunded'): Promise<OpenEscrowRow> {
  const moved = await tx.mockChainEscrow.updateMany({
    where: { id: escrowId, status: 'open' },
    data: { status: next },
  });
  const row = await tx.mockChainEscrow.findUnique({ where: { id: escrowId } });
  if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId } });
  if (moved.count !== 1) {
    throw new NearException('NEAR_ESCROW_STATE', { details: { escrowId, status: row.status } });
  }
  return row;
}
