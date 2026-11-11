import { Body, Controller, Get, Inject, Optional, Post } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { NEAR_PORT_NAMES } from '../../domain/types.js';
import { nearAdapterFor } from '../adapter-selection.js';
import { OneClickQuoteClient, type OneClickDryQuoteRequest } from '../adapters/real/oneclick-quote.service.js';
import { resolveNearNetworkConfig } from '../network/near-network.config.js';

/**
 * Runtime NEAR port matrix & live NEAR Intents 1Click dry-quote controller (`W23-02`, `W23-25`, `W23-43`).
 * Exposes zero secrets; surfaces active adapter mode (`mock` / `testnet` / `mainnet`), contract IDs,
 * explorer base URL, and RPC health for `Settings -> Chain Status` and `near.ports`.
 */
@Controller('near')
export class NearStatusController {
  private readonly envSource: Record<string, string | undefined>;
  private readonly oneClick: OneClickQuoteClient;

  constructor(
    @Optional() private readonly chainRead?: ChainReadPort,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    const cfg = resolveNearNetworkConfig(this.envSource, 'testnet');
    this.oneClick = new OneClickQuoteClient(cfg.oneClickUrl, cfg.oneClickApiKey);
  }

  @Get('status')
  async status() {
    const cfg = resolveNearNetworkConfig(this.envSource, 'testnet');
    const health = this.chainRead
      ? await this.chainRead.health()
      : { ok: false, network: 'mock' as const, latencyMs: 0, detail: 'unbound' };
    const contractByPort: Partial<Record<(typeof NEAR_PORT_NAMES)[number], string>> = {
      Identity: cfg.rootAccount,
      Relayer: cfg.accounts.relayer,
      CargoToken: cfg.contracts.res,
      Intents: cfg.contracts.intents,
      AgentWallet: cfg.rootAccount,
      DeedNft: cfg.contracts.deed,
      Escrow: cfg.contracts.bounty,
      ChainRead: cfg.primaryRpcUrl,
    };

    const ports = NEAR_PORT_NAMES.map((port) => {
      const mode = nearAdapterFor(port, this.envSource);
      return {
        port,
        mode,
        target: mode === 'mock' ? 'postgres-mock' : (contractByPort[port] ?? cfg.rootAccount),
      };
    });

    return {
      nearMode: this.envSource.NEAR_MODE ?? 'mock',
      rootAccount: cfg.rootAccount,
      explorerBaseUrl: cfg.explorerBaseUrl,
      health,
      ports,
    };
  }

  @Post('intents/quote')
  async dryQuote(@Body() body?: OneClickDryQuoteRequest) {
    return this.oneClick.dryQuote(body ?? {});
  }
}
