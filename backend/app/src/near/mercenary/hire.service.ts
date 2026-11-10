import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BountyReward, BountyTarget, type SimCommandV1 } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { toCargoBaseUnits, fromCargoBaseUnits } from '../application/ports/cargo-token.port.js';
import { EscrowPort } from '../application/ports/escrow.port.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { opId } from '../application/outbox/op-id.js';
import { BountyRepository } from '../bounty/bounty.repository.js';
import { BountyPostError } from '../bounty/errors.js';
import { BountyPostService, type BountyPostInput } from '../bounty/post.service.js';
import { expiryScreen, HOUR_MS } from '../bounty/validate.js';
import type { BountyRow } from '../bounty/view.js';
import { FlagsService } from '../../flags/flags.service.js';
import { W22TelemetryService } from '../telemetry/w22-telemetry.service.js';
import { quoteHire, refundSplit, type HireQuote, type RefundSplit } from './hire-math.js';
import { mercenaryRoster } from './roster.js';
import { submitSpawn, type MercenaryPlanetHost } from './spawn-submit.js';

interface WaveFlags {
  has(wave: string): boolean;
}

export interface MercenaryHireInput {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly accountId: string;
  readonly rosterId: string;
  readonly hours: number;
  readonly q: number;
  readonly r: number;
  readonly radius?: number;
  readonly bountyId?: string;
  readonly nowMs?: number;
}

export interface MercenaryHireResult {
  readonly bountyId: string;
  readonly rosterId: string;
  readonly mercenaryAccountId: string;
  readonly resource: string;
  readonly pricePerGameHour: number;
  readonly hours: number;
  readonly total: number;
  readonly escrowId: string;
  readonly claimerAccountId: string;
  readonly spawn: SimCommandV1;
}

export interface MercenaryCancelInput {
  readonly bountyId: string;
  readonly nowMs: number;
}

export interface MercenaryCancelResult {
  readonly bountyId: string;
  readonly refunded: number;
  readonly paid: number;
  readonly escrowId: string;
}

/**
 * Hires a roster squad as a `defend_area` bounty with that account as the reserved claimer (W22-28).
 * Escrow is `hours * pricePerGameHour`. Cancel floors the served metals and refunds the rest.
 * W22 off rejects the hire. The squad command is posted when the planet host has the world loaded.
 */
@Injectable()
export class MercenaryHireService {
  private readonly log = new Logger(MercenaryHireService.name);

  constructor(
    @Inject(BountyPostService) private readonly posts: BountyPostService,
    @Inject(BountyRepository) private readonly bounties: BountyRepository,
    @Inject(EscrowPort) private readonly escrow: EscrowPort,
    @Inject(ChainOutboxRepository) private readonly outbox: ChainOutboxRepository,
    @Inject(FlagsService) private readonly flags: WaveFlags,
    @Optional() @Inject(GamePlanets) private readonly planets?: MercenaryPlanetHost,
    @Optional() @Inject(W22TelemetryService) private readonly telemetry?: W22TelemetryService,
  ) {}

  async hire(input: MercenaryHireInput): Promise<MercenaryHireResult> {
    this.assertEnabled();
    const quote = this.quote(input);
    const now = input.nowMs ?? Date.now();
    const expiry = this.expiry(quote, now);
    const area = this.area(input);
    await this.assertCap(quote);
    const prior = input.bountyId ? await this.bounties.find(input.bountyId) : null;
    const posted = await this.posts.post(this.postBody(input, quote, area, expiry));
    await this.bounties.reserveClaimer(posted.id, quote.accountId);
    if (!prior) await this.telemetry?.mercenaryHired();
    const spawn = await this.spawn(input, quote, area, posted.id);
    return {
      bountyId: posted.id,
      rosterId: quote.rosterId,
      mercenaryAccountId: quote.accountId,
      resource: quote.resource,
      pricePerGameHour: quote.pricePerGameHour,
      hours: quote.hours,
      total: quote.total,
      escrowId: posted.escrowId,
      claimerAccountId: quote.accountId,
      spawn,
    };
  }

  async cancel(input: MercenaryCancelInput): Promise<MercenaryCancelResult> {
    this.assertEnabled();
    const row = await this.requireHire(input.bountyId);
    const refundOp = opId('merc-refund', row.id);
    const prior = await this.outbox.find(refundOp);
    if (prior?.status === 'DONE') return this.replay(row, prior.payload);
    const split = this.split(row, input.nowMs);
    await this.refund(row, refundOp, split);
    await this.bounties.markRefunded(row.id);
    return { bountyId: row.id, refunded: split.refunded, paid: split.paid, escrowId: row.escrowId };
  }

