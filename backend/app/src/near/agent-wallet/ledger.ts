import type { TokenAllowanceView } from '../application/ports/agent-wallet.port.js';
import { NearException } from '../domain/errors.js';

/** One token's principal pool. Available is derived, never stored. */
export interface AllowanceTotals {
  readonly allowance: bigint;
  readonly reserved: bigint;
  readonly spent: bigint;
}

export type AllowanceMove = 'reserve' | 'consume' | 'release';

export const ZERO_ALLOWANCE: AllowanceTotals = { allowance: 0n, reserved: 0n, spent: 0n };

/** `allowance - reserved - spent`. A hold reduces what the next reserve may take. */
export function availableOf(row: AllowanceTotals): bigint {
  return row.allowance - row.reserved - row.spent;
}

export function toAllowanceView(token: string, row: AllowanceTotals): TokenAllowanceView {
  return {
    token,
    allowance: row.allowance.toString(),
    reserved: row.reserved.toString(),
    spent: row.spent.toString(),
    available: availableOf(row).toString(),
  };
}

/**
 * Next pool after one amount-based move. Does not mutate `row`.
 * Reserve draws from available. Consume and release draw from reserved, so a 300 hold can settle 200 and cancel 100.
 */
export function nextAllowance(row: AllowanceTotals, move: AllowanceMove, amount: bigint): AllowanceTotals {
  if (amount < 0n) throw new NearException('NEAR_INVALID_INPUT', { message: 'Amount must be non-negative.' });
  if (move === 'reserve') {
    const available = availableOf(row);
    if (available < amount) shortfall(available, amount, 'available');
    return { allowance: row.allowance, reserved: row.reserved + amount, spent: row.spent };
  }
  if (row.reserved < amount) shortfall(row.reserved, amount, 'reserved');
  if (move === 'consume')
    return { allowance: row.allowance, reserved: row.reserved - amount, spent: row.spent + amount };
  return { allowance: row.allowance, reserved: row.reserved - amount, spent: row.spent };
}

/** Prisma numeric, pg string, or a Decimal-like value. Fractional scale is truncated toward zero. */
export function decimalToBigInt(value: unknown): bigint {
  const text = decimalText(value).split('.')[0] ?? '';
  if (!/^-?\d+$/.test(text))
    throw new NearException('NEAR_UNAVAILABLE', { message: `Bad decimal "${decimalText(value)}"` });
  return BigInt(text);
}

function shortfall(have: bigint, amount: bigint, kind: 'available' | 'reserved'): never {
  throw new NearException('NEAR_ALLOWANCE_EXHAUSTED', {
    message: `Limited key has ${have} ${kind}, needs ${amount}.`,
    details: { [kind]: have.toString(), needed: amount.toString() },
  });
}

function decimalText(value: unknown): string {
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') return String(value);
  if (value && typeof value === 'object' && 'toFixed' in value && typeof value.toFixed === 'function')
    return value.toFixed(0);
  throw new NearException('NEAR_UNAVAILABLE', { message: 'Allowance column was not a decimal' });
}
