import { formatAtomic } from './format';
import type { MarketTokenKey } from './tokens';

/**
 * Player-facing market sentences shared by the client toasts and the server's `history.trade` rows (W13-24), so both say the
 * same thing. Display only: nothing here is parsed back.
 */

/** `bio.water` -> `water`, `metals.t1` -> `metals`, `metals.t2` -> `metals T2`: the lower-cased HUD resource names. */
export function resourceDisplayName(key: string): string {
  const [family = key, sub] = key.split('.');
  if (sub === undefined) return key;
  if (family === 'bio') return /^t\d$/.test(sub) ? `bio ${sub.toUpperCase()}` : sub;
  return sub === 't1' ? family : `${family} ${sub.toUpperCase()}`;
}

/** Fee rate in percent without trailing zeros: 100 bp -> `1`, 50 -> `0.5`, 25 -> `0.25`, 0 -> `0`. */
export function formatFeePercent(bp: number): string {
  return String(Number((bp / 100).toFixed(2)));
}

export interface ContractSignedFields {
  readonly base: string;
  readonly amount: number;
  readonly quote: MarketTokenKey;
  readonly notional: string;
  readonly stallFeeBp: number;
  readonly stallName?: string;
}

/**
 * `Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)`. The token is shown by its plain symbol; the "mock" label
 * (`mockLabel`) lives on the Contracts list badge, not in the sentence (the toast text is fixed by the demo).
 */
export function contractSignedText(d: ContractSignedFields): string {
  const price = d.quote === 'USDC' || d.quote === 'NEAR' ? `${formatAtomic(d.quote, d.notional)} ${d.quote}` : `${d.notional} ${resourceDisplayName(d.quote)}`;
  return `Contract signed: ${d.amount} ${resourceDisplayName(d.base)} for ${price} at ${d.stallName ?? 'the market'} (${formatFeePercent(d.stallFeeBp)} % fee)`;
}