  private quote(input: MercenaryHireInput): HireQuote {
    const quote = quoteHire(this.flags, input.rosterId, input.hours);
    if (!quote) throw new BountyPostError({ code: 'invalid_args', detail: 'Mercenary roster or hours are invalid' });
    const reward = BountyReward.safeParse({ resource: quote.resource, amount: quote.total });
    if (!reward.success) throw new BountyPostError({ code: 'invalid_args', detail: 'Mercenary price is not Tier-1 cargo' });
    return quote;
  }

  private expiry(quote: HireQuote, now: number): number {
    const expiresAt = now + quote.hours * HOUR_MS;
    const problem = expiryScreen(expiresAt, now);
    if (problem) throw new BountyPostError(problem);
    return expiresAt;
  }

  private spawn(
    input: MercenaryHireInput,
    quote: HireQuote,
    area: { q: number; r: number; radius: number },
    bountyId: string,
  ): Promise<SimCommandV1> {
    return submitSpawn(
      this.planets,
      input.planetId,
      { ...area, colonyIndex: input.colonyIndex, bountyId, rosterId: quote.rosterId, count: quote.count, hours: quote.hours },
      (message) => this.log.warn(message),
    );
  }

  private area(input: MercenaryHireInput): { q: number; r: number; radius: number } {
    const radius = input.radius ?? 1;
    if (!Number.isInteger(input.q) || !Number.isInteger(input.r) || !Number.isInteger(radius) || radius < 1 || radius > 8) {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Defend area is invalid' });
    }
    return { q: input.q, r: input.r, radius };
  }

  private async assertCap(quote: HireQuote): Promise<void> {
    const open = await this.bounties.claimedReward(quote.accountId, quote.resource);
    if (open + quote.total > quote.fundingCap) {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Hire exceeds the mercenary funding cap' });
    }
  }

  private postBody(input: MercenaryHireInput, quote: HireQuote, area: { q: number; r: number; radius: number }, expiresAt: number): BountyPostInput {
    return {
      planetId: input.planetId,
      colonyId: input.colonyId,
      colonyIndex: input.colonyIndex,
      accountId: input.accountId,
      bountyId: input.bountyId,
      nowMs: input.nowMs,
      playerPost: false,
      args: {
        target: { kind: 'defend_area', ...area, durationH: quote.hours },
        reward: BountyReward.parse({ resource: quote.resource, amount: quote.total }),
        expiresAt,
      },
    };
  }

  private async requireHire(bountyId: string): Promise<BountyRow> {
    const row = await this.bounties.find(bountyId);
    const known = mercenaryRoster(this.flags).some((entry) => entry.accountId === row?.claimerAccountId);
    if (!row || !known) throw new BountyPostError({ code: 'invalid_args', detail: 'Bounty is not a mercenary hire' });
    return row;
  }

  private split(row: BountyRow, nowMs: number): RefundSplit {
    const target = BountyTarget.parse(row.target);
    const reward = BountyReward.parse(row.reward);
    if (target.kind !== 'defend_area') {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Bounty is not a defend contract' });
    }
    return refundSplit(reward.amount, target.durationH, row.expiresAt.getTime() - target.durationH * HOUR_MS, nowMs);
  }

  private async refund(row: BountyRow, refundOp: string, split: RefundSplit): Promise<void> {
    const body = { escrowId: row.escrowId, caller: row.accountId, amount: toCargoBaseUnits(split.refunded) };
    await this.outbox.enqueue({ opId: refundOp, port: 'Escrow', method: 'refund', payload: body });
    try {
      const receipt = await this.escrow.refund({ opId: refundOp, ...body });
      await this.outbox.markDoneByOpId(refundOp, receipt, receipt.txHash).catch(() => false);
    } catch (err) {
      await this.outbox.abandon(refundOp).catch(() => undefined);
      throw err;
    }
  }

  private async replay(row: BountyRow, payload: unknown): Promise<MercenaryCancelResult> {
    await this.bounties.markRefunded(row.id);
    const refunded = refundMajor(payload);
    const total = BountyReward.parse(row.reward).amount;
    return { bountyId: row.id, refunded, paid: total - refunded, escrowId: row.escrowId };
  }

  private assertEnabled(): void {
    if (!this.flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}

function refundMajor(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const amount = (payload as { amount?: unknown }).amount;
  return typeof amount === 'string' ? fromCargoBaseUnits(amount) : 0;
}
