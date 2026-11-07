import { describe, expect, it } from 'vitest';
import { PlaceOrderPrecheck, wellFormed } from '../../src/market/orders/place-order.precheck.js';

const ok = { side: 'sell', resource: 'bio.water', amount: 10, price: { token: 'USDC', amount: '1000' }, ttlS: 3600 };

describe('place-order precheck malformed args (regression: BigInt SyntaxError escaped the command path)', () => {
  it.each([
    ['fractional amount', { ...ok, amount: 1.5 }],
    ['string amount', { ...ok, amount: '10' }],
    ['negative amount', { ...ok, amount: -1 }],
    ['unsafe amount', { ...ok, amount: 2 ** 60 }],
    ['non-numeric price', { ...ok, price: { token: 'USDC', amount: 'abc' } }],
    ['decimal price', { ...ok, price: { token: 'USDC', amount: '1.5' } }],
    ['negative price', { ...ok, price: { token: 'USDC', amount: '-5' } }],
    ['numeric price', { ...ok, price: { token: 'USDC', amount: 5 } }],
    ['fractional stall fee', { ...ok, maxStallFeeBp: 1.5 }],
    ['huge stall fee', { ...ok, maxStallFeeBp: 20_000 }],
    ['missing price', { ...ok, price: undefined }],
  ])('%s is not well formed', (_n, args) => {
    expect(wellFormed(args as never)).toBe(false);
  });

  it('a valid order is well formed', () => {
    expect(wellFormed(ok as never)).toBe(true);
    expect(wellFormed({ ...ok, maxStallFeeBp: 100 } as never)).toBe(true);
  });

  it('check() returns null (the sim rejects) instead of throwing', async () => {
    const pre = new PlaceOrderPrecheck(
      {} as never, {} as never, {} as never, {} as never,
      { resolve: () => { throw new Error('must not be reached'); } } as never, {} as never, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x' } as never,
    );
    for (const price of [{ token: 'USDC', amount: 'abc' }, { token: 'USDC', amount: '1.5' }]) {
      await expect(pre.check({ kind: 'market.placeOrder', args: { ...ok, price }, playerId: 'p', planetId: 'x', colony: { id: 'c', colonyIndex: 0 }, dev: false } as never)).resolves.toBeNull();
    }
  });
});
