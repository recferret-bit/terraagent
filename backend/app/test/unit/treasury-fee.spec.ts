import { describe, expect, it } from 'vitest';
import { compileMarketConfig } from '@terra/sim';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { matchIncoming } from '@terra/sim/systems/trade/market-matcher';
import type { MarketOrderRecord } from '../../src/market/book/market-order.record.js';
import { buildFillBatch } from '../../src/market/settlement/batch-builder.js';
import { isOrganicFill } from '../../src/market/settlement/organic.js';
import { treasuryBatchAccount, treasuryFeeOpId, treasuryTerms } from '../../src/market/settlement/treasury-terms.js';

const on = { has: (w: string) => w === 'W22' };
const off = { has: () => false };
const policy = compileMarketConfig({ parameters: {} });

let seq = 0n;
function rec(side: 'buy' | 'sell', actorKind: string, over: Partial<MarketOrderRecord> = {}): MarketOrderRecord {
  seq += 1n;
  const id = `u${seq}`;
  return {
    orderId: id, seq, side, colonyId: `col-${id}`, amount: 1n, filled: 0n, priceAmount: 10_000_000n, ref: `ref-${id}`, planetId: 'p',
    pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', colonyIndex: side === 'buy' ? 1 : 0, playerId: `owner-${actorKind}-${side}`,
    accountId: `acc-${id}`, stallColonyId: `col-${id}`, stallAccountId: side === 'sell' ? 'stall-S' : `stall-${id}`,
    stallHubEntityId: null, platformAccountId: 'plat', fillPolicy: 'partial', policyVersion: 'v1', policyHash: 'h',
    platformFeeBp: 100, stallFeeBp: 100, maxStallFeeBp: side === 'buy' ? 100 : null,
    reservedPrincipal: side === 'sell' ? 1n : 10_000_000n, reservedFees: side === 'buy' ? 300_000n : 0n,
    cumNotional: 0n, feeBuckets: {}, actorKind, state: 'OPEN', ttlS: 3600, expiresAt: new Date(0), createdAt: new Date(0), ...over,
  };
}

function batchOf(buyer: MarketOrderRecord, seller: MarketOrderRecord, enabled: boolean) {
  const book = new OrderBook<MarketOrderRecord>('p');
  book.add(seller);
  const fill = matchIncoming(book as never, buyer as never).fills[0]!;
  const accountId = treasuryBatchAccount('p', enabled ? 'p.dao.mock' : null);
  const terms = treasuryTerms(enabled ? on : off, policy, accountId);
  return { terms, batch: buildFillBatch({ tradeId: 't', fill, orders: new Map([[buyer.orderId, buyer], [seller.orderId, seller]]), treasury: terms }) };
}

const organicOf = (a: MarketOrderRecord, b: MarketOrderRecord): boolean =>
  isOrganicFill({ actorKind: a.actorKind, colonyId: a.colonyId, ownerId: a.playerId }, { actorKind: b.actorKind, colonyId: b.colonyId, ownerId: b.playerId });

describe('W22-07 treasury terms', () => {
  it('reads the share from the market policy and the W22 flag, and names the DAO or the planet label', () => {
    expect(policy.treasuryShareBp).toBe(2000);
    expect(treasuryTerms(on, policy, 'p.dao.mock')).toEqual({ enabled: true, shareBp: 2000, accountId: 'p.dao.mock' });
    expect(treasuryTerms(off, policy, 'treasury:p')).toEqual({ enabled: false, shareBp: 2000, accountId: 'treasury:p' });
    expect(treasuryTerms(on, { treasuryShareBp: 1500 }, 'a').shareBp).toBe(1500);
    expect(treasuryBatchAccount('pw1', null)).toBe('treasury:pw1');
    expect(treasuryBatchAccount('pw1', 'pw1.dao.mock')).toBe('pw1.dao.mock');
    expect(treasuryFeeOpId('tr_abc')).toBe('treasury-fee:tr_abc');
  });

  it('10 USDC: treasury is 20_000 of the platform fee; W22 off keeps the buyer total and drops the carve', () => {
    const buyer = rec('buy', 'player'), seller = rec('sell', 'player', { playerId: 'owner-seller' });
    const live = batchOf(buyer, seller, true).batch;
    const dark = batchOf(buyer, seller, false).batch;
    expect([live.notional, live.platformFee, live.stallFee, live.treasuryAllocation, live.platformRetained]).toEqual([10_000_000n, 100_000n, 100_000n, 20_000n, 80_000n]);
    expect(live.treasuryAllocation + live.platformRetained).toBe(live.platformFee);
    expect(dark.treasuryAllocation).toBe(0n);
    expect(dark.platformRetained).toBe(dark.platformFee);
    expect(dark.notional + dark.platformFee + dark.stallFee).toBe(live.notional + live.platformFee + live.stallFee);
    const usdc = (b: typeof live, account: string) => b.legs.filter((l) => l.accountId === account && l.token === 'USDC').reduce((a, l) => a + l.delta, 0n);
    expect(usdc(live, buyer.accountId)).toBe(-10_200_000n);
    expect(usdc(dark, buyer.accountId)).toBe(-10_200_000n);
    expect(usdc(live, seller.accountId)).toBe(10_000_000n);
    expect(usdc(live, 'stall-S')).toBe(100_000n);
    expect(usdc(live, 'plat')).toBe(80_000n);
    expect(usdc(live, 'p.dao.mock')).toBe(20_000n);
    expect(live.legs.reduce((a, l) => a + (l.token === 'USDC' ? l.delta : 0n), 0n)).toBe(0n);
  });

  it('player, bot and guild fills carve the same treasury bigint, and the organic bit ignores the share', () => {
    const seller = rec('sell', 'player', { playerId: 'owner-seller', colonyId: 'col-s' });
    const treasuries = ['player', 'bot', 'guild'].map((kind) => batchOf(rec('buy', kind, { colonyId: `col-${kind}`, playerId: `owner-${kind}` }), seller, true).batch.treasuryAllocation);
    expect(treasuries).toEqual([20_000n, 20_000n, 20_000n]);
    const buyer = rec('buy', 'bot', { colonyId: 'col-b', playerId: 'owner-b' });
    const guild = rec('buy', 'guild', { colonyId: 'col-g', playerId: null });
    const withShare = batchOf(buyer, seller, true);
    const without = batchOf(buyer, seller, false);
    expect(withShare.terms.enabled).toBe(true);
    expect(without.terms.enabled).toBe(false);
    expect(organicOf(buyer, seller)).toBe(true);
    expect(organicOf(guild, seller)).toBe(false);
    expect(withShare.batch.notional + withShare.batch.platformFee + withShare.batch.stallFee)
      .toBe(without.batch.notional + without.batch.platformFee + without.batch.stallFee);
  });
});
