import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { EscrowPort } from '../application/ports/escrow.port.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { BountyRepository } from './bounty.repository.js';
import { bountyRefundOpId } from './validate.js';
import type { BountyRow } from './view.js';

interface WaveFlags {
  has(wave: string): boolean;
}

export interface ExpirySweep {
  readonly refunded: number;
}

/** How often the app asks `refundDue`. The deadline is `chain.bounty.expiresAt`, not this poll. */
export const EXPIRY_POLL_MS = 60_000;

/** Roster accounts (`merc-N.npc.terraagent.mock`). W22-30 pays these at contract end, so the clock does not. */
const MERC_ACCOUNT_SUFFIX = '.npc.terraagent.mock';

const NONE: ExpirySweep = { refunded: 0 };

/**
 * Refunds a bounty whose `expiresAt` has passed (`opId = bounty-refund:{id}`, W22-24).
 * The call omits `amount`, so the whole remaining hold goes back to the escrow opener
 * (the poster `accountId`, even after that colony is eliminated). W22 off does nothing.
 * A mercenary claimer is left `claimed` for W22-30. Sim cancel still uses `refundIfOpen`.
 */
@Injectable()
export class BountyExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BountyExpiryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  constructor(
    @Inject(EscrowPort) private readonly escrow: EscrowPort,
    @Inject(ChainOutboxRepository) private readonly outbox: ChainOutboxRepository,
    @Inject(BountyRepository) private readonly repo: BountyRepository,
    @Inject(FlagsService) private readonly flags: WaveFlags,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  onModuleInit(): void {
    if (!this.flags.has('W22') || !databaseEnabled(this.env)) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.refundDue(Date.now())
        .catch((err: unknown) => this.log.warn(`bounty expiry poll: ${message(err)}`))
        .finally(() => {
          this.running = undefined;
        });
    }, EXPIRY_POLL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Open or claimed rows with `expiresAt <= nowMs`, except a mercenary hold. Idempotent on the refund op. */
  async refundDue(nowMs: number): Promise<ExpirySweep> {
    if (!this.flags.has('W22')) return NONE;
    let refunded = 0;
    for (const row of await this.repo.dueForRefund(new Date(nowMs))) {
      if (isMercenaryHold(row)) continue;
      if (await this.safeRefund(row)) refunded += 1;
    }
    return { refunded };
  }

  /** Sim `bountyRefunded` (cancel, fail, lost building). Refunds before the clock when the row is still active. */
  async refundIfOpen(planetId: string, bountyId: string): Promise<boolean> {
    if (!this.flags.has('W22')) return false;
    const row = await this.repo.find(bountyId);
    if (!row || row.planetId !== planetId || !isActive(row)) return false;
    return this.safeRefund(row);
  }

  private async safeRefund(row: BountyRow): Promise<boolean> {
    try {
      return await this.refundOne(row);
    } catch (err) {
      this.log.warn(`bounty ${row.id} refund failed: ${message(err)}`);
      return false;
    }
  }

  private async refundOne(row: BountyRow): Promise<boolean> {
    const fresh = await this.repo.find(row.id);
    if (!fresh || !isActive(fresh)) return false;
    await this.move(fresh);
    return this.repo.markRefundedIfActive(fresh.id);
  }

  /** No `amount`: the adapter returns whatever is still held and closes the escrow. */
  private async move(row: BountyRow): Promise<void> {
    const op = bountyRefundOpId(row.id);
    const body = { escrowId: row.escrowId, caller: row.accountId };
    await this.outbox.enqueue({ opId: op, port: 'Escrow', method: 'refund', payload: body });
    try {
      const receipt = await this.escrow.refund({ opId: op, ...body });
      await this.outbox.markDoneByOpId(op, receipt, receipt.txHash).catch(() => false);
    } catch (err) {
      await this.outbox.abandon(op).catch(() => undefined);
      throw err;
    }
  }
}

function isActive(row: BountyRow): boolean {
  return row.state === 'open' || row.state === 'claimed';
}

function isMercenaryHold(row: BountyRow): boolean {
  return row.claimerAccountId?.endsWith(MERC_ACCOUNT_SUFFIX) === true;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
