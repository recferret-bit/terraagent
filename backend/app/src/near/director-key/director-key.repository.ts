import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../core/errors/index.js';
import { PRISMA } from '../../db/db.module.js';
import { fitColonyAccountId } from '../identity/colony-account-id.js';

export interface OwnedColony {
  readonly colonyId: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly colonyIndex: number;
}

export interface DirectorKeyRow {
  readonly colonyId: string;
  readonly accountId: string;
  readonly publicKey: string;
  readonly revokedAt: Date | null;
}

export interface DirectorKeySave {
  readonly colonyId: string;
  readonly accountId: string;
  readonly publicKey: string;
  readonly allowance: string;
  readonly spent: string;
  readonly tokens: unknown;
  readonly revokedAt: Date | null;
}

/** `chain.director_key`. One row per colony. The live ledger is the agent-wallet key. */
@Injectable()
export class DirectorKeyRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async requireOwner(colonyId: string, playerId: string): Promise<OwnedColony> {
    const colony = await this.prisma.colony.findUnique({
      where: { id: colonyId },
      select: { playerId: true, planetId: true, colonyIndex: true },
    });
    if (!colony) throw new CoreException('NOT_FOUND', { status: 404, message: 'Colony not found' });
    if (colony.playerId !== playerId) {
      throw new CoreException('NEAR_NOT_OWNER', { status: 403, message: 'That colony belongs to another player' });
    }
    return { colonyId, playerId, planetId: colony.planetId, colonyIndex: colony.colonyIndex };
  }

  /** Colony row for a dev allowance change. Does not check the caller. */
  async locate(colonyId: string): Promise<OwnedColony | null> {
    const colony = await this.prisma.colony.findUnique({
      where: { id: colonyId },
      select: { playerId: true, planetId: true, colonyIndex: true },
    });
    if (!colony) return null;
    return { colonyId, playerId: colony.playerId, planetId: colony.planetId, colonyIndex: colony.colonyIndex };
  }

  async find(colonyId: string): Promise<DirectorKeyRow | null> {
    const row = await this.prisma.directorKey.findUnique({ where: { colonyId } });
    if (!row) return null;
    return { colonyId: row.colonyId, accountId: row.accountId, publicKey: row.publicKey, revokedAt: row.revokedAt };
  }

  /** Colony chain account when one exists, otherwise `{colony}.dir.terraagent.mock`. */
  async accountIdFor(colonyId: string): Promise<string> {
    const row = await this.prisma.nearColonyAccount.findFirst({
      where: { OR: [{ colonyId }, { slot: colonyId }] },
      select: { accountId: true },
    });
    if (row) return row.accountId;
    try {
      return fitColonyAccountId(colonyId, 'dir');
    } catch {
      throw new CoreException('INVALID_REQUEST', { status: 400, message: 'Colony id cannot form a chain account' });
    }
  }

  async save(row: DirectorKeySave): Promise<void> {
    const data = {
      accountId: row.accountId,
      publicKey: row.publicKey,
      allowance: row.allowance,
      spent: row.spent,
      tokens: JSON.parse(JSON.stringify(row.tokens)) as Prisma.InputJsonValue,
      revokedAt: row.revokedAt,
    };
    await this.prisma.directorKey.upsert({
      where: { colonyId: row.colonyId },
      create: { colonyId: row.colonyId, ...data },
      update: data,
    });
  }
}
