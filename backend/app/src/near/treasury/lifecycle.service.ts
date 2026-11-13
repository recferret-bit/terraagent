import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { TreasuryDaoPort } from '../application/ports/treasury-dao.port.js';
import { daoCreateOpId } from './lifecycle.js';
import { daoAccountIdFor } from './policy.js';

/** A planet treasury that exists (created now, or already there). */
export interface EnsuredPlanetDao {
  readonly planetId: string;
  readonly daoAccountId: string;
  readonly opId: string;
}

/**
 * Opens `{planetId}`'s treasury DAO once (`opId = dao-create:{planetId}`).
 * The council starts empty. `PlanetDaoMembershipService` adds colony accounts.
 */
@Injectable()
export class PlanetDaoLifecycleService {
  private readonly inflight = new Map<string, Promise<EnsuredPlanetDao | null>>();

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(TreasuryDaoPort) private readonly dao: TreasuryDaoPort,
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  /**
   * Creates the planet DAO, or returns the one already stored. `null` when W22 is off.
   * W22-08 calls this from `GET /v1/near/treasury/:planetId`.
   */
  ensurePlanetDao(planetId: string): Promise<EnsuredPlanetDao | null> {
    const id = planetId.trim();
    if (!id || !this.chainReady()) return Promise.resolve(null);
    const running = this.inflight.get(id);
    if (running) return running;
    const job = this.open(id).finally(() => { this.inflight.delete(id); });
    this.inflight.set(id, job);
    return job;
  }

  private chainReady(): boolean {
    if (!this.flags.has('W22') || !this.prisma) return false;
    return this.env === undefined || databaseEnabled(this.env);
  }

  private async open(planetId: string): Promise<EnsuredPlanetDao> {
    const op = daoCreateOpId(planetId);
    const daoAccountId = daoAccountIdFor(planetId, this.env as Record<string, string | undefined> | undefined);
    const existing = await this.readId(daoAccountId);
    if (existing) return { planetId, daoAccountId: existing, opId: op };
    await this.enqueue(op, planetId);
    try {
      const created = await this.dao.createDao({ opId: op, name: planetId, councilAccountIds: [] });
      await this.outbox?.markDoneByOpId(op, created, created.receipt.txHash);
      return { planetId, daoAccountId: created.daoAccountId, opId: op };
    } catch (err) {
      const raced = await this.readId(daoAccountId);
      if (raced && isUniqueConflict(err)) return { planetId, daoAccountId: raced, opId: op };
      throw err;
    }
  }

  private async readId(daoAccountId: string): Promise<string | null> {
    const row = await this.prisma?.mockChainDao.findUnique({ where: { id: daoAccountId }, select: { id: true } });
    return row?.id ?? null;
  }

  private enqueue(op: string, planetId: string): Promise<unknown> {
    if (!this.outbox) return Promise.resolve();
    return this.outbox.enqueue({
      opId: op,
      port: 'TreasuryDao',
      method: 'createDao',
      payload: { name: planetId, councilAccountIds: [] },
    });
  }
}

function isUniqueConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}
