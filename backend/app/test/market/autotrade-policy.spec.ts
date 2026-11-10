import 'reflect-metadata';
import type { AutoTradeLimit, AutoTradeOrder } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { withinAutoTrade } from '@terra/sim/systems/away/auto-trade';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DirectorLoopService } from '../../src/market/director/director-loop.service.js';
import { DirectorMarketPort, type DirectorFill, type DirectorPlace } from '../../src/market/director/director-market.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';
import type { DirectorKeyRepository, DirectorKeyRow } from '../../src/near/director-key/director-key.repository.js';
import { NearException } from '../../src/near/domain/errors.js';
import { InMemoryAgentWallet } from '../../src/near/testing/in-memory-agent-wallet.js';

const limit: AutoTradeLimit = {
  maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild', sellAboveStoragePct: 80,
};
const tight: AutoTradeLimit = { ...limit, maxPerSession: 300 };
const reference = { num: 1_000_000n, den: 1n };
const ownUnitCost = { num: 800_000n, den: 1n };

function claim(give: number, sessionSpent: number): AutoTradeOrder {
  return {
    resource: 'metals.t1', give, stock: 1400, sessionSpent, partner: 'guild', side: 'sell', storagePct: 93, storageCap: 1500,
  };
}

function view(colonyId: string, rowLimit: AutoTradeLimit = limit): DirectorColonyView {
  return {
    colonyId, colonyIndex: 0, planetId: 'pl_dir', playerId: 'player-1', away: true, tick: 30,
    rows: [{
      forecast: {
        resource: 'metals.t1', stock: 1400, storageCap: 1500, queued: 0, reserved: 0, serviceWindow: 0,
        reserveFloor: 200, reserveHorizon: 0, sessionSpent: 0, partner: 'guild', limit: rowLimit,
      },
      reference, ownUnitCost, target: 750,
    }],
  };
}

class FixedSource extends DirectorColonySource {
  constructor(private readonly row: DirectorColonyView) { super(); }
  load(): Promise<DirectorColonyView | null> { return Promise.resolve(this.row); }
  listAway(): Promise<readonly string[]> { return Promise.resolve([]); }
}

