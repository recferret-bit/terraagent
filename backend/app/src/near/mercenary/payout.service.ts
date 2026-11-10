import { Inject, Injectable } from '@nestjs/common';
import { BountyReward, BountyTarget } from '@terra/contracts';
import { fromCargoBaseUnits, toCargoBaseUnits } from '../application/ports/cargo-token.port.js';
import { EscrowPort, type EscrowView } from '../application/ports/escrow.port.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { opId } from '../application/outbox/op-id.js';
import { BountyRepository } from '../bounty/bounty.repository.js';
import { BountyPostError } from '../bounty/errors.js';
import { bountyPayOpId, HOUR_MS } from '../bounty/validate.js';
import type { BountyRow } from '../bounty/view.js';
import { FlagsService } from '../../flags/flags.service.js';
import { refundSplit, type RefundSplit } from './hire-math.js';
import { mercenaryRoster } from './roster.js';

interface WaveFlags {
  has(wave: string): boolean;
}

export interface MercenaryPayoutInput {
  readonly bountyId: string;
  readonly nowMs: number;
  /** `ended` pays the full window. `wiped` uses `nowMs`. `cancelled` is not a settlement. */
  readonly reason?: 'ended' | 'wiped' | 'cancelled';
}

export interface MercenaryPayoutResult {
  readonly bountyId: string;
  readonly paid: number;
  readonly refunded: number;
  readonly escrowId: string;
}

type HireRow = BountyRow & { claimerAccountId: string };

/**
 * Pays a mercenary hire for time served (W22-30, NEAR-112).
 * Refunds the unused part, then `EscrowPort.claim` pays the open remainder
 * (`opId = bounty-pay:{id}`, caller = the squad account). A second call does not move metals.
 * W22 off returns null. A cancel that already refunded (BE-84) only claims what is still open.
 */
@Injectable()
export class MercenaryPayoutService {
  constructor(
    @Inject(EscrowPort) private readonly escrow: EscrowPort,
    @Inject(ChainOutboxRepository) private readonly outbox: ChainOutboxRepository,
    @Inject(BountyRepository) private readonly bounties: BountyRepository,
    @Inject(FlagsService) private readonly flags: WaveFlags,
  ) {}

  async payout(input: MercenaryPayoutInput): Promise<MercenaryPayoutResult | null> {
    if (!this.flags.has('W22') || input.reason === 'cancelled') return null;
    const row = await this.bounties.find(input.bountyId);
    if (!row || !this.isHire(row)) return null;
    if (row.state === 'paid') return this.replay(row);
    const view = await this.escrow.get({ escrowId: row.escrowId });
    if (view.status === 'claimed') return this.replay(row);
    if (row.state === 'refunded' || (await this.done(opId('merc-refund', row.id)))) return this.afterCancel(row, view);
    if (view.status !== 'open') return this.replay(row);
    return this.settleOpen(row, input.nowMs, input.reason);
  }

  private async settleOpen(row: HireRow, nowMs: number, reason?: MercenaryPayoutInput['reason']): Promise<MercenaryPayoutResult> {
    const refundOp = payoutRefundOp(row.id);
    if (!(await this.done(refundOp))) await this.refund(row, refundOp, this.split(row, nowMs, reason));
    const view = await this.escrow.get({ escrowId: row.escrowId });
    if (view.status === 'claimed') return this.replay(row);
    if (view.status !== 'open' || fromCargoBaseUnits(view.amount) === 0) {
      await this.bounties.markRefunded(row.id);
      return this.replay(row);
    }
    return this.payOpen(row, fromCargoBaseUnits(view.amount), BountyReward.parse(row.reward).amount);
  }

  /** Cancel left the served metals open (BE-84). Claim that hold; do not refund again. */
  private async afterCancel(row: HireRow, view: EscrowView): Promise<MercenaryPayoutResult> {
    if (view.status !== 'open') return this.replay(row);
    const paid = fromCargoBaseUnits(view.amount);
    if (paid <= 0) return this.replay(row);
    return this.payOpen(row, paid, BountyReward.parse(row.reward).amount);
  }

