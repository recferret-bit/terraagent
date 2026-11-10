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
