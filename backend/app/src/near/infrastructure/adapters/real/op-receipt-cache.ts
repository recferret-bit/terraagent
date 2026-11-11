import type { ChainReceipt } from '../../../domain/types.js';

/**
 * In-process idempotency cache + single-flight deduplicator for real NEAR port writes.
 * Failed promises are never retained, so retrying a failed `opId` after funding runs on-chain.
 */
export class OpReceiptCache<T = ChainReceipt> {
  private readonly settled = new Map<string, T>();
  private readonly inflight = new Map<string, Promise<T>>();

  async run(opId: string, work: () => Promise<T>): Promise<T> {
    const hit = this.settled.get(opId);
    if (hit !== undefined) return hit;

    const pending = this.inflight.get(opId);
    if (pending) return pending;

    const promise = work().then((result) => {
      this.settled.set(opId, result);
      return result;
    });
    this.inflight.set(opId, promise);
    try {
      return await promise;
    } finally {
      if (this.inflight.get(opId) === promise) {
        this.inflight.delete(opId);
      }
    }
  }
}
