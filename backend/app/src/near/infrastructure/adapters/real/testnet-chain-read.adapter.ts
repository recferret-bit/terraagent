import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { ChainReadPort } from '../../../application/ports/chain-read.port.js';
import type { ChainHealth, ChainReceipt } from '../../../domain/types.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';

/** Real NEAR `ChainReadPort` (`W23-06`): reads receipts & health via FastNEAR + fallback RPC and builds nearblocks links. */
@Injectable()
export class TestnetChainReadAdapter implements ChainReadPort {
  private readonly rpc: NearRpcClient;

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, resolveActiveNearNetwork('ChainRead', source)));
  }

  explorerUrl(txHash: string): string | null {
    return this.rpc.explorerUrl(txHash);
  }

  async receipt(txHash: string): Promise<ChainReceipt | null> {
    const sender = process.env.CONTRACT_CHAIN_READ_SENDER || this.rpc.config.rootAccount;
    const primary = await this.rpc.receipt(txHash, sender);
    if (primary) return primary;
    if (sender !== this.rpc.config.accounts.minter) {
      return this.rpc.receipt(txHash, this.rpc.config.accounts.minter);
    }
    return null;
  }

  health(): Promise<ChainHealth> {
    return this.rpc.health();
  }
}

export const adapter = adapterOf({ port: ChainReadPort, kind: 'testnet', useClass: TestnetChainReadAdapter });
export const mainnetAdapter = adapterOf({ port: ChainReadPort, kind: 'mainnet', useClass: TestnetChainReadAdapter });
