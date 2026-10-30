import type { ChainHealth, ChainReceipt } from '../../domain/types.js';

export abstract class ChainReadPort {
  /** Explorer link for a tx; null for `mock:` hashes (no explorer). */
  abstract explorerUrl(txHash: string): string | null;
  /** Null when the hash is unknown. */
  abstract receipt(txHash: string): Promise<ChainReceipt | null>;
  abstract health(): Promise<ChainHealth>;
}
