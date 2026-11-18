import { Controller, Get, Inject, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { DEFAULT_NEAR_AI_MODEL, normalizeNearAiModel } from '../../../ai/nearai-models.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { PROTOCOL_ACCOUNT_ID } from '../../../market/orders/market-policy.provider.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { NEAR_PORT_NAMES } from '../../domain/types.js';
import { nearAdapterFor } from '../adapter-selection.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../network/near-network.config.js';
import type { AccountStorageReport } from '../rpc/near-rpc-storage.js';
import { NearRpcClient } from '../rpc/near-rpc.client.js';
import { buildProtocolTreasuryView } from './protocol-treasury.view.js';

/**
 * Runtime NEAR port matrix & protocol treasury telemetry controller (`W23-02`, `W23-43`).
 * Exposes zero secrets; surfaces active adapter mode (`mock` / `testnet` / `mainnet`), contract IDs,
 * explorer base URL, and RPC health for `Settings -> Chain Status` and `near.ports`.
 */
@Controller('near')
export class NearStatusController {
  private readonly envSource: Record<string, string | undefined>;
  private rpcClient?: NearRpcClient;

  constructor(
    @Optional() private readonly chainRead?: ChainReadPort,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
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
    const aiProvider = this.envSource.AI_PROVIDER ?? 'mock';
    const signingAlgo = this.envSource.NEAR_AI_SIGNING_ALGO?.trim().toLowerCase() === 'ed25519' ? 'ed25519' : 'ecdsa';
    const trustedSigners = (this.envSource.NEAR_AI_TRUSTED_SIGNERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const { contractHeadroom, storageAlerts } = await this.readStorageHeadroom(nearMode, activeNet, cfg);
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
      ...(contractHeadroom.length > 0 ? { contractHeadroom, storageAlerts } : {}),
      ai: {
        provider: aiProvider,
        defaultModel: normalizeNearAiModel(this.envSource.NEAR_AI_MODEL ?? DEFAULT_NEAR_AI_MODEL),
        attestationEnabled: this.envSource.NEAR_AI_ATTEST !== '0',
        signingAlgo,
        cryptoVerification: 'ed25519+secp256k1-eip191',
        strictCryptoVerify:
          this.envSource.NEAR_AI_STRICT_CRYPTO_VERIFY === '1' ||
          this.envSource.NEAR_AI_STRICT_CRYPTO_VERIFY === 'true',
        enclaveAllowlistCount: trustedSigners.length,
        byokEncryption: 'AES-256-GCM',
      },
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

  private async readStorageHeadroom(
    nearMode: string,
    activeNet: 'testnet' | 'mainnet',
    cfg: ReturnType<typeof resolveNearNetworkConfig>,
  ): Promise<{ contractHeadroom: readonly AccountStorageReport[]; storageAlerts: readonly string[] }> {
    if (nearMode === 'mock' || this.envSource.VITEST === 'true' || process.env.VITEST === 'true') {
      return { contractHeadroom: [], storageAlerts: [] };
    }
    try {
      this.rpcClient ??= new NearRpcClient(resolveNearNetworkConfig(this.envSource, activeNet));
      const targets = [
        cfg.contracts.res,
        cfg.contracts.deed,
        cfg.contracts.bounty,
        cfg.contracts.staking,
        cfg.contracts.dao,
        cfg.contracts.pilots,
        cfg.accounts.relayer,
        cfg.accounts.minter,
      ];
      const settled = await Promise.race([
        Promise.allSettled(targets.map((id) => this.rpcClient!.accountStorageReport(id))),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
      ]);
      if (!settled) return { contractHeadroom: [], storageAlerts: [] };
      const contractHeadroom = settled
        .filter((r): r is PromiseFulfilledResult<AccountStorageReport> => r.status === 'fulfilled')
        .map((r) => r.value);
      const storageAlerts = contractHeadroom
        .filter((r) => r.lowStorage)
        .map((r) => `${r.accountId}: ${r.liquidHeadroomNear.toFixed(4)} NEAR liquid`);
      return { contractHeadroom, storageAlerts };
    } catch {
      return { contractHeadroom: [], storageAlerts: [] };
    }
  }
}
