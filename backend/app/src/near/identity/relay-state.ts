import type { RelayStatusResponse } from '@terra/contracts';

/** Outbox statuses that count as a deposit still in flight. */
const IN_FLIGHT = new Set(['PENDING', 'RUNNING']);
/** Outbox statuses that count as a deposit the player can retry. */
const GIVEN_UP = new Set(['FAILED', 'DEAD']);

export interface DepositRow {
  readonly opId: string;
  readonly status: string;
}

/**
 * One player's `storage-deposit:*` rows. `pending` wins over `failed`.
 * No rows is `none`. Every row `DONE` is `settled`.
 */
export function reduceRelayState(rows: readonly DepositRow[]): RelayStatusResponse {
  if (rows.length === 0) return { state: 'none' };
  const pending = rows.find((row) => IN_FLIGHT.has(row.status));
  if (pending) return { state: 'pending', opId: pending.opId };
  const failed = rows.find((row) => GIVEN_UP.has(row.status));
  if (failed) return { state: 'failed', opId: failed.opId };
  if (rows.every((row) => row.status === 'DONE')) return { state: 'settled', opId: rows[0]!.opId };
  return { state: 'none' };
}
