import { ContractsLog, type TradeSettledData } from './contractsLog';

export interface ServerEventLike { kind: string; atTick?: number; data?: Record<string, unknown> }
export interface EventSource { onServerEvents?(fn: (events: readonly ServerEventLike[]) => void): () => void }
export type ToastFn = (message: string, severity: 'warning' | 'error' | 'info', durationMs: number, key: string) => unknown;

/** Player text of a refused order; the sim's `detail` wins, else the code. */
export const failedText = (detail?: string, code?: string): string => `Contract failed: ${detail ?? (code ? `order refused (${code})` : 'order refused')}`;
export const SETTLEMENT_FAILED_TEXT = 'Contract failed: the trade could not settle, nothing changed hands and your reservation was released';

/**
 * Turns the colony's market events into toasts and Contracts rows: `tradeSettled` (signed), `marketSettlementFailed` and
 * `marketOrderRejected` (failed). Events of another colony (when both indices are known) are ignored.
 */
export class ContractsController {
  private off: (() => void) | null = null;

  constructor(
    readonly log: ContractsLog,
    private readonly toast: ToastFn,
    private readonly ownerIndex: () => number | undefined,
    source?: EventSource,
  ) {
    this.off = source?.onServerEvents?.((events) => this.handle(events)) ?? null;
  }

  handle(events: readonly ServerEventLike[]): void {
    for (const e of events) {
      const d = e.data;
      if (!d || !this.isMine(d)) continue;
      const tick = e.atTick ?? 0;
      if (e.kind === 'tradeSettled') {
        const row = this.log.addSigned(d as unknown as TradeSettledData, tick);
        if (row) this.toast(row.text, 'info', 6000, `contract:${row.id}`);
      } else if (e.kind === 'marketSettlementFailed' || e.kind === 'marketOrderRejected') {
        const text = e.kind === 'marketSettlementFailed' ? SETTLEMENT_FAILED_TEXT : failedText(d.detail as string | undefined, d.code as string | undefined);
        const id = `failed:${String(d.ref)}:${e.kind}`;
        if (this.log.addFailed(id, text, tick)) this.toast(text, 'warning', 6000, id);
      }
    }
  }

  private isMine(d: Record<string, unknown>): boolean {
    const mine = this.ownerIndex();
    return mine === undefined || typeof d.colonyIndex !== 'number' || d.colonyIndex === mine;
  }

  dispose(): void {
    this.off?.();
    this.off = null;
  }
}
