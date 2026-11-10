import type { AutoTradeLimit, AutoTradeOrder, AutoTradePartner } from '@terra/contracts';

/** Extra gates that are not on the W09 order. Omitted fields keep the W09 result. */
export interface AutoTradeCheck {
  /** When false, a `truce` partner is refused. Omitted: the partner list alone decides. */
  readonly truceEnabled?: boolean;
}

function knownPartner(partner: string): partner is AutoTradePartner {
  return partner === 'guild' || partner === 'truce' || partner === 'anyone';
}

function partnerAllowed(limit: AutoTradePartner, partner: string, truceEnabled: boolean | undefined): boolean {
  if (!knownPartner(partner)) return false;
  if (partner === 'truce' && truceEnabled === false) return false;
  if (limit === 'anyone') return true;
  if (limit === 'guild') return partner === 'guild';
  return partner === 'guild' || partner === 'truce';
}

function fillPct(order: AutoTradeOrder): number | undefined {
  if (order.storagePct !== undefined) return order.storagePct;
  if (order.storageCap !== undefined && order.storageCap > 0) return (order.stock / order.storageCap) * 100;
  return undefined;
}

function sellAllowed(limit: AutoTradeLimit, order: AutoTradeOrder): boolean {
  if (order.stock - order.give < limit.minStock) return false;
  if (limit.sellAboveStoragePct === undefined) return true;
  const pct = fillPct(order);
  return pct !== undefined && pct >= limit.sellAboveStoragePct;
}

function buyAllowed(limit: AutoTradeLimit, order: AutoTradeOrder): boolean {
  if (limit.buyBelowStock === undefined) return true;
  return order.stock <= limit.buyBelowStock;
}

/**
 * AW-13. The one autoTrade checker (sim and market). Caps are inclusive (`give` may equal the max).
 * `sellAboveStoragePct` and `buyBelowStock` apply only when present. A sell-above rule with no fill percent refuses.
 */
export function withinAutoTrade(limit: AutoTradeLimit, order: AutoTradeOrder, check?: AutoTradeCheck): boolean {
  if (!partnerAllowed(limit.partners, order.partner, check?.truceEnabled)) return false;
  if (order.give > limit.maxPerTrade) return false;
  if (order.sessionSpent + order.give > limit.maxPerSession) return false;
  return (order.side ?? 'sell') === 'buy' ? buyAllowed(limit, order) : sellAllowed(limit, order);
}
