import { BountyReward, BountyTarget } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { ChainReceipt } from '../domain/types.js';

export type BountyRow = NonNullable<Awaited<ReturnType<PrismaClient['chainBounty']['findUnique']>>>;

export interface BountyView {
  readonly id: string;
  readonly planetId: string;
  readonly posterColonyId: string;
  readonly colonyIndex: number;
  readonly accountId: string;
  readonly target: BountyTarget;
  readonly reward: BountyReward;
  readonly state: string;
  /** Board word. `refunded` after `expiresAt` is `Expired` (no reason column, BE-86). */
  readonly board: string;
  readonly expiresAt: number;
  readonly escrowId: string;
  readonly escrowTx: string;
  readonly opId: string;
  readonly claimerAccountId: string | null;
}

export interface PostedBounty extends BountyView {
  readonly receipt: ChainReceipt;
}

const BOARD: Readonly<Record<string, string>> = {
  open: 'Open',
  claimed: 'Claimed',
  completed: 'Completed',
  paid: 'Paid',
  refunded: 'Refunded',
  expired: 'Expired',
};

/** `refunded` once `expiresAt` has passed reads Expired. Any other state keeps its own word. */
export function bountyBoardLabel(state: string, expiresAtMs: number, nowMs: number): string {
  if (state === 'refunded' && expiresAtMs <= nowMs) return 'Expired';
  return BOARD[state] ?? state;
}

export function toBountyView(row: BountyRow, nowMs = Date.now()): BountyView {
  const expiresAt = row.expiresAt.getTime();
  return {
    id: row.id,
    planetId: row.planetId,
    posterColonyId: row.posterColonyId,
    colonyIndex: row.colonyIndex,
    accountId: row.accountId,
    target: BountyTarget.parse(row.target),
    reward: BountyReward.parse(row.reward),
    state: row.state,
    board: bountyBoardLabel(row.state, expiresAt, nowMs),
    expiresAt,
    escrowId: row.escrowId,
    escrowTx: row.escrowTx,
    opId: row.opId,
    claimerAccountId: row.claimerAccountId,
  };
}
