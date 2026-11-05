import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { compileMarketConfig, type MarketConfig } from '@terra/sim';
import { EconomyProfileService } from '../../economy/profile/profile.service.js';

/** Platform fee beneficiary of every order (mock chain account; `chain.mock_chain_account` row is created by the fixture/adapter). */
export const PLATFORM_ACCOUNT_ID = 'platform.terraagent.mock';

/**
 * The market policy new orders pin: the `MarketConfig` of the ACTIVE compiled economy profile (the same object the planets got,
 * `EconomyProfileService.compiledFor({})`). It is reloaded at boot and whenever the activation bridge applies a version (activate or
 * rollback), so new orders pin the new `policyVersion/policyHash/platformFeeBp` while open orders keep theirs. Without a profile
 * service (unit tests) or without a W13 config it serves the bootstrap policy.
 */
@Injectable()
export class MarketPolicyProvider implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MarketPolicyProvider');
  private cached: MarketConfig | undefined;
  private off: (() => void) | undefined;

  constructor(@Optional() private readonly profiles?: EconomyProfileService) {}

  onModuleInit(): void {
    if (!this.profiles) return;
    this.off = this.profiles.onLoaded(() => void this.refresh());
    void this.refresh();
  }

  onModuleDestroy(): void { this.off?.(); }

  /** Re-reads the active profile's market config; a failure keeps the previous policy. */
  async refresh(): Promise<void> {
    if (!this.profiles) return;
    try {
      const c = (await this.profiles.compiledFor({})).marketConfig;
      if (c) this.cached = c;
    } catch (e) {
      this.log.warn(`market policy refresh failed (keeping previous): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  current(): MarketConfig {
    return (this.cached ??= compileMarketConfig({ parameters: {} }));
  }
}
