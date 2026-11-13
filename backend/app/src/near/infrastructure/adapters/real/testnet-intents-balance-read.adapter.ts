import { Inject, Injectable, Optional } from '@nestjs/common';
import { MarketTokenKey, fromChainUnits, tokenKeyOfVerifierId } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { IntentsBalanceReadPort } from '../../../application/ports/intents-balance-read.port.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { MockIntentsBalanceReadAdapter } from '../mock/intents-balance-read.adapter.js';
import { readMainnetVerifierBalances, readMainnetVerifierChainBalance } from './mainnet-intents-rpc.js';

/**
 * Companion read adapter for `NEAR_ADAPTER_INTENTS=testnet|mainnet` (`near-infrastructure.module.ts`):
 * - `testnet`: reads from the hybrid Postgres verifier ledger.
 * - `mainnet`: queries `mt_balance_of` / `mt_batch_balance_of` directly on `intents.near`.
 */
@Injectable()
export class TestnetIntentsBalanceReadAdapter extends MockIntentsBalanceReadAdapter {
  private readonly rpc: NearRpcClient;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    super(prisma);
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, resolveActiveNearNetwork('Intents', source)));
  }

  override async verifierBalance(accountId: string, token: string): Promise<bigint> {
    if (this.rpc.network !== 'mainnet') {
      return super.verifierBalance(accountId, token);
    }
    const chainBal = await readMainnetVerifierChainBalance(this.rpc, accountId, token);
    const parsedKey = MarketTokenKey.safeParse(token);
    const key = parsedKey.success ? parsedKey.data : tokenKeyOfVerifierId(token);
    return key ? fromChainUnits(key, chainBal) : chainBal;
  }

  override async verifierChainBalance(accountId: string, token: string): Promise<bigint> {
    if (this.rpc.network !== 'mainnet') {
      return super.verifierChainBalance(accountId, token);
    }
    return readMainnetVerifierChainBalance(this.rpc, accountId, token);
  }

  override async verifierBalances(accountId: string) {
    if (this.rpc.network !== 'mainnet') {
      return super.verifierBalances(accountId);
    }
    return readMainnetVerifierBalances(this.rpc, accountId);
  }
}

export const adapter = adapterOf({
  port: IntentsBalanceReadPort,
  kind: 'testnet',
  useClass: TestnetIntentsBalanceReadAdapter,
});

export const mainnetAdapter = adapterOf({
  port: IntentsBalanceReadPort,
  kind: 'mainnet',
  useClass: TestnetIntentsBalanceReadAdapter,
});
