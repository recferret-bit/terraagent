import { runtimeLabel } from './context';
import { trackProduct } from './trackSafe';

const TRADE_REASONS = ['validation', 'rejected', 'network', 'insufficient', 'expired', 'timeout', 'unknown'] as const;
export type TradeReason = (typeof TRADE_REASONS)[number];
export type ClientTradeReason = 'network' | 'timeout' | 'unknown';

let pageNoted = false;
let ticketNoted = false;

const PAIR_TOKEN = /[^A-Za-z0-9._-]/g;

export function tradePairToken(pair: string): string {
  return pair.replace(/\//g, '-').replace(PAIR_TOKEN, '').slice(0, 64);
}

/** Maps API codes onto every catalog trade reason. Client transport failures use `clientTradeReason`. */
export function mapTradeReason(code: string | undefined): TradeReason {
  const value = (code ?? '').toLowerCase();
  if (value.includes('valid')) return 'validation';
  if (value.includes('insufficient') || value.includes('balance')) return 'insufficient';
  if (value.includes('expire')) return 'expired';
  if (value.includes('timeout') || value.includes('timed out')) return 'timeout';
  if (value.includes('network')) return 'network';
  if (value.includes('reject') || value.includes('forbidden') || value.includes('denied')) return 'rejected';
  return 'unknown';
}

export function clientTradeReason(err: unknown): ClientTradeReason | null {
  const status = typeof statusOf(err) === 'number' ? statusOf(err) : undefined;
  if (status !== undefined && status !== 0) return null;
  const text = `${codeOf(err)} ${messageOf(err)}`.toLowerCase();
  if (!text.trim() && status !== 0) return null;
  if (text.includes('timeout') || text.includes('timed out') || codeOf(err) === 'timeout') return 'timeout';
  if (status === 0 || codeOf(err) === 'network' || text.includes('network') || text.includes('failed to fetch')) return 'network';
  if (status === 0) return 'unknown';
  return null;
}

export function noteTradePageViewed(): void {
  if (pageNoted) return;
  pageNoted = true;
  trackProduct('trade_page_viewed', { runtime: runtimeLabel() });
}

export function noteTradeTicketOpened(pair: string): void {
  if (ticketNoted) return;
  ticketNoted = true;
  trackProduct('trade_ticket_opened', { pair: tradePairToken(pair), runtime: runtimeLabel() });
}

export function noteTradeSubmitClicked(pair: string, side: string): void {
  if (side !== 'buy' && side !== 'sell') return;
  trackProduct('trade_submit_clicked', { pair: tradePairToken(pair), side, runtime: runtimeLabel() });
}

/** Client failure only when the request never returns JSON. HTTP 422 stays on the server event. */
export function noteTradeClientFailure(pair: string, side: string, err: unknown): void {
  const reason = clientTradeReason(err);
  if (!reason || (side !== 'buy' && side !== 'sell')) return;
  trackProduct('trade_order_failed', {
    pair: tradePairToken(pair), side, reason, source: 'client',
  });
}

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object' || !('status' in err)) return undefined;
  const status = (err as { status: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function codeOf(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return '';
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (!err || typeof err !== 'object' || !('message' in err)) return '';
  const message = (err as { message: unknown }).message;
  return typeof message === 'string' ? message : '';
}
