import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CommandPrechecks } from '../core/command-prechecks';
import { EconomyProfileService } from './profile/profile.service';

/** Market commands that open or change cash exposure; cancelling stays possible (it only releases reservations). */
export const CASH_COMMAND_KINDS = ['market.placeOrder', 'market.setHubFee'] as const;

/**
 * Fail closed (ECONOMY §5): when no pinned economy version could be loaded (database down at cold start, or no active
 * version in production) market commands are rejected `market_unavailable` before they reach the sim. An already loaded
 * snapshot keeps working through a later outage.
 */
@Injectable()
export class EconomyCashPrecheck implements OnModuleInit, OnModuleDestroy {
  private readonly off: (() => void)[] = [];

  constructor(private readonly prechecks: CommandPrechecks, private readonly profiles: EconomyProfileService) {}

  onModuleInit(): void {
    for (const kind of CASH_COMMAND_KINDS) {
      this.off.push(this.prechecks.register(kind, () => (this.profiles.cashAvailable() ? null : { code: 'market_unavailable', detail: 'no economy version is loaded' })));
    }
  }

  onModuleDestroy(): void { this.off.forEach((f) => f()); }
}
