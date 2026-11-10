import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { TransferCargoInput } from '../application/ports/cargo-token.port.js';
import { clearCargoTransferObserver, setCargoTransferObserver } from '../cargo/cargo-transfer.hook.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { completeOnce, deliverCandidates, deliverNeed, deliveredBase, recordDelivery } from './deliver.ledger.js';
import { BountyPayService } from './pay.service.js';
import type { BountyRow } from './view.js';

interface WaveFlags {
  has(wave: string): boolean;
}

/**
 * Completes a chain `deliver_units` bounty from cargo transfers (W22-22).
 * The sim does not track this target. Payout is `BountyPayService` (`bounty-pay:{id}`, once).
 * A failed claim leaves the row `completed`.
 */
@Injectable()
export class BountyDeliverService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BountyDeliverService.name);
  private readonly observe = (input: TransferCargoInput): Promise<void> => this.onTransfer(input);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(BountyPayService) private readonly payout: BountyPayService,
    @Inject(FlagsService) private readonly flags: WaveFlags,
  ) {}

  onModuleInit(): void {
    setCargoTransferObserver(this.observe);
  }

  onModuleDestroy(): void {
    clearCargoTransferObserver(this.observe);
  }

  async onTransfer(input: TransferCargoInput): Promise<void> {
    if (!this.flags.has('W22')) return;
    const now = new Date();
    const rows = await deliverCandidates(this.prisma, input.to, input.from, now);
    for (const row of rows) {
      try {
        await this.consider(row, input, now);
      } catch (err) {
        this.log.warn(`bounty ${row.id} delivery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async consider(row: BountyRow, input: TransferCargoInput, now: Date): Promise<void> {
    const need = deliverNeed(row, input.tokenId);
    if (need === null || BigInt(input.amount) <= 0n) return;
    await recordDelivery(this.prisma, row.id, input.opId, input.amount);
    if ((await deliveredBase(this.prisma, row.id)) < need) return;
    if (!(await completeOnce(this.prisma, row.id, now))) return;
    try {
      await this.payout.pay(row.id);
    } catch (err) {
      this.log.warn(`bounty ${row.id} completed but escrow claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
