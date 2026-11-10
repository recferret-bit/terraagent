import { Inject, Injectable } from '@nestjs/common';
import type { BountyReward, BountyTarget } from '@terra/contracts';
import { Prisma, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import type { BountyRow } from './view.js';

const ACTIVE = ['open', 'claimed'] as const;

export interface NewBountyRow {
  readonly id: string;
  readonly planetId: string;
  readonly posterColonyId: string;
  readonly colonyIndex: number;
  readonly accountId: string;
  readonly target: BountyTarget;
  readonly reward: BountyReward;
  readonly escrowId: string;
  readonly escrowTx: string;
  readonly opId: string;
  readonly expiresAt: number;
}

/** `chain.bounty` rows. Active means `open` or `claimed`. */
@Injectable()
export class BountyRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  find(id: string): Promise<BountyRow | null> {
    return this.prisma.chainBounty.findUnique({ where: { id } });
  }

  list(planetId: string): Promise<BountyRow[]> {
    return this.prisma.chainBounty.findMany({ where: { planetId }, orderBy: { createdAt: 'asc' } });
  }

  countActive(colonyId: string): Promise<number> {
    return this.prisma.chainBounty.count({ where: { posterColonyId: colonyId, state: { in: [...ACTIVE] } } });
  }

  /** `completed` rows that still have a claimer. Boot repay uses this after a crash mid-payout. */
  completed(): Promise<BountyRow[]> {
    return this.prisma.chainBounty.findMany({
      where: { state: 'completed', claimerAccountId: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * One column. `replace` is only for `clear_nest`, which may have several claimers;
   * defend and deliver keep the first caller (`queue_full` otherwise).
   */
  async markClaimed(id: string, accountId: string, replace: boolean): Promise<boolean> {
    const claimer = replace ? {} : { OR: [{ claimerAccountId: null }, { claimerAccountId: accountId }] };
    const result = await this.prisma.chainBounty.updateMany({
      where: { id, state: { in: [...ACTIVE] }, ...claimer },
      data: { state: 'claimed', claimerAccountId: accountId },
    });
    return result.count === 1;
  }

  /** Winner and `completed` in one write, so a crash before pay is retried from `completed()`. */
  async completeForPayout(id: string, accountId: string): Promise<boolean> {
    const result = await this.prisma.chainBounty.updateMany({
      where: { id, state: { in: [...ACTIVE] } },
      data: { state: 'completed', claimerAccountId: accountId },
    });
    return result.count === 1;
  }

  async markPaid(id: string): Promise<boolean> {
    const result = await this.prisma.chainBounty.updateMany({
      where: { id, state: 'completed' },
      data: { state: 'paid' },
    });
    return result.count === 1;
  }

  insert(row: NewBountyRow): Promise<BountyRow> {
    return this.prisma.chainBounty.create({
      data: {
        id: row.id,
        planetId: row.planetId,
        posterColonyId: row.posterColonyId,
        colonyIndex: row.colonyIndex,
        accountId: row.accountId,
        target: row.target as Prisma.InputJsonValue,
        reward: row.reward as Prisma.InputJsonValue,
        escrowId: row.escrowId,
        escrowTx: row.escrowTx,
        opId: row.opId,
        state: 'open',
        expiresAt: new Date(row.expiresAt),
      },
    });
  }
}
