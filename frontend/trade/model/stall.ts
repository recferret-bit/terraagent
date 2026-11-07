import { TRADE_KEY_PREFIX, type MarketTokenKey, type TradeStallResponse } from '@terra/contracts';
import { fmtAmount } from './units';

/** Stable `error.code` of `PUT /v1/trade/stall` -> text for the player. */
export function stallErrorText(code: string, details?: Record<string, unknown>): string {
  const pct = (v: unknown): string => (typeof v === 'number' ? `${(v / 100).toFixed(2)} %` : '?');
  switch (code) {
    case 'fee_out_of_range': return `That fee is outside the allowed range (${pct(details?.minBp)} to ${pct(details?.maxBp)}).`;
    case 'forbidden_scope': return 'An API key cannot change the stall fee. Sign in as the player.';
    case 'no_colony': case 'wrong_planet': return 'You have no Trade Hub on this planet.';
    case 'unauthorized': case 'http_401': return 'Your session expired. Sign in again.';
    case 'rate_limited': return 'Too many requests. Try again in a moment.';
    case 'network': return 'The server is not reachable. Try again.';
    default: return `Could not change the stall fee (${code}).`;
  }
}

/** Why the editor is locked, or null when the caller may edit. An API key (`ta_bot_...`) is refused by the server (403). */
export function stallLockReason(token: string, stall: TradeStallResponse | null): string | null {
  if (token.startsWith(TRADE_KEY_PREFIX)) return 'Signed in with an API key. Only the player (session) can change the stall fee.';
  if (!stall) return 'No Trade Hub of yours on this planet, so there is no stall fee to edit.';
  return null;
}

/** Percent text (`0.5`, `0,5`, `1`) -> whole basis points inside the range; a message when it is not a valid fee. */
export function parseFeePercent(text: string, minBp: number, maxBp: number): { bp: number } | { error: string } {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { error: 'Enter a percentage with at most two decimals, for example 0.50.' };
  const bp = Math.round(Number(t) * 100);
  if (bp < minBp || bp > maxBp) return { error: stallErrorText('fee_out_of_range', { minBp, maxBp }) };
  return { bp };
}

/** Earned stall fees (FINAL fills) as "0.10 mock USDC" lines, only tokens above zero. */
export function earnedLines(earned: TradeStallResponse['earned']): string[] {
  return Object.entries(earned).filter(([, v]) => v !== undefined && BigInt(v) > 0n).map(([k, v]) => fmtAmount(k as MarketTokenKey, v as string));
}
