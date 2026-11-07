import type { ChainReceipt } from '../domain/types';
import { FaultPlan, type FaultCall } from '../infrastructure/mock/fault-plan';
import { mockChainControls } from '../infrastructure/mock/mock-controls';
import { mockTxHashFor, randomMockTxHash } from '../infrastructure/mock/tx-hash';

/**
 * Receipt ledger shared by the in-memory fakes (NEAR §1a rule 8: unit tests only, never bound in the app).
 * Writes are idempotent by `opId`: a repeat returns the stored value and receipt and never re-runs the callback.
 */
export class InMemoryChain {
  private height = 0;
  private readonly byHash = new Map<string, ChainReceipt>();
  private readonly byOp = new Map<string, { value: unknown; receipt: ChainReceipt }>();

  /** Runs `fn` once per `opId` (always when there is none). A throwing `fn` stores nothing. */
  write<T>(opId: string | undefined, fn: () => T, call?: Pick<FaultCall, 'port' | 'method'>): { value: T; receipt: ChainReceipt } {
    const seen = opId === undefined ? undefined : this.byOp.get(opId);
    if (seen) return seen as { value: T; receipt: ChainReceipt };
    const fc: FaultCall | null = call ? { ...call, ...(opId === undefined ? {} : { opId }) } : null;
    const pending = fc ? mockChainControls.faults.beforeSync(fc) : null; // deterministic faults (see mock/fault-plan.ts)
    const done = this.commit(opId, fn);
    if (fc) FaultPlan.after(pending, fc);
    return pending === 'duplicate' && opId !== undefined ? this.write(opId, fn) : done;
  }

  private commit<T>(opId: string | undefined, fn: () => T): { value: T; receipt: ChainReceipt } {
    const value = fn();
    const receipt: ChainReceipt = {
      txHash: opId === undefined ? randomMockTxHash(Math.random) : mockTxHashFor(opId),
      blockHeight: ++this.height,
      status: 'success',
      network: 'mock',
      at: Date.now(),
    };
    this.byHash.set(receipt.txHash, receipt);
    if (opId !== undefined) this.byOp.set(opId, { value, receipt });
    return { value, receipt };
  }

  receipt(txHash: string): ChainReceipt | null {
    return this.byHash.get(txHash) ?? null;
  }
}
