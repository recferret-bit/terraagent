import { parseWaves } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '@terra/sim';

/** A reservation that fits the day's remaining token cap. */
export type GlobalReserveGrant = { ok: true };

/** `spent + outstanding + tokens` would pass the daily cap. The day is unchanged. */
export type GlobalReserveDeny = { ok: false; outcome: 'budget_exhausted' };

export type GlobalReserveResult = GlobalReserveGrant | GlobalReserveDeny;

interface DayBooks {
  /** Reconciled usage. Never decreases. */
  spent: number;
  /** Reservations not yet reconciled, oldest first. */
  outstanding: number[];
}

const deny = (): GlobalReserveDeny => ({ ok: false, outcome: 'budget_exhausted' });

/** Design-unit daily token cap from `director.budget`. The table does not tick-convert this field. */
export function globalCap(): number {
  const row = dataRow(compileData(parseWaves('..16')), 'director', 'budget');
  return numberField(row, 'globalTokensPerDay');
}

/**
 * Process-local global token ledger. Each UTC `day` string has its own counter.
 * A reservation stays outstanding until `reconcile`. Unknown usage (`actual: null`)
 * keeps the whole reservation. A smaller actual refunds only the difference.
 * A later reconcile cannot lower a charge already recorded.
 */
export class GlobalTokenBudget {
  private readonly days = new Map<string, DayBooks>();
  private readonly cap: number;

  constructor(cap: number = globalCap()) {
    if (!Number.isFinite(cap) || cap < 0) throw new Error('global token cap is not a finite non-negative number');
    this.cap = cap;
  }

  reserve(day: string, tokens: number): GlobalReserveResult {
    if (!usable(tokens) || this.used(day) + tokens > this.cap) return deny();
    if (tokens > 0) this.books(day).outstanding.push(tokens);
    return { ok: true };
  }

  /**
   * Closes the oldest outstanding reservation of `reserved` tokens.
   * No matching reservation means it was already reconciled: spent stays put.
   */
  reconcile(day: string, reserved: number, actual: number | null): void {
    if (!usable(reserved) || (actual !== null && !usable(actual))) return;
    const books = this.days.get(day);
    if (!books) return;
    const index = books.outstanding.indexOf(reserved);
    if (index < 0) return;
    books.outstanding.splice(index, 1);
    books.spent += actual === null ? reserved : actual;
  }

  private used(day: string): number {
    const books = this.days.get(day);
    if (!books) return 0;
    return books.spent + outstandingSum(books);
  }

  /** Plain snapshot so a restart can keep outstanding reservations. */
  snapshot(): { cap: number; days: { day: string; spent: number; outstanding: number[] }[] } {
    return {
      cap: this.cap,
      days: [...this.days].map(([day, books]) => ({ day, spent: books.spent, outstanding: [...books.outstanding] })),
    };
  }

  static fromSnapshot(snap: { cap: number; days: { day: string; spent: number; outstanding: number[] }[] }): GlobalTokenBudget {
    const budget = new GlobalTokenBudget(snap.cap);
    for (const day of snap.days) budget.days.set(day.day, { spent: day.spent, outstanding: [...day.outstanding] });
    return budget;
  }

  private books(day: string): DayBooks {
    const existing = this.days.get(day);
    if (existing) return existing;
    const created: DayBooks = { spent: 0, outstanding: [] };
    this.days.set(day, created);
    return created;
  }
}

function outstandingSum(books: DayBooks): number {
  let sum = 0;
  for (const tokens of books.outstanding) sum += tokens;
  return sum;
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function numberField(row: CompiledRow, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`director.budget.${field} is not a number`);
  }
  return value;
}
