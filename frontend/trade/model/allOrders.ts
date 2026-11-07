import type { ActorKind, OrderSide, TradeBookOrderView, TradeOrderView } from '@terra/contracts';
import type { Ratio } from './units';

/** Unit price of an own order as an exact rational: total quote / amount. */
export const orderPrice = (o: TradeOrderView): Ratio => ({ num: o.price.amount, den: o.amount });

export const ACTOR_ORDER: readonly ActorKind[] = ['player', 'bot', 'npc', 'guild', 'fixture', 'subsidy'];
/** Badge style per actor kind (`tr-badge-*`): fixtures dashed, bots blue-outline, subsidy system blue. */
export const ACTOR_BADGE: Readonly<Record<ActorKind, string>> = { player: 'ok', bot: 'info', npc: 'dim', guild: 'warn', fixture: 'fixture', subsidy: 'system' };

/** Rows of the all-orders table: the API order (best price first per side, bids then asks), optionally narrowed to one side. */
export function visibleOrders(orders: readonly TradeBookOrderView[], side: OrderSide | null): TradeBookOrderView[] {
  return side ? orders.filter((o) => o.side === side) : [...orders];
}

/** Count of resting orders per actor kind (kinds that have none are omitted), in `ACTOR_ORDER`. */
export function actorCounts(orders: readonly TradeBookOrderView[]): Array<[ActorKind, number]> {
  const n = new Map<ActorKind, number>();
  for (const o of orders) n.set(o.actorKind, (n.get(o.actorKind) ?? 0) + 1);
  return ACTOR_ORDER.filter((k) => n.has(k)).map((k) => [k, n.get(k)!]);
}

/** Actor mix of a board row sorted like `ACTOR_ORDER`, zero counts dropped. */
export function mixEntries(mix: Partial<Record<ActorKind, number>> | undefined): Array<[ActorKind, number]> {
  return ACTOR_ORDER.filter((k) => (mix?.[k] ?? 0) > 0).map((k) => [k, mix![k]!]);
}

/** Usage of a key's daily budget: percent used (0..100, clamped), or null when the server sent no usage. */
export function usagePercent(spent: string | undefined, budget: string): number | null {
  if (spent === undefined) return null;
  const b = BigInt(budget);
  if (b <= 0n) return 100;
  const pct = Number((BigInt(spent) * 10_000n) / b) / 100;
  return Math.max(0, Math.min(100, pct));
}
