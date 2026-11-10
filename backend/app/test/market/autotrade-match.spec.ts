import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { AutoTradeLimit, AutoTradeOrder } from '@terra/contracts';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { directorAutoTradeCode, matchIncoming, type MatchableOrder } from '@terra/sim/systems/trade/market-matcher';
import type { AgentWalletPort, KeyStatus } from '../../src/near/application/ports/agent-wallet.port.js';
import type { DirectorKeyRepository, DirectorKeyRow } from '../../src/near/director-key/director-key.repository.js';
import { DirectorMatchGuard } from '../../src/market/director/director-match-guard.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';

const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};

function claim(give: number, sessionSpent = 0): AutoTradeOrder {
  return {
    resource: 'metals.t1',
    give,
    stock: 1400,
    sessionSpent,
    partner: 'guild',
    side: 'sell',
    storagePct: 93,
    storageCap: 1500,
  };
}

function order(side: 'buy' | 'sell', amount: bigint, over: Partial<MatchableOrder> = {}): MatchableOrder {
  return {
    orderId: side === 'buy' ? 'bid' : 'ask',
    seq: side === 'buy' ? 1n : 2n,
    side,
    colonyId: side === 'buy' ? 'guild' : 'dir',
    amount,
    filled: 0n,
    priceAmount: amount,
    fillPolicy: 'partial',
    policyVersion: 'v1',
    platformFeeBp: 100,
    stallFeeBp: 0,
    maxStallFeeBp: side === 'buy' ? 100 : null,
    ...over,
  };
}

function book(amount: bigint): OrderBook<MatchableOrder> {
  const next = new OrderBook<MatchableOrder>('metals.t1/USDC');
  next.add(order('buy', amount));
  return next;
}

function view(): DirectorColonyView {
  return {
    colonyId: 'co_dir',
    colonyIndex: 0,
    planetId: 'pl_dir',
    playerId: 'player-1',
    away: true,
    tick: 1,
    rows: [
      {
        forecast: {
          resource: 'metals.t1',
          stock: 1400,
          storageCap: 1500,
          queued: 0,
          reserved: 0,
          serviceWindow: 0,
          reserveFloor: 200,
          reserveHorizon: 0,
          sessionSpent: 0,
          partner: 'guild',
          limit,
        },
        reference: null,
        ownUnitCost: null,
        target: 750,
      },
    ],
  };
}

class MemSource extends DirectorColonySource {
  async load(): Promise<DirectorColonyView | null> {
    return view();
  }
  async listAway(): Promise<readonly string[]> {
    return ['co_dir'];
  }
}

function guard(spent: string, revoked = false): DirectorMatchGuard {
  const row: DirectorKeyRow = {
    colonyId: 'co_dir',
    accountId: 'co_dir.terraagent.mock',
    publicKey: 'ed25519:x',
    revokedAt: revoked ? new Date(0) : null,
  };
  const keys = { find: async () => row } as unknown as DirectorKeyRepository;
  const status = {
    accountId: row.accountId,
    publicKey: row.publicKey,
    revoked: false,
    receiverId: 'intents.near',
    methodNames: [],
    tokens: [{ token: 'metals.t1', allowance: '600', reserved: '0', spent, available: '0' }],
    gasAllowance: '0',
    gasSpent: '0',
  } as KeyStatus;
  const wallet = { keyStatus: async () => status } as unknown as AgentWalletPort;
  return new DirectorMatchGuard(new MemSource(), keys, wallet);
}

const sell = (amount: number) => ({ colonyId: 'co_dir', resource: 'metals.t1' as const, amount, side: 'sell' as const });

describe('W15-20 market re-check before match', () => {
  it('rejects a director order of 400 and still matches a player order of 400', () => {
    const director = order('sell', 400n, { autoTrade: { limit, order: claim(400) } });
    const refused = matchIncoming(book(400n), director);
    expect(refused.fills).toEqual([]);
    expect(refused.code).toBe('autotrade_limit');
    expect(refused.restingRemainder).toBe(400n);
    expect(directorAutoTradeCode(undefined, 400)).toBeUndefined();
    const player = matchIncoming(book(400n), order('sell', 400n));
    expect(player.code).toBeUndefined();
    expect(player.fills).toHaveLength(1);
    expect(player.fills[0]?.qty).toBe(400n);
  });

  it('uses the book amount when the claim still says 300', () => {
    const stale = order('sell', 400n, { autoTrade: { limit, order: claim(300) } });
    expect(matchIncoming(book(400n), stale).code).toBe('autotrade_limit');
  });

  it('keeps the inclusive per-trade and per-session caps', () => {
    expect(directorAutoTradeCode({ limit, order: claim(300) })).toBeUndefined();
    expect(matchIncoming(book(300n), order('sell', 300n, { autoTrade: { limit, order: claim(300) } })).fills).toHaveLength(1);
    expect(directorAutoTradeCode({ limit, order: claim(301) })).toBe('autotrade_limit');
    expect(matchIncoming(book(301n), order('sell', 301n, { autoTrade: { limit, order: claim(301) } })).code).toBe('autotrade_limit');
    expect(directorAutoTradeCode({ limit, order: claim(300, 300) })).toBeUndefined();
    expect(matchIncoming(book(300n), order('sell', 300n, { autoTrade: { limit, order: claim(300, 300) } })).fills).toHaveLength(1);
    expect(directorAutoTradeCode({ limit, order: claim(300, 301) })).toBe('autotrade_limit');
    expect(matchIncoming(book(300n), order('sell', 300n, { autoTrade: { limit, order: claim(300, 301) } })).fills).toEqual([]);
  });

  it('asks withinAutoTrade again from the colony limit and the key spent', async () => {
    expect(await guard('0').block(sell(400))).toBe('autotrade_limit');
    expect(await guard('0').block(sell(300))).toBeUndefined();
    expect(await guard('0').block(sell(301))).toBe('autotrade_limit');
    expect(await guard('300').block(sell(300))).toBeUndefined();
    expect(await guard('301').block(sell(300))).toBe('autotrade_limit');
    expect(await guard('0', true).block(sell(300))).toBe('autotrade_limit');
  });
});
