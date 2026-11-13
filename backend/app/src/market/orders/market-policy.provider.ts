import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { compileMarketConfig, type MarketConfig } from '@terra/sim';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { EconomyProfileService } from '../../economy/profile/profile.service.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../../near/infrastructure/network/near-network.config.js';
import { resolveProtocolFeeSchedule } from '../../near/infrastructure/network/protocol-fee.config.js';

/** TerraAgent Protocol treasury beneficiary (`protocol.terraagent.*`; `chain.mock_chain_account` row is bootstrapped by `MarketAccountsBootstrap`). */
export const PROTOCOL_ACCOUNT_ID = 'protocol.terraagent.mock';
/** Backwards-compatible alias for `PROTOCOL_ACCOUNT_ID`. */
export const PLATFORM_ACCOUNT_ID = PROTOCOL_ACCOUNT_ID;

/** Resolves `protocol.<root>` in `testnet`/`mainnet` mode while keeping `protocol.terraagent.mock` in `mock` mode. */
export function resolveProtocolAccountId(envSource?: Record<string, string | undefined>): string {
  const bag = (envSource ?? process.env) as Record<string, string | undefined>;
  const adapter = nearAdapterFor('Intents', bag);
  if (adapter === 'mock') return bag.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_ACCOUNT_ID;
  const net = adapter === 'mainnet' ? 'mainnet' : 'testnet';
  return resolveNearNetworkConfig(bag, net).accounts.protocol;
}

/**
 * The market policy new orders pin: the `MarketConfig` of the ACTIVE compiled economy profile (the same object the planets got,
 * `EconomyProfileService.compiledFor({})`). It is reloaded at boot and whenever the activation bridge applies a version (activate or
 * rollback), so new orders pin the new `policyVersion/policyHash/platformFeeBp` while open orders keep theirs. Without a profile
 * service (unit tests) or without a W13 config it serves the bootstrap policy.
 * Optional env overrides (`NEAR_PLATFORM_FEE_BP`, `NEAR_DAO_FEE_SHARE_BP`) apply cleanly when present.
 */
@Injectable()
export class MarketPolicyProvider implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MarketPolicyProvider');
  private cached: MarketConfig | undefined;
  private off: (() => void) | undefined;

  constructor(
    @Optional() private readonly profiles?: EconomyProfileService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

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
    const base = (this.cached ??= compileMarketConfig({ parameters: {} }));
    const bag = (this.env ?? process.env) as Record<string, string | undefined>;
    if (!bag.NEAR_PLATFORM_FEE_BP?.trim() && !bag.NEAR_DAO_FEE_SHARE_BP?.trim()) {
      return base;
    }
    const sched = resolveProtocolFeeSchedule(bag, {
      basePlatformFeeBp: base.platformFeeBp,
      baseDaoShareBp: base.treasuryShareBp,
    });
    return {
      ...base,
      platformFeeBp: sched.standardPlatformFeeBp,
      treasuryShareBp: sched.daoCarveOutShareBp,
    };
  }
}
