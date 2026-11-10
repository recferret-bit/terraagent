import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PlanetEventOf } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { MercenaryPayoutService } from './payout.service.js';

/**
 * `mercenaryLeft` settles the hire escrow (W22-30).
 * `ended` pays the full window. `wiped` pays the share served on the wall clock. `cancelled` does nothing.
 */
@Injectable()
export class MercenaryPayoutListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MercenaryPayoutListener.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    @Inject(MercenaryPayoutService) private readonly payouts: MercenaryPayoutService,
  ) {}

  onModuleInit(): void {
    this.stop ??= this.bus.onPlanetEvent('mercenaryLeft', (event) => {
      void this.settle(event).catch((err: unknown) => this.warn(event.data.bountyId, err));
    }, { module: 'MercenaryPayoutListener' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private settle(event: PlanetEventOf<'mercenaryLeft'>): Promise<unknown> {
    return this.payouts.payout({
      bountyId: event.data.bountyId,
      nowMs: Date.now(),
      reason: event.data.reason,
    });
  }

  private warn(bountyId: string, err: unknown): void {
    this.log.warn(`mercenary ${bountyId} payout failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
