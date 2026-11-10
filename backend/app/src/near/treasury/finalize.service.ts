import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TreasuryEffectKind, type SimCommandV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { withTransaction } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { opId } from '../application/outbox/op-id.js';
import { TreasuryDaoPort } from '../application/ports/treasury-dao.port.js';
import { treasuryProject } from './costs.js';
import { proposalBusEvent, storedProposalMeta, toProposal } from './council-view.js';
import {
  EMPTY_FINALIZE,
  FINALIZE_POLL_MS,
  deadlineMsOf,
  effectUntilTick,
  treasuryEffectCommand,
  type FinalizeDueResult,
  type TreasurySimPort,
} from './finalize-effect.js';
import { GuildSubsidyService } from './guild-subsidy.js';
import { daoAccountIdFor, parsePolicy, readProposal } from './policy.js';
import { claimProposalEffect } from './store.js';

interface ProposalRow {
  readonly id: number;
  readonly status: string;
  readonly kind: unknown;
  readonly proposer: string;
  readonly votes: unknown;
  readonly submitTime: Date;
}

interface DaoScope {
  readonly planetId: string;
  readonly daoAccountId: string;
  readonly proposals: readonly ProposalRow[];
}

/**
 * Deadline clock for council proposals (W22-09). The mock `finalize` still expires as soon as it is called;
 * this job does not call it before `deadlineMs` (`proposalTtlH`, 6 real hours). W22 off does nothing.
 */
