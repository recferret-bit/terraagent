import type { OrderSide } from '@terra/contracts';

/** The consent-gated `track` of the analytics client (`ctx.services.track`); without consent it is a no-op (CLIENT §10, CL-11). */
export type TrackLike = (name: string, props?: Record<string, string | number | boolean | null>) => void;

/** Event names of the Market tab (W13-28); also `Feature.analytics` of the market feature. */
export const MARKET_EVENTS = [
  'market_tab_opened', 'market_order_previewed', 'market_order_placed', 'market_order_cancelled',
  'market_order_rejected', 'market_trade_settled', 'stall_fee_changed',
] as const;

export interface OrderEventProps { pair: string; side: OrderSide; amount: number; quoteToken: string; totalAtomic: string; maxSpendAtomic: string }
export interface SettledEventProps { pair: string; role: 'buyer' | 'seller'; amount: number; notional: string; fees: string; makerSide: OrderSide }

/**
 * The only place the Market tab names analytics events. Props carry the pair, side and exact atomic amounts as decimal strings;
 * they never carry an account, colony or wallet id. Every call is safe without consent (the client drops it).
 */
export class MarketTracker {
  constructor(private readonly track: TrackLike | undefined) {}

  tabOpened(): void { this.track?.('market_tab_opened'); }
  previewed(p: OrderEventProps): void { this.track?.('market_order_previewed', { ...p }); }
  placed(p: OrderEventProps): void { this.track?.('market_order_placed', { ...p }); }
  cancelled(pair: string, side: OrderSide, amount: number): void { this.track?.('market_order_cancelled', { pair, side, amount }); }
  rejected(code: string, p?: Partial<OrderEventProps>): void { this.track?.('market_order_rejected', { code, ...(p?.pair ? { pair: p.pair } : {}), ...(p?.side ? { side: p.side } : {}), ...(p?.amount ? { amount: p.amount } : {}) }); }
  settled(p: SettledEventProps): void {
    // `side` is the colony's own side of the trade, derived from its role.
    this.track?.('market_trade_settled', { ...p, side: p.role === 'buyer' ? 'buy' : 'sell' });
  }
  stallFeeChanged(bp: number): void { this.track?.('stall_fee_changed', { bp }); }
}
