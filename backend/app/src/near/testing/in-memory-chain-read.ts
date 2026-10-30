import { ChainReadPort } from '../application/ports/chain-read.port';
import type { ChainHealth, ChainReceipt } from '../domain/types';
import { InMemoryChain } from './in-memory-chain';

/** In-memory `ChainReadPort` for unit tests. `ping()` writes a receipt the same way the mock adapter does. */
export class InMemoryChainRead extends ChainReadPort {
  constructor(readonly chain: InMemoryChain = new InMemoryChain()) {
    super();
  }

  explorerUrl(_txHash: string): string | null {
    return null;
  }

  async receipt(txHash: string): Promise<ChainReceipt | null> {
    return this.chain.receipt(txHash);
  }

  async health(): Promise<ChainHealth> {
    return { ok: true, network: 'mock', latencyMs: 0 };
  }

  async ping(opId?: string): Promise<ChainReceipt> {
    return this.chain.write(opId, () => ({ ping: true })).receipt;
  }
}
