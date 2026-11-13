import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { TreasuryDaoPort } from '../application/ports/treasury-dao.port.js';
import { PlanetDaoLifecycleService } from './lifecycle.service.js';
import { daoMemberOpId, daoMemberRemoveOpId, daoMemberSettledOpId } from './membership.js';
import { daoAccountIdFor } from './policy.js';

/** How long `colonyFounded` waits for `near_colony_account` (ColonyAccounts writes it on the same event). */
const LOOKUPS = 8;
const LOOKUP_MS = 25;

/**
 * Colony accounts on the planet DAO (W22-06, NEAR-100).
 * Founding adds a proposing member. Elimination removes them. `deedSettled` keeps the row and clears `canPropose`.
 * W22 off does nothing. A colony with no account row is not a member.
 */
@Injectable()
export class PlanetDaoMembershipService {
  private readonly log = new Logger(PlanetDaoMembershipService.name);
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(PlanetDaoLifecycleService) private readonly lifecycle: PlanetDaoLifecycleService,
    @Inject(TreasuryDaoPort) private readonly dao: TreasuryDaoPort,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
  ) {}

  onFounded(planetId: string, colonyId: string): void {
    const id = colonyId.trim();
    if (!id) return;
    this.schedule(planetId, () => this.add(planetId, id, true, daoMemberOpId(planetId, id)));
  }

  onEliminated(planetId: string, colonyId: string): void {
    const id = colonyId.trim();
    if (!id) return;
    this.schedule(planetId, () => this.drop(planetId, id));
  }

  onSettled(planetId: string, colonyId: string): void {
    const id = colonyId.trim();
    if (!id) return;
    this.schedule(planetId, () => this.add(planetId, id, false, daoMemberSettledOpId(planetId, id)));
  }

  private schedule(planetId: string, job: () => Promise<void>): void {
    const prev = this.tails.get(planetId) ?? Promise.resolve();
    const next = prev.then(job).catch((err: unknown) => {
      this.log.warn(`dao membership failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.tails.set(planetId, next);
    void next.finally(() => {
      if (this.tails.get(planetId) === next) this.tails.delete(planetId);
    });
  }

  private ready(): boolean {
    if (!this.flags.has('W22') || !this.prisma) return false;
    return this.env === undefined || databaseEnabled(this.env);
  }

  private async add(planetId: string, colonyId: string, canPropose: boolean, op: string): Promise<void> {
    if (!this.ready()) return;
    const ensured = await this.lifecycle.ensurePlanetDao(planetId);
    if (!ensured) return;
    const member = await this.colonyAccount(colonyId, true);
    if (!member) return;
    if (canPropose && (await this.silent(ensured.daoAccountId, member))) return;
    const payload = { daoAccountId: ensured.daoAccountId, member, canPropose };
    await this.note(op, 'addMember', payload);
    const receipt = await this.dao.addMember({ opId: op, ...payload });
    await this.outbox?.markDoneByOpId(op, receipt, receipt.txHash);
  }

  private async drop(planetId: string, colonyId: string): Promise<void> {
    if (!this.ready()) return;
    const member = await this.colonyAccount(colonyId, false);
    if (!member) return;
    const daoAccountId = daoAccountIdFor(planetId, this.env as Record<string, string | undefined> | undefined);
    const row = await this.prisma?.mockChainDao.findUnique({ where: { id: daoAccountId }, select: { id: true } });
    if (!row) return;
    const op = daoMemberRemoveOpId(planetId, colonyId);
    const payload = { daoAccountId, member };
    await this.note(op, 'removeMember', payload);
    try {
      const receipt = await this.dao.removeMember({ opId: op, ...payload });
      await this.outbox?.markDoneByOpId(op, receipt, receipt.txHash);
    } catch (err) {
      if (!isMissingDao(err)) throw err;
    }
  }

  /** A settled colony stays a member. A later founding event must not give propose rights back. */
  private async silent(daoAccountId: string, member: string): Promise<boolean> {
    const view = await this.dao.get({ daoAccountId });
    return view.members.some((row) => row.accountId === member && row.canPropose === false);
  }

  private async colonyAccount(colonyId: string, wait: boolean): Promise<string | null> {
    const tries = wait ? LOOKUPS : 1;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const found = await this.lookup(colonyId);
      if (found) return found;
      if (attempt + 1 < tries) await delay(LOOKUP_MS);
    }
    return null;
  }

  private lookup(colonyId: string): Promise<string | null> {
    const prisma = this.prisma;
    if (!prisma) return Promise.resolve(null);
    return prisma.nearColonyAccount.findFirst({
      where: { colonyId },
      select: { accountId: true },
    }).then((row) => row?.accountId ?? null);
  }

  private note(op: string, method: string, payload: object): Promise<unknown> {
    if (!this.outbox) return Promise.resolve();
    return this.outbox.enqueue({ opId: op, port: 'TreasuryDao', method, payload });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingDao(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { errorCode?: unknown }).errorCode === 'DAO_NOT_FOUND';
}
