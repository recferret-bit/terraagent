import { planParties as planSharedParties, type SettleParty } from '@terra/sim/systems/trade/market-parties';
import type { TradeBatch } from '@terra/sim/systems/trade/market-batch';
import type { MarketOrderRecord } from '../book/market-order.record.js';

export type { ResourceAmounts, SettleParty } from '@terra/sim/systems/trade/market-parties';

/** Stored in the outbox payload so the FINAL step needs nothing but the row (also after a restart). */
export interface TradePlan {
  readonly tradeId: string;
  readonly planetId: string;
  readonly base: string;
  readonly quote: string;
  readonly qty: number;
  readonly notional: string;
  readonly platformFee: string;
  readonly stallFee: string;
  readonly stallFeeBp: number;
  readonly makerSide: 'buy' | 'sell';
  readonly pair: string;
  readonly organic: boolean;
  readonly parties: SettleParty[];
}

/** Pure: the three parties of a fill (buyer, seller, maker stall); the rule is the shared `planParties` the experiment harness uses. */
export const planParties = (batch: TradeBatch, buyer: MarketOrderRecord, seller: MarketOrderRecord, maker: MarketOrderRecord): SettleParty[] =>
  planSharedParties(batch, buyer, seller, maker);
