import { contractSignedText, mockLabel, type ContractSignedFields, type MarketTokenKey } from '@terra/contracts';

export const CONTRACTS_LIMIT = 20;

/** One row of the Contracts list; `kind` is the event-log row kind (`history.trade` for a signed contract). */
export interface ContractRow {
  readonly id: string;
  readonly kind: 'history.trade' | 'history.trade.failed';
  readonly text: string;
  readonly role?: 'buyer' | 'seller';
  readonly atTick: number;
  /** Quote token of a signed contract, for the MOCK badge. */
  readonly quote?: MarketTokenKey;
}

export interface TradeSettledData extends ContractSignedFields {
  readonly tradeId: string;
  readonly role: 'buyer' | 'seller';
  readonly colonyId: string;
  readonly colonyIndex?: number;
}

/** The "mock" badge text of a row (all F2 tokens are mocks, NEAR-65). */
export const rowBadge = (row: ContractRow): string => (row.quote ? mockLabel(row.quote).toUpperCase() : '');

/** Newest-first list of the last {@link CONTRACTS_LIMIT} rows; a repeated id (a re-sent event) is not added twice. */
export class ContractsLog {
  private rows: ContractRow[] = [];
  private readonly listeners = new Set<() => void>();

  get list(): readonly ContractRow[] {
    return this.rows;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(row: ContractRow): boolean {
    if (this.rows.some((r) => r.id === row.id)) return false;
    this.rows = [row, ...this.rows].slice(0, CONTRACTS_LIMIT);
    for (const fn of this.listeners) fn();
    return true;
  }

  addSigned(d: TradeSettledData, atTick: number): ContractRow | null {
    const row: ContractRow = { id: `${d.tradeId}:${d.colonyId}`, kind: 'history.trade', text: contractSignedText(d), role: d.role, atTick, quote: d.quote };
    return this.add(row) ? row : null;
  }

  addFailed(id: string, text: string, atTick: number): ContractRow | null {
    const row: ContractRow = { id, kind: 'history.trade.failed', text, atTick };
    return this.add(row) ? row : null;
  }
}