@Injectable()
export class TreasuryFinalizeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TreasuryFinalizeService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(TreasuryDaoPort) private readonly dao: TreasuryDaoPort,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(GuildSubsidyService) private readonly guild?: GuildSubsidyService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
    @Optional() @Inject(GamePlanets) private readonly planets?: TreasurySimPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  onModuleInit(): void {
    if (!this.flags.has('W22') || !this.prisma || !databaseEnabled(this.env)) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.finalizeDue(Date.now())
        .catch((err: unknown) => this.log.warn(`treasury finalize poll: ${errorText(err)}`))
        .finally(() => { this.running = undefined; });
    }, FINALIZE_POLL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Finalizes due proposals and posts each Approved effect once. `planetId` limits the scan (tests). */
  async finalizeDue(nowMs: number, planetId?: string): Promise<FinalizeDueResult> {
    if (!this.flags.has('W22') || !this.prisma) return EMPTY_FINALIZE;
    const totals = { expired: 0, approved: 0, effects: 0 };
    for (const scope of await this.scopes(planetId)) {
      for (const row of scope.proposals) {
        const part = await this.safeSettle(scope, row, nowMs);
        totals.expired += part.expired;
        totals.approved += part.approved;
        totals.effects += part.effects;
      }
    }
    return totals;
  }

  private async safeSettle(scope: DaoScope, row: ProposalRow, nowMs: number): Promise<FinalizeDueResult> {
    try {
      return await this.settle(scope, row, nowMs);
    } catch (err) {
      this.log.warn(`treasury finalize ${scope.daoAccountId}#${row.id}: ${errorText(err)}`);
      return EMPTY_FINALIZE;
    }
  }

  private async settle(scope: DaoScope, row: ProposalRow, nowMs: number): Promise<FinalizeDueResult> {
    const before = row.status;
    if (before === 'InProgress' && nowMs >= deadlineMsOf(row.kind, row.submitTime.getTime(), this.flags.flags)) {
      await this.finalizeChain(scope.daoAccountId, row.id);
    }
    const fresh = await this.reload(scope.daoAccountId, row.id);
    if (!fresh) return EMPTY_FINALIZE;
    if (fresh.status === 'Expired' && before === 'InProgress') {
      await this.emitExpired(scope, fresh);
      return { expired: 1, approved: 0, effects: 0 };
    }
    if (fresh.status !== 'Approved') return EMPTY_FINALIZE;
    const effects = (await this.sendEffect(scope, fresh, nowMs)) ? 1 : 0;
    if (before === 'InProgress') await this.emitPush(scope, fresh.id);
    return { expired: 0, approved: before === 'InProgress' ? 1 : 0, effects };
  }

  private async finalizeChain(daoAccountId: string, proposalId: number): Promise<void> {
    const op = opId('dao-finalize', daoAccountId, proposalId);
    await this.outbox?.enqueue({ opId: op, port: 'TreasuryDao', method: 'finalize', payload: { daoAccountId, proposalId } });
    try {
      const receipt = await this.dao.finalize({ opId: op, daoAccountId, proposalId });
      await this.outbox?.markDoneByOpId(op, receipt, receipt.txHash);
    } catch (err) {
      await this.outbox?.abandon(op);
      throw err;
    }
  }

  private async sendEffect(scope: DaoScope, row: ProposalRow, nowMs: number): Promise<boolean> {
    const parsed = readProposal(row);
    if (parsed.effectPosted || !this.prisma) return false;
    const project = treasuryProject(this.flags.flags, parsed.kind);
    if (!project) return false;
    const command = treasuryEffectCommand(project, effectUntilTick(await this.tickOf(scope.planetId), project.durationH));
    const won = await withTransaction(this.prisma, (tx) => claimProposalEffect(tx, scope.daoAccountId, row.id, command));
    if (!won) return false;
    await this.post(scope.planetId, command);
    if (project.kind === 'guild_subsidy') await this.subsidize(scope.planetId, nowMs);
    this.emitPassed(scope, row.id, project.kind, project.cost);
    return true;
  }

  private async post(planetId: string, command: SimCommandV1): Promise<void> {
    if (!this.planets) {
      this.log.warn(`treasury effect for ${planetId} is stored on the proposal; no sim port`);
      return;
    }
    try {
      const out = await this.planets.submit(planetId, command);
      if (!out.ok) this.log.warn(`treasury effect not applied on ${planetId}: ${out.code ?? 'rejected'}`);
    } catch (err) {
      this.log.warn(`treasury effect submit failed on ${planetId}: ${errorText(err)}`);
    }
  }

  private async subsidize(planetId: string, nowMs: number): Promise<void> {
    try {
      await this.guild?.applyGuildSubsidy(planetId, new Date(nowMs));
    } catch (err) {
      this.log.warn(`guild subsidy ${planetId}: ${errorText(err)}`);
    }
  }

  private async tickOf(planetId: string): Promise<number> {
    const live = await this.liveTick(planetId);
    if (live !== null) return live;
    const snap = await this.prisma?.planetSnapshot.findFirst({
      where: { planetId },
      orderBy: { tick: 'desc' },
      select: { tick: true },
    });
    return snap ? Number(snap.tick) : 0;
  }

  private async liveTick(planetId: string): Promise<number | null> {
    if (!this.planets?.isLoaded?.(planetId) || !this.planets.fullState) return null;
    try {
      const state = await this.planets.fullState(planetId, 500);
      return typeof state.tick === 'number' && state.tick >= 0 ? state.tick : null;
    } catch {
      return null;
    }
  }

  private async scopes(planetId?: string): Promise<DaoScope[]> {
    const daoId = planetId ? daoAccountIdFor(planetId) : undefined;
    const daos = await this.prisma!.mockChainDao.findMany({
      where: daoId ? { id: daoId } : undefined,
      include: { proposals: { orderBy: { id: 'asc' } } },
    });
    return daos.map((dao) => ({
      planetId: parsePolicy(dao.policy).name,
      daoAccountId: dao.id,
      proposals: dao.proposals,
    }));
  }

  private reload(daoAccountId: string, proposalId: number): Promise<ProposalRow | null> {
    return this.prisma!.mockChainDaoProposal.findUnique({ where: { daoId_id: { daoId: daoAccountId, id: proposalId } } });
  }

  private async emitExpired(scope: DaoScope, row: ProposalRow): Promise<void> {
    const kind = TreasuryEffectKind.safeParse(readProposal(row).kind);
    if (kind.success) {
      this.bus?.emit('planet.event', {
        planetId: scope.planetId,
        tick: 0,
        kind: 'treasuryProposalFailed',
        severity: 'warn',
        colonyIds: [],
        data: { planetId: scope.planetId, daoAccountId: scope.daoAccountId, proposalId: row.id, kind: kind.data, reason: 'expired' },
      });
    }
    await this.emitPush(scope, row.id);
  }

  private emitPassed(scope: DaoScope, proposalId: number, kind: string, cost: string): void {
    const parsed = TreasuryEffectKind.safeParse(kind);
    if (!parsed.success) return;
    this.bus?.emit('planet.event', {
      planetId: scope.planetId,
      tick: 0,
      kind: 'treasuryProposalPassed',
      severity: 'info',
      colonyIds: [],
      data: { planetId: scope.planetId, daoAccountId: scope.daoAccountId, proposalId, kind: parsed.data, cost },
    });
  }

  private async emitPush(scope: DaoScope, proposalId: number): Promise<void> {
    if (!this.bus) return;
    const view = await this.dao.get({ daoAccountId: scope.daoAccountId });
    const row = view.proposals.find((proposal) => proposal.proposalId === proposalId);
    const stored = await this.reload(scope.daoAccountId, proposalId);
    if (!row || !stored) return;
    const response = toProposal(row, storedProposalMeta(stored.kind), this.flags.flags);
    const event = proposalBusEvent(scope.planetId, view, proposalId, response.cost, response.deadlineMs);
    if (event) this.bus.emit('near.treasury.proposal', event);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
