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
  readonly expiresAt: number;
  readonly escrowId: string;
  readonly escrowTx: string;
  readonly opId: string;
  readonly claimerAccountId: string | null;
}

export interface PostedBounty extends BountyView {
  readonly receipt: ChainReceipt;
}

export function toBountyView(row: BountyRow): BountyView {
  return {
    id: row.id,
    planetId: row.planetId,
    posterColonyId: row.posterColonyId,
    colonyIndex: row.colonyIndex,
    accountId: row.accountId,
    target: BountyTarget.parse(row.target),
    reward: BountyReward.parse(row.reward),
    state: row.state,
    expiresAt: row.expiresAt.getTime(),
    escrowId: row.escrowId,
    escrowTx: row.escrowTx,
    opId: row.opId,
    claimerAccountId: row.claimerAccountId,
  };
}