class ScriptedMarket extends DirectorMarketPort {
  readonly placed: DirectorPlace[] = [];
  mode: DirectorFill['status'] | 'filled' = 'filled';
  constructor(private readonly onPlace?: (order: DirectorPlace) => Promise<void> | void) { super(); }
  async place(order: DirectorPlace): Promise<DirectorFill> {
    this.placed.push(order);
    await this.onPlace?.(order);
    if (this.mode === 'rejected') return { status: 'rejected', code: 'no_trade_hub' };
    if (this.mode === 'open') return { status: 'open' };
    return { status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' };
  }
}

class MemKeys {
  constructor(public row: DirectorKeyRow | null) {}
  find(): Promise<DirectorKeyRow | null> { return Promise.resolve(this.row); }
  save(): Promise<void> { return Promise.resolve(); }
}

async function openKey(tag: string, allowance = '600') {
  const wallet = new InMemoryAgentWallet();
  const name = `${tag}${Math.random().toString(36).slice(2, 8)}`;
  const created = await wallet.createSubAccount({ opId: `acct:${name}`, parent: 'npc.terraagent.mock', name });
  const publicKey = `ed25519:${name}`;
  await wallet.addLimitedKey({
    opId: `key:${name}`, accountId: created.accountId, publicKey, allowance: '0', receiverId: 'intents.near',
    methodNames: ['execute_intents'], tokens: [{ token: 'metals.t1', allowance }],
  });
  return { wallet, accountId: created.accountId, publicKey };
}

function loop(source: DirectorColonyView, market: DirectorMarketPort, keys: MemKeys, wallet: InMemoryAgentWallet) {
  const flags = new FlagsService({ TA_WAVES: 'all' } as never);
  const service = new DirectorLoopService(flags, wallet, keys as unknown as DirectorKeyRepository, new EventBus(), new FixedSource(source), market);
  return service;
}

async function metals(wallet: InMemoryAgentWallet, accountId: string, publicKey: string) {
  const status = await wallet.keyStatus({ accountId, publicKey });
  const row = status.tokens.find((token) => token.token === 'metals.t1');
  if (!row) throw new Error('missing metals');
  return { status, row };
}

function codeOf(err: unknown): string | undefined {
  return err instanceof NearException ? err.errorCode : undefined;
}

describe('W15-30 autoTrade policy bounds', () => {
  it('allows the last session unit and refuses one past the cap', () => {
    expect(withinAutoTrade(limit, claim(300, 0))).toBe(true);
    expect(withinAutoTrade(limit, claim(300, 300))).toBe(true);
    expect(withinAutoTrade(tight, claim(300, 0))).toBe(true);
    expect(withinAutoTrade(limit, claim(301, 0))).toBe(false);
    expect(withinAutoTrade(limit, claim(300, 301))).toBe(false);
    expect(withinAutoTrade(limit, claim(1, 600))).toBe(false);
    expect(withinAutoTrade(limit, claim(0, 600))).toBe(true);
  });
});

describe('W15-30 director sell hold', () => {
  it('reserves 300 metal for a 300 sell and refuses a unit once nothing is left', async () => {
    const opened = await openKey('fee', '300');
    const colonyId = 'co_fee';
    const keys = new MemKeys({ colonyId, accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: null });
    let quote = 0n;
    let extra = '';
    const market = new ScriptedMarket(async (order) => {
      const { status, row } = await metals(opened.wallet, opened.accountId, opened.publicKey);
      expect(row).toMatchObject({ allowance: '300', reserved: '300', spent: '0', available: '0' });
      expect(status.tokens.map((token) => token.token)).toEqual(['metals.t1']);
      expect(status.gasSpent).toBe('0');
      const args = order.command.args as { amount?: number; price?: { token?: string; amount?: string } };
      expect(args.amount).toBe(300);
      expect(args.price?.token).toBe('USDC');
      quote = BigInt(args.price?.amount ?? '0');
      expect(quote).toBeGreaterThan(300n);
      try {
        await opened.wallet.reserveAllowance({
          opId: 'fee:extra', accountId: opened.accountId, publicKey: opened.publicKey, token: 'metals.t1', amount: '1',
        });
        extra = 'accepted';
      } catch (err) {
        extra = codeOf(err) ?? 'throw';
      }
    });
    const service = loop(view(colonyId, tight), market, keys, opened.wallet);
    const sold = await service.runDirectorOnce(colonyId);
    expect(sold).toMatchObject({ ok: true, amount: 300, spent: 300, allowance: 300 });
    expect(extra).toBe('NEAR_ALLOWANCE_EXHAUSTED');
    expect(BigInt((await metals(opened.wallet, opened.accountId, opened.publicKey)).row.spent)).toBeLessThan(quote);
    expect(await service.runDirectorOnce(colonyId)).toEqual({ ok: false, skip: 'allowance_exhausted' });
    expect(market.placed).toHaveLength(1);
    expect((await metals(opened.wallet, opened.accountId, opened.publicKey)).row).toMatchObject({
      reserved: '0', spent: '300', available: '0',
    });
  });

  it('one of two reserves holds and the other exhausts inside the allowance', async () => {
    const opened = await openKey('race');
    const ref = { accountId: opened.accountId, publicKey: opened.publicKey, token: 'metals.t1' };
    const raced = await Promise.allSettled([
      opened.wallet.reserveAllowance({ opId: 'race:a', ...ref, amount: '400' }),
      opened.wallet.reserveAllowance({ opId: 'race:b', ...ref, amount: '400' }),
    ]);
    expect(raced.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = raced.find((item) => item.status === 'rejected');
    expect(codeOf(rejected && rejected.status === 'rejected' ? rejected.reason : undefined)).toBe('NEAR_ALLOWANCE_EXHAUSTED');
    const { row } = await metals(opened.wallet, opened.accountId, opened.publicKey);
    expect(row).toMatchObject({ allowance: '600', reserved: '400', spent: '0', available: '200' });
    expect(BigInt(row.reserved) + BigInt(row.spent) + BigInt(row.available)).toBe(600n);
  });

  it('a partial fill then cancel releases the unused hold and a further release does not', async () => {
    const opened = await openKey('part');
    const ref = { accountId: opened.accountId, publicKey: opened.publicKey, token: 'metals.t1' };
    await opened.wallet.reserveAllowance({ opId: 'part:rsv', ...ref, amount: '300' });
    await opened.wallet.consumeAllowance({ opId: 'part:use', ...ref, amount: '200' });
    await opened.wallet.releaseAllowance({ opId: 'part:rel', ...ref, amount: '100' });
    expect((await metals(opened.wallet, opened.accountId, opened.publicKey)).row).toMatchObject({
      reserved: '0', spent: '200', available: '400',
    });
    await expect(opened.wallet.releaseAllowance({ opId: 'part:over', ...ref, amount: '1' })).rejects.toMatchObject({
      errorCode: 'NEAR_ALLOWANCE_EXHAUSTED',
    });
    expect((await metals(opened.wallet, opened.accountId, opened.publicKey)).row.spent).toBe('200');
  });
});

describe('W15-30 revoke races', () => {
  it('revoke before submit places no order', async () => {
    const opened = await openKey('pre');
    await opened.wallet.revokeKey({ opId: 'pre:revoke', accountId: opened.accountId, publicKey: opened.publicKey });
    const market = new ScriptedMarket();
    const keys = new MemKeys({ colonyId: 'co_pre', accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: null });
    const ran = await loop(view('co_pre'), market, keys, opened.wallet).runDirectorOnce('co_pre');
    expect(ran).toEqual({ ok: false, skip: 'director_key_revoked' });
    expect(market.placed).toHaveLength(0);
    const { status, row } = await metals(opened.wallet, opened.accountId, opened.publicKey);
    expect(status.revoked).toBe(true);
    expect(row).toMatchObject({ reserved: '0', spent: '0', available: '600' });
  });

  it('revoke after the reserve and before consume leaves spent at the consumed part', async () => {
    const opened = await openKey('mid');
    const ref = { accountId: opened.accountId, publicKey: opened.publicKey, token: 'metals.t1' };
    await opened.wallet.reserveAllowance({ opId: 'mid:seed', ...ref, amount: '100' });
    await opened.wallet.consumeAllowance({ opId: 'mid:seed-use', ...ref, amount: '100' });
    const market = new ScriptedMarket(async () => {
      await opened.wallet.revokeKey({ opId: 'mid:revoke', accountId: opened.accountId, publicKey: opened.publicKey });
    });
    const keys = new MemKeys({ colonyId: 'co_mid', accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: null });
    await expect(loop(view('co_mid'), market, keys, opened.wallet).runDirectorOnce('co_mid')).rejects.toMatchObject({
      errorCode: 'NEAR_KEY_REVOKED',
    });
    expect(market.placed).toHaveLength(1);
    const { row } = await metals(opened.wallet, opened.accountId, opened.publicKey);
    expect(row.spent).toBe('100');
    expect(BigInt(row.reserved) + BigInt(row.spent) <= 600n).toBe(true);
    await expect(opened.wallet.consumeAllowance({ opId: 'mid:more', ...ref, amount: '1' })).rejects.toMatchObject({
      errorCode: 'NEAR_KEY_REVOKED',
    });
    expect((await metals(opened.wallet, opened.accountId, opened.publicKey)).row.spent).toBe('100');
  });
});

describe('W15-30 final failure and an open order', () => {
  it('a reject releases the hold and an open order keeps it', async () => {
    const rejected = await openKey('rej');
    const rejectMarket = new ScriptedMarket();
    rejectMarket.mode = 'rejected';
    const rejectKeys = new MemKeys({
      colonyId: 'co_rej', accountId: rejected.accountId, publicKey: rejected.publicKey, revokedAt: null,
    });
    const missed = await loop(view('co_rej'), rejectMarket, rejectKeys, rejected.wallet).runDirectorOnce('co_rej');
    expect(missed).toEqual({ ok: false, skip: 'no_trade_hub' });
    expect(rejectMarket.placed).toHaveLength(1);
    expect((await metals(rejected.wallet, rejected.accountId, rejected.publicKey)).row).toMatchObject({
      reserved: '0', spent: '0', available: '600',
    });

    const opened = await openKey('open');
    const openMarket = new ScriptedMarket();
    openMarket.mode = 'open';
    const openKeys = new MemKeys({
      colonyId: 'co_open', accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: null,
    });
    const waiting = await loop(view('co_open'), openMarket, openKeys, opened.wallet).runDirectorOnce('co_open');
    expect(waiting).toEqual({ ok: false, skip: 'awaiting_fill' });
    expect(openMarket.placed).toHaveLength(1);
    expect((await metals(opened.wallet, opened.accountId, opened.publicKey)).row).toMatchObject({
      reserved: '300', spent: '0', available: '300',
    });
  });
});
