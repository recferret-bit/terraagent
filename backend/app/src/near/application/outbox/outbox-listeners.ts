import { Injectable } from '@nestjs/common';
import type { ClaimedRow } from './chain-outbox.repository.js';

export type RowFailedListener = (row: ClaimedRow, error: string, dead: boolean) => Promise<void> | void;
export type RowDoneListener = (row: ClaimedRow, result: object, txHash: string | null) => Promise<void> | void;

/**
 * Lets a module react to outbox rows reaching DONE without `OutboxModule` knowing it (the cargo hook stays direct).
 * A listener that throws is isolated: the relay already stored DONE, and recovery sweeps re-run the module's own step.
 */
@Injectable()
export class OutboxListeners {
  private readonly done = new Set<RowDoneListener>();
  private readonly failed = new Set<RowFailedListener>();

  onDone(fn: RowDoneListener): () => void {
    this.done.add(fn);
    return () => this.done.delete(fn);
  }

  async emitDone(row: ClaimedRow, result: object, txHash: string | null): Promise<void> {
    for (const fn of [...this.done]) {
      try { await fn(row, result, txHash); } catch { /* the module's own recovery sweep finishes the step */ }
    }
  }

  onFailed(fn: RowFailedListener): () => void {
    this.failed.add(fn);
    return () => this.failed.delete(fn);
  }

  async emitFailed(row: ClaimedRow, error: string, dead: boolean): Promise<void> {
    for (const fn of [...this.failed]) {
      try { await fn(row, error, dead); } catch { /* the module's reconciler picks the row up again */ }
    }
  }
}
