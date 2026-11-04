import { isResourceToken, type MarketTokenKey } from '@terra/contracts';
import type { TradeBatch } from '@terra/sim/systems/trade/market-batch';
import type { MarketOrderRecord } from '../book/market-order.record.js';

export type ResourceAmounts = Record<string, number>;

/** What one colony's sim mirror receives for a FINAL trade (`market.settled`): whole-unit in-orbit deltas and consumed reservations. */
export interface SettleParty {
  readonly role: 'buyer' | 'seller' | 'stall';
  readonly colonyId: string;
  readonly colonyIndex: number | null;
  readonly ref: string | null;
  readonly deltas: ResourceAmounts;
  readonly released: ResourceAmounts;
}

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

const isRes = (t: string): boolean => isResourceToken(t as MarketTokenKey);
const add = (m: ResourceAmounts, token: string, n: bigint): void => {
  if (n !== 0n && isRes(token)) m[token] = (m[token] ?? 0) + Number(n);
};

/** Pure: the three parties of a fill (buyer, seller, maker stall). Cash tokens never touch the sim mirror. */
export function planParties(batch: TradeBatch, buyer: MarketOrderRecord, seller: MarketOrderRecord, maker: MarketOrderRecord): SettleParty[] {
  const b: ResourceAmounts = {}, bRel: ResourceAmounts = {};
  add(b, batch.base, batch.qty);
  add(b, batch.quote, -(batch.notional + batch.platformFee + batch.stallFee));
  add(bRel, batch.quote, batch.notional + batch.platformFee + batch.stallFee + batch.buyer.releasePrincipal + batch.buyer.releaseFees);
  const s: ResourceAmounts = {}, sRel: ResourceAmounts = {};
  add(s, batch.base, -batch.qty);
  add(s, batch.quote, batch.notional);
  add(sRel, batch.base, batch.qty + batch.seller.releasePrincipal);
  const parties: SettleParty[] = [
    { role: 'buyer', colonyId: buyer.colonyId, colonyIndex: buyer.colonyIndex, ref: buyer.ref, deltas: b, released: bRel },
    { role: 'seller', colonyId: seller.colonyId, colonyIndex: seller.colonyIndex, ref: seller.ref, deltas: s, released: sRel },
  ];
  if (batch.stallFee > 0n) {
    const st: ResourceAmounts = {};
    add(st, batch.quote, batch.stallFee);
    parties.push({ role: 'stall', colonyId: maker.stallColonyId, colonyIndex: maker.stallColonyId === maker.colonyId ? maker.colonyIndex : null, ref: null, deltas: st, released: {} });
  }
  return parties;
}
