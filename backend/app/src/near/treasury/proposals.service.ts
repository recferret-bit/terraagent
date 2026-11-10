import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { EventBus } from '../../bus/event-bus.js';
import { AuthTokenService } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { TreasuryDaoPort, type DaoView } from '../application/ports/treasury-dao.port.js';
import type { ChainReceipt } from '../domain/types.js';
import { NearException } from '../domain/errors.js';
import { accountIsAway } from './away-colonies.js';
import { resolveColonyAccount } from './caller.js';
import { proposalDeadlineMs, TREASURY_COST_TOKEN, treasuryProject } from './costs.js';
import {
  proposalBusEvent,
  storedProposalMeta,
  toCouncil,
  toProposal,
  type StoredProposalMeta,
  type TreasuryCouncilResponse,
  type TreasuryProposalResponse,
} from './council-view.js';
import { PlanetDaoLifecycleService, type EnsuredPlanetDao } from './lifecycle.service.js';
import {
  assertNoOpenProposal,
  assertNotVoted,
  daoProposeOpId,
  daoVoteOpId,
  parseProposeBody,
  parseProposalId,
  parseVoteBody,
  proposeSeq,
} from './proposals.js';

/**
 * Planet council reads and votes (W22-08). Passing a vote debits through the DAO port.
 * `TreasuryFinalizeService` owns the 6 h deadline and posts `system.treasuryEffect` once (W22-09).
 * An away colony abstains (W22-16, AW-14): `vote` rejects `away_policy` and writes nothing.
 * No job and no director casts a vote for them. `TreasuryAwayNoticeService` only queues a W09 note.
 */
@Injectable()
export class TreasuryProposalsService {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(PlanetDaoLifecycleService) private readonly lifecycle: PlanetDaoLifecycleService,
    @Inject(TreasuryDaoPort) private readonly dao: TreasuryDaoPort,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
  ) {}

  async council(planetId: string): Promise<TreasuryCouncilResponse> {
    const ensured = await this.requireDao(planetId);
    const view = await this.dao.get({ daoAccountId: ensured.daoAccountId });
    return toCouncil(planetId, view, await this.metaOf(ensured.daoAccountId), this.flags.flags);
  }

  async propose(planetId: string, raw: unknown, req: IncomingMessage): Promise<TreasuryProposalResponse> {
    const body = parseProposeBody(raw);
    const accountId = await this.account(req, raw, planetId);
    const project = treasuryProject(this.flags.flags, body.kind);
    if (!project) throw new CoreException('invalid_args', { status: 400, message: 'Unknown council project.' });
    const ensured = await this.requireDao(planetId);
    const view = await this.dao.get({ daoAccountId: ensured.daoAccountId });
    assertNoOpenProposal(view, accountId);
    const deadlineMs = proposalDeadlineMs(this.flags.flags, Date.now());
    const payload = { cost: project.cost, tokenId: TREASURY_COST_TOKEN, deadlineMs };
    const op = daoProposeOpId(planetId, accountId, proposeSeq(view, accountId));
    const created = await this.runChain(op, 'propose', { ...payload, kind: project.kind, proposer: accountId }, () => this.dao.propose({
      opId: op,
      daoAccountId: ensured.daoAccountId,
      proposer: accountId,
      description: body.description ?? project.kind,
      kind: project.kind,
      payload,
    }));
    return this.publish(planetId, ensured.daoAccountId, created.proposalId);
  }

  async vote(planetId: string, id: string, raw: unknown, req: IncomingMessage): Promise<TreasuryProposalResponse> {
    const vote = parseVoteBody(raw);
    const proposalId = parseProposalId(id);
    const accountId = await this.account(req, raw, planetId);
    if (await this.callerIsAway(planetId, accountId)) {
      throw new CoreException('away_policy', {
        status: 409,
        message: 'Away colonies abstain from council votes.',
        details: { rule: 'AW-14' },
      });
    }
    const ensured = await this.requireDao(planetId);
    const view = await this.dao.get({ daoAccountId: ensured.daoAccountId });
    assertNotVoted(view, proposalId, accountId);
    const op = daoVoteOpId(planetId, proposalId, accountId);
    await this.runChain(op, 'vote', { proposalId, voter: accountId, vote }, async () => {
      const receipt = await this.dao.vote({ opId: op, daoAccountId: ensured.daoAccountId, proposalId, voter: accountId, vote });
      return { receipt };
    });
    return this.publish(planetId, ensured.daoAccountId, proposalId);
  }

  /** Open away digest for this account. No colony row means present, so existing votes still land. */
  private callerIsAway(planetId: string, accountId: string): Promise<boolean> {
    if (!this.prisma) return Promise.resolve(false);
    return accountIsAway(this.prisma, planetId, accountId);
  }

  private account(req: IncomingMessage, body: unknown, planetId: string): Promise<string> {
    return resolveColonyAccount({
      req, body, planetId, nodeEnv: this.env?.NODE_ENV, prisma: this.prisma, tokens: this.tokens,
    });
  }

  private async requireDao(planetId: string): Promise<EnsuredPlanetDao> {
    const ensured = await this.lifecycle.ensurePlanetDao(planetId.trim());
    if (!ensured) throw new NearException('DAO_NOT_FOUND', { details: { planetId } });
    return ensured;
  }

  private async runChain<T extends { receipt: ChainReceipt }>(
    op: string,
    method: string,
    payload: object,
    run: () => Promise<T>,
  ): Promise<T> {
    await this.outbox?.enqueue({ opId: op, port: 'TreasuryDao', method, payload });
    const result = await this.ran(op, run);
    await this.outbox?.markDoneByOpId(op, result, result.receipt.txHash);
    return result;
  }

  private async ran<T>(op: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      await this.outbox?.abandon(op);
      throw err;
    }
  }

  private async publish(planetId: string, daoAccountId: string, proposalId: number): Promise<TreasuryProposalResponse> {
    const view = await this.dao.get({ daoAccountId });
    const meta = await this.metaOf(daoAccountId);
    const row = view.proposals.find((proposal) => proposal.proposalId === proposalId);
    if (!row) throw new NearException('DAO_NOT_FOUND', { details: { proposalId } });
    const response = toProposal(row, meta.get(proposalId), this.flags.flags);
    this.emit(planetId, view, proposalId, response.cost, response.deadlineMs);
    return response;
  }

  private emit(planetId: string, view: DaoView, proposalId: number, cost: string, deadlineMs: number): void {
    const event = proposalBusEvent(planetId, view, proposalId, cost, deadlineMs);
    if (event) this.bus?.emit('near.treasury.proposal', event);
  }

  private async metaOf(daoAccountId: string): Promise<Map<number, StoredProposalMeta>> {
    const map = new Map<number, StoredProposalMeta>();
    if (!this.prisma) return map;
    const rows = await this.prisma.mockChainDaoProposal.findMany({
      where: { daoId: daoAccountId },
      select: { id: true, kind: true },
    });
    for (const row of rows) map.set(row.id, storedProposalMeta(row.kind));
    return map;
  }
}
