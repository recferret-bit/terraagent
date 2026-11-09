import { OrderBook } from '../../src/systems/trade/market-book';
import type { MatchableOrder } from '../../src/systems/trade/market-matcher';
import type { BatchOrder } from '../../src/systems/trade/market-batch';

/** Seeded PRNG (mulberry32): the property loops are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
export const randBig = (r: () => number, lo: number, hi: number): bigint => BigInt(randInt(r, lo, hi));
export const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

export type XOrder = MatchableOrder & BatchOrder;
let counter = 0n;
export function xo(side: 'buy' | 'sell', amount: bigint, priceAmount: bigint, over: Partial<XOrder> = {}): XOrder {
  counter += 1n;
  const id = `x${counter}`;
  return {
    orderId: id, seq: counter, side, colonyId: `col-${id}`, accountId: `acc-${id}`, amount, filled: 0n, priceAmount,
    fillPolicy: 'partial', policyVersion: 'v1', platformFeeBp: 100, stallFeeBp: 100, maxStallFeeBp: side === 'buy' ? 100 : null,
    stallColonyId: `col-${id}`, stallAccountId: `stall-${id}`, platformAccountId: 'platform', feeBuckets: {}, cumNotional: 0n,
    reservedPrincipal: side === 'sell' ? amount : priceAmount, reservedFees: side === 'buy' ? priceAmount : 0n, ...over,
  };
}
export const xbook = (...os: XOrder[]): OrderBook<XOrder> => {
  const b = new OrderBook<XOrder>('pair');
  os.forEach((o) => b.add(o));
  return b;
};
