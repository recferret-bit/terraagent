import { Injectable } from '@nestjs/common';
import { compileMarketConfig, type MarketConfig } from '@terra/sim';

/** Platform fee beneficiary of every order (mock chain account; `chain.mock_chain_account` row is created by the fixture/adapter). */
export const PLATFORM_ACCOUNT_ID = 'platform.terraagent.mock';

/**
 * The market policy new orders pin. Bootstrap: the compiled default profile. W13-38 replaces `current()` with the
 * pinned DB profile (`policyVersion`/`policyHash` come from the same `MarketConfig`).
 */
@Injectable()
export class MarketPolicyProvider {
  private cached: MarketConfig | undefined;

  current(): MarketConfig {
    return (this.cached ??= compileMarketConfig({ parameters: {} }));
  }
}
