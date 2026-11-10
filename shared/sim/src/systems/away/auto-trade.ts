import type { AutoTradeLimit, AutoTradeOrder, AutoTradePartner } from '@terra/contracts';

function partnerAllowed(limit: AutoTradePartner, partner: AutoTradePartner): boolean {
  if (limit === 'anyone') return true;
  if (limit === 'guild') return partner === 'guild';
  return partner === 'guild' || partner === 'truce';
}

/**
 * AW-13. True only when this give stays inside the per-trade cap, the per-session cap,
 * the stock floor, and the partner list. W13 and W15 call this; they do not reimplement it.
 */
export function withinAutoTrade(limit: AutoTradeLimit, order: AutoTradeOrder): boolean {
  if (order.give > limit.maxPerTrade) return false;
  if (order.sessionSpent + order.give > limit.maxPerSession) return false;
  if (order.stock - order.give < limit.minStock) return false;
  return partnerAllowed(limit.partners, order.partner);
}
