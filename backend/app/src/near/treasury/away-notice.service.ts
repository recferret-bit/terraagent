import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { NotifierPort } from '../../ports/notifier.port.js';
import { awayMemberColonies } from './away-colonies.js';
import { councilNotice } from './away-notice.js';
import { FINALIZE_POLL_MS } from './finalize-effect.js';
import { daoAccountIdFor, parsePolicy } from './policy.js';

interface CouncilScope {
  readonly planetId: string;
  readonly members: readonly string[];
  readonly openIds: readonly number[];
}

/**
 * Away colonies abstain (W22-16, AW-14). This job never calls `TreasuryDaoPort.vote`.
 * The AI director is not asked. While W09 is on, each away member gets one note for the
 * current open set. W09 off sends nothing. A repeat of the same set does not insert again.
 */
@Injectable()
export class TreasuryAwayNoticeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TreasuryAwayNoticeService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(NotifierPort) private readonly notifier?: NotifierPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  onModuleInit(): void {
    if (!this.flags.has('W22') || !this.prisma || !databaseEnabled(this.env)) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.notifyDue()
        .catch((err: unknown) => this.log.warn(`council away notice: ${errorText(err)}`))
        .finally(() => { this.running = undefined; });
    }, FINALIZE_POLL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Queues council notes for away members. Does not cast a vote. `planetId` limits the scan (tests). */
  async notifyDue(planetId?: string): Promise<{ notified: number }> {
    if (!this.flags.has('W22') || !this.flags.has('W09') || !this.prisma || !this.notifier) return { notified: 0 };
    let notified = 0;
    for (const scope of await this.scopes(planetId)) notified += await this.noticePlanet(scope);
    return { notified };
  }

  private async noticePlanet(scope: CouncilScope): Promise<number> {
    if (!this.prisma || scope.openIds.length === 0) return 0;
    const colonies = await awayMemberColonies(this.prisma, scope.planetId, scope.members);
    let notified = 0;
    for (const colonyId of colonies) {
      if (await this.sendOne(scope, colonyId)) notified += 1;
    }
    return notified;
  }

  private async sendOne(scope: CouncilScope, colonyId: string): Promise<boolean> {
    const note = councilNotice(scope.planetId, colonyId, scope.openIds);
    if (!note || !this.notifier) return false;
    try {
      const result = await this.notifier.send(note);
      return result.status === 'sent' || result.status === 'queued';
    } catch (err) {
      this.log.warn(`council notice ${colonyId}: ${errorText(err)}`);
      return false;
    }
  }

  private async scopes(planetId?: string): Promise<CouncilScope[]> {
    const daoId = planetId ? daoAccountIdFor(planetId) : undefined;
    const daos = await this.prisma!.mockChainDao.findMany({
      where: daoId ? { id: daoId } : undefined,
      include: {
        proposals: { where: { status: 'InProgress' }, select: { id: true }, orderBy: { id: 'asc' } },
      },
    });
    return daos.flatMap((dao) => openScope(dao.policy, dao.proposals, planetId));
  }
}

function openScope(
  policyRaw: unknown,
  proposals: readonly { id: number }[],
  planetId: string | undefined,
): CouncilScope[] {
  if (proposals.length === 0) return [];
  const policy = parsePolicy(policyRaw);
  return [{
    planetId: planetId ?? policy.name,
    members: policy.members.map((member) => member.accountId),
    openIds: proposals.map((row) => row.id),
  }];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