  private async payOpen(row: HireRow, paid: number, total: number): Promise<MercenaryPayoutResult> {
    await this.claim(row);
    await this.bounties.markSettled(row.id);
    return { bountyId: row.id, paid, refunded: total - paid, escrowId: row.escrowId };
  }

  private async replay(row: HireRow): Promise<MercenaryPayoutResult> {
    const total = BountyReward.parse(row.reward).amount;
    const split = await this.recordedSplit(row.id, total);
    if (row.state !== 'paid' && split.paid > 0) await this.bounties.markSettled(row.id);
    return { bountyId: row.id, paid: split.paid, refunded: split.refunded, escrowId: row.escrowId };
  }

  private async refund(row: HireRow, refundOp: string, split: RefundSplit): Promise<void> {
    const body = {
      escrowId: row.escrowId,
      caller: row.accountId,
      amount: toCargoBaseUnits(split.refunded),
      paid: split.paid,
      refunded: split.refunded,
    };
    await this.outbox.enqueue({ opId: refundOp, port: 'Escrow', method: 'refund', payload: body });
    try {
      const receipt = await this.escrow.refund({
        opId: refundOp,
        escrowId: body.escrowId,
        caller: body.caller,
        amount: body.amount,
      });
      await this.outbox.markDoneByOpId(refundOp, receipt, receipt.txHash).catch(() => false);
    } catch (err) {
      await this.outbox.abandon(refundOp).catch(() => undefined);
      throw err;
    }
  }

  private async claim(row: HireRow): Promise<void> {
    const body = { opId: bountyPayOpId(row.id), escrowId: row.escrowId, caller: row.claimerAccountId };
    await this.outbox.enqueue({ opId: body.opId, port: 'Escrow', method: 'claim', payload: body });
    const receipt = await this.escrow.claim(body);
    await this.outbox.markDoneByOpId(body.opId, receipt, receipt.txHash).catch(() => false);
  }

  private async recordedSplit(id: string, total: number): Promise<RefundSplit> {
    const ours = await this.outbox.find(payoutRefundOp(id));
    if (ours?.status === 'DONE') return splitFrom(ours.payload, total);
    const cancel = await this.outbox.find(opId('merc-refund', id));
    if (cancel?.status === 'DONE') return splitFrom(cancel.payload, total);
    return { paid: total, refunded: 0 };
  }

  private split(row: HireRow, nowMs: number, reason?: MercenaryPayoutInput['reason']): RefundSplit {
    const target = BountyTarget.parse(row.target);
    if (target.kind !== 'defend_area') {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Bounty is not a defend contract' });
    }
    const started = row.expiresAt.getTime() - target.durationH * HOUR_MS;
    const at = reason === 'ended' ? row.expiresAt.getTime() : nowMs;
    return refundSplit(BountyReward.parse(row.reward).amount, target.durationH, started, at);
  }

  private isHire(row: BountyRow): row is HireRow {
    const known = mercenaryRoster(this.flags).some((entry) => entry.accountId === row.claimerAccountId);
    const target = BountyTarget.safeParse(row.target);
    return known && !!row.claimerAccountId && target.success && target.data.kind === 'defend_area';
  }

  private async done(id: string): Promise<boolean> {
    return (await this.outbox.find(id))?.status === 'DONE';
  }
}

function payoutRefundOp(bountyId: string): string {
  return opId('merc-payout', bountyId);
}

function splitFrom(payload: unknown, total: number): RefundSplit {
  if (!payload || typeof payload !== 'object') return { paid: 0, refunded: 0 };
  const row = payload as { paid?: unknown; refunded?: unknown; amount?: unknown };
  if (typeof row.paid === 'number' && typeof row.refunded === 'number') {
    return { paid: row.paid, refunded: row.refunded };
  }
  const refunded = typeof row.amount === 'string' ? fromCargoBaseUnits(row.amount) : 0;
  const clamped = Math.min(total, Math.max(0, refunded));
  return { paid: total - clamped, refunded: clamped };
}
