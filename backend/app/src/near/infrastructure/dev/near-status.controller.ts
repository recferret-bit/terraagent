import { Body, Controller, Get, Inject, Optional, Post } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { PROTOCOL_ACCOUNT_ID } from '../../../market/orders/market-policy.provider.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { NEAR_PORT_NAMES } from '../../domain/types.js';
import { nearAdapterFor } from '../adapter-selection.js';
import { OneClickQuoteClient, type OneClickDryQuoteRequest } from '../adapters/real/oneclick-quote.service.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../network/near-network.config.js';
import { NearRpcClient } from '../rpc/near-rpc.client.js';
import { buildProtocolTreasuryView } from './protocol-treasury.view.js';

/**
 * Runtime NEAR port matrix & live NEAR Intents 1Click dry-quote controller (`W23-02`, `W23-25`, `W23-43`).
 * Exposes zero secrets; surfaces active adapter mode (`mock` / `testnet` / `mainnet`), contract IDs,
 * explorer base URL, and RPC health for `Settings -> Chain Status` and `near.ports`.
 */
@Controller('near')
export class NearStatusController {
  private readonly envSource: Record<string, string | undefined>;
  private readonly oneClick: OneClickQuoteClient;
  private rpcClient?: NearRpcClient;

  constructor(
    @Optional() private readonly chainRead?: ChainReadPort,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    const cfg = resolveNearNetworkConfig(this.envSource, resolveActiveNearNetwork(null, this.envSource));
    this.oneClick = new OneClickQuoteClient(cfg.oneClickUrl, cfg.oneClickApiKey);
  }

  @Get('status')
  async status() {
    const activeNet = resolveActiveNearNetwork(null, this.envSource);
    const cfg = resolveNearNetworkConfig(this.envSource, activeNet);
    const health = this.chainRead
      ? await this.chainRead.health()
      : { ok: false, network: 'mock' as const, latencyMs: 0, detail: 'unbound' };
    const contractByPort: Partial<Record<(typeof NEAR_PORT_NAMES)[number], string>> = {
      Identity: cfg.contracts.pilots,
      Relayer: cfg.accounts.relayer,
      CargoToken: cfg.contracts.res,
      Intents: cfg.contracts.intents,
      AgentWallet: cfg.rootAccount,
      BadgeNft: cfg.contracts.deed,
      DeedNft: cfg.contracts.deed,
      Escrow: cfg.contracts.bounty,
      Staking: cfg.contracts.staking,
      TreasuryDao: cfg.contracts.dao,
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

    const nearMode = this.envSource.NEAR_MODE ?? 'mock';
    return {
      nearMode,
      network: activeNet,
      rootAccount: cfg.rootAccount,
      protocolAccount:
        nearMode === 'mock' ? (this.envSource.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_ACCOUNT_ID) : cfg.accounts.protocol,
      contracts: cfg.contracts,
      accounts: cfg.accounts,
      fastAuth: cfg.fastAuth,
      explorerBaseUrl: cfg.explorerBaseUrl,
      health,
      ports,
    };
  }

  @Get('protocol')
  async protocol() {
    const nearMode = this.envSource.NEAR_MODE ?? 'mock';
    if (nearMode !== 'mock' && !this.rpcClient && this.envSource.VITEST !== 'true' && process.env.VITEST !== 'true') {
      const cfg = resolveNearNetworkConfig(this.envSource, resolveActiveNearNetwork(null, this.envSource));
      this.rpcClient = new NearRpcClient(cfg);
    }
    return buildProtocolTreasuryView(this.envSource, this.prisma, this.rpcClient);
  }

  @Post('intents/quote')
  async dryQuote(@Body() body?: OneClickDryQuoteRequest) {
    return this.oneClick.dryQuote(body ?? {});
  }
}
