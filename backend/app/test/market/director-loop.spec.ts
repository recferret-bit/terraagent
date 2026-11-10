import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { AutoTradeLimit } from '@terra/contracts';
import { priceDirectorOrder } from '@terra/sim';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DirectorLoopService } from '../../src/market/director/director-loop.service.js';
import {
  DirectorMarketPort,
  type DirectorFill,
  type DirectorPlace,
} from '../../src/market/director/director-market.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';
import { loadDirectorTerms } from '../../src/market/director/director-terms.js';
import type { DirectorKeyRepository, DirectorKeyRow } from '../../src/near/director-key/director-key.repository.js';
import { InMemoryAgentWallet } from '../../src/near/testing/in-memory-agent-wallet.js';

const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};
const reference = { num: 1_000_000n, den: 1n };
const ownUnitCost = { num: 800_000n, den: 1n };

function view(colonyId = 'co_dir'): DirectorColonyView {
  return {
    colonyId,
    colonyIndex: 0,
    planetId: 'pl_dir',
    playerId: 'player-1',
    away: true,
    tick: 12,
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
        reference,
        ownUnitCost,
        target: 750,
      },
    ],
  };
}

class MemSource extends DirectorColonySource {
  loads = 0;
  constructor(private readonly row: DirectorColonyView | null) {
    super();
  }
  async load(): Promise<DirectorColonyView | null> {
    this.loads += 1;
    return this.row;
  }
  async listAway(): Promise<readonly string[]> {
    return this.row?.away ? [this.row.colonyId] : [];
  }
}

