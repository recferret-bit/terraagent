/**
 * Curated Guild offer id (W15-11).
 * Shape: `gof:{orderId}:{quoteSeq}` — the resting NPC order id plus the quote sequence stored on that row.
 * `quoteSeq` starts at 0. A re-quote increments it, so the previous id no longer matches.
 */
const PREFIX = 'gof:';

export function guildOfferId(orderId: string, quoteSeq: number): string {
  return `${PREFIX}${orderId}:${quoteSeq}`;
}

export function parseGuildOfferId(offerId: string): { orderId: string; quoteSeq: number } | null {
  if (!offerId.startsWith(PREFIX)) return null;
  const rest = offerId.slice(PREFIX.length);
  const cut = rest.lastIndexOf(':');
  if (cut <= 0) return null;
  const orderId = rest.slice(0, cut);
  const seq = rest.slice(cut + 1);
  if (orderId.length === 0 || orderId.length > 80 || !/^(0|[1-9]\d{0,8})$/.test(seq)) return null;
  return { orderId, quoteSeq: Number(seq) };
}
