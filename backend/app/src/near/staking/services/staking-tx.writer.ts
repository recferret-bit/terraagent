import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';

export type StakingTxKind = 'stake' | 'unstake' | 'withdraw' | 'compound' | 'stake_profits' | 'early_exit_fee';

export interface StakingTxEntry {
  readonly kind: StakingTxKind;
  readonly accountId: string;
  readonly poolId: string;
  readonly asset: string;
  readonly amountYocto: bigint;
  readonly txHash: string;
  /** The action's op id; with `kind` it makes the row idempotent (a replayed action writes no second row). */
  readonly opId: string;
  readonly atMs: number;
}

/** Stable row id: `StakingTx.id` is 120 chars and op ids may be 200, so the pair is hashed. */
export const stakingTxId = (kind: StakingTxKind, opId: string): string =>
  `${kind}:${createHash('sha256').update(`${kind}\u0000${opId}`).digest('hex')}`.slice(0, 120);

/**
 * Writes one `chain.staking_tx` row per stake / unstake / withdraw / compound / stake_profits / early_exit_fee (the wallet
 * history table and chart of W28-05 read them). A failing history write is logged and never fails the chain action that
 * already happened.
 */
export class StakingTxWriter {
  private readonly log = new Logger(StakingTxWriter.name);

  constructor(private readonly db: () => PrismaClient | null) {}

  async record(entry: StakingTxEntry): Promise<void> {
    const db = this.db();
    if (!db || typeof db.stakingTx?.upsert !== 'function') return;
    const id = stakingTxId(entry.kind, entry.opId);
    try {
      await db.stakingTx.upsert({
        where: { id },
        create: {
          id,
          accountId: entry.accountId,
          poolId: entry.poolId,
          kind: entry.kind,
          asset: entry.asset,
          amountYocto: entry.amountYocto.toString(),
          txHash: entry.txHash,
          createdAt: new Date(entry.atMs),
        },
        update: {},
      });
    } catch (err) {
      this.log.warn(`staking_tx write failed (${entry.kind} ${entry.accountId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