class MemMarket extends DirectorMarketPort {
  readonly placed: DirectorPlace[] = [];
  mode: 'filled' | 'rejected' = 'filled';
  async place(order: DirectorPlace): Promise<DirectorFill> {
    this.placed.push(order);
    if (this.mode === 'rejected') return { status: 'rejected', code: 'no_trade_hub' };
    return { status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' };
  }
}

class MemKeys {
  saved = 0;
  constructor(public row: DirectorKeyRow | null) {}
  async find(): Promise<DirectorKeyRow | null> {
    return this.row;
  }
  async save(): Promise<void> {
    this.saved += 1;
  }
}

async function openKey(tag: string) {
  const wallet = new InMemoryAgentWallet();
  const name = `${tag}${Math.random().toString(36).slice(2, 8)}`;
  const created = await wallet.createSubAccount({ opId: `acct:${name}`, parent: 'npc.terraagent.mock', name });
  const publicKey = `ed25519:${name}`;
  await wallet.addLimitedKey({
    opId: `key:${name}`,
    accountId: created.accountId,
    publicKey,
    allowance: '0',
    receiverId: 'intents.near',
    methodNames: ['execute_intents'],
    tokens: [{ token: 'metals.t1', allowance: '600' }],
  });
  return { wallet, accountId: created.accountId, publicKey };
}

function loop(
  waves: string,
  source: DirectorColonySource,
  market: DirectorMarketPort,
  keys: MemKeys,
  wallet: InMemoryAgentWallet,
) {
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const bus = new EventBus();
  const events: { kind: string; data: unknown }[] = [];
  const pushed: { spent?: string; available?: string }[] = [];
  bus.on('planet.event', (event) => events.push({ kind: event.kind, data: event.data }), { module: 'test' });
  bus.on(
    'director.status',
    (event) => {
      const token = event.payload.tokens.find((row) => row.token === 'metals.t1');
      pushed.push({ spent: token?.spent, available: token?.available });
    },
    { module: 'test' },
  );
  const service = new DirectorLoopService(flags, wallet, keys as unknown as DirectorKeyRepository, bus, source, market);
  return { service, events, pushed, flags };
}

async function metals(wallet: InMemoryAgentWallet, accountId: string, publicKey: string) {
  const status = await wallet.keyStatus({ accountId, publicKey });
  const row = status.tokens.find((token) => token.token === 'metals.t1');
  if (!row) throw new Error('missing metals');
  return row;
}

describe('W15-21 director loop', () => {
  it('sells one 300 and the next tick does not sell another 300', async () => {
    const opened = await openKey('sell');
    const market = new MemMarket();
    const source = new MemSource(view());
    const keys = new MemKeys({
      colonyId: 'co_dir',
      accountId: opened.accountId,
      publicKey: opened.publicKey,
      revokedAt: null,
    });
    const { service, events, pushed, flags } = loop('all', source, market, keys, opened.wallet);

    const sold = await service.runDirectorOnce('co_dir');
    expect(sold).toEqual({ ok: true, side: 'sell', resource: 'metals.t1', amount: 300, spent: 300, allowance: 600 });
    const terms = loadDirectorTerms(flags.flags);
    const priced = priceDirectorOrder(
      {
        resource: 'metals.t1',
        side: 'sell',
        amount: 300,
        stock: 1400,
        target: 750,
        reference,
        ownUnitCost,
        platformFeeBp: terms!.platformFeeBp,
        maxStallFeeBp: terms!.maxStallFeeBp,
        lotUnits: terms!.lotUnits,
        minNotionalAtomic: terms!.minNotionalAtomic,
      },
      terms!.params,
    );
    expect(market.placed[0]?.command.source).toBe('player');
    expect(market.placed[0]?.command.colonyIndex).toBe(0);
    expect(market.placed[0]?.command.kind).toBe('market.placeOrder');
    expect(market.placed[0]?.command.args).toMatchObject({
      side: 'sell',
      resource: 'metals.t1',
      amount: 300,
      price: priced?.price,
    });
    expect(events.map((event) => event.kind)).toEqual(['directorOrderRequested', 'directorTrade']);
    expect(events[1]?.data).toMatchObject({
      amount: 300,
      counterparty: 'Guild',
      spent: 300,
      allowance: 600,
      resource: 'metals.t1',
    });
    expect(pushed.at(-1)).toEqual({ spent: '300', available: '300' });
    expect(await metals(opened.wallet, opened.accountId, opened.publicKey)).toMatchObject({
      spent: '300',
      available: '300',
      allowance: '600',
    });

    const again = await service.runDirectorOnce('co_dir');
    expect(again).toEqual({ ok: false, skip: 'session_cap' });
    expect(market.placed).toHaveLength(1);
    expect(await metals(opened.wallet, opened.accountId, opened.publicKey)).toMatchObject({
      spent: '300',
      available: '300',
    });
  });

  it('a missing key, a revoked key, a reject, and W15 off do not spend', async () => {
    const opened = await openKey('skip');
    const market = new MemMarket();
    const source = new MemSource(view('co_miss'));
    const keys = new MemKeys(null);
    const missing = loop('all', source, market, keys, opened.wallet);
    expect(await missing.service.runDirectorOnce('co_miss')).toEqual({ ok: false, skip: 'director_key_missing' });
    expect(market.placed).toHaveLength(0);

    keys.row = { colonyId: 'co_miss', accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: new Date() };
    expect(await missing.service.runDirectorOnce('co_miss')).toEqual({ ok: false, skip: 'director_key_revoked' });
    expect(market.placed).toHaveLength(0);

    keys.row = { colonyId: 'co_miss', accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: null };
    market.mode = 'rejected';
    const rejected = await missing.service.runDirectorOnce('co_miss');
    expect(rejected).toEqual({ ok: false, skip: 'no_trade_hub' });
    expect(await metals(opened.wallet, opened.accountId, opened.publicKey)).toMatchObject({
      spent: '0',
      reserved: '0',
      available: '600',
    });

    const offSource = new MemSource(view('co_off'));
    const offMarket = new MemMarket();
    const off = loop('..14', offSource, offMarket, keys, opened.wallet);
    expect(await off.service.runDirectorOnce('co_off')).toEqual({ ok: false, skip: 'wave_disabled' });
    expect(offSource.loads).toBe(0);
    expect(offMarket.placed).toHaveLength(0);
    expect(await metals(opened.wallet, opened.accountId, opened.publicKey)).toMatchObject({
      spent: '0',
      available: '600',
    });
  });
});
