import 'reflect-metadata';
import type { DirectorKeyStatusPayload } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeyStatus } from '../../src/near/application/ports/agent-wallet.port.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DirectorLoopService } from '../../src/market/director/director-loop.service.js';
import { DirectorMarketPort, type DirectorFill, type DirectorPlace } from '../../src/market/director/director-market.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';
import { DirectorKeyController } from '../../src/near/director-key/director-key.controller.js';
import { DirectorKeyRepository } from '../../src/near/director-key/director-key.repository.js';
import { DirectorKeyService } from '../../src/near/director-key/director-key.service.js';
import { devBearerPlayer } from '../../src/ws/session-verifier.js';

let db: TestDatabase;
let seat = 0;
const owner = devBearerPlayer('dev:owner')!;
const stranger = devBearerPlayer('dev:other')!;
const sleep = async () => undefined;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 18 };

function limit(maxPerSession: number) {
  return { maxPerTrade: Math.min(300, maxPerSession), maxPerSession, minStock: 0, partners: 'guild' as const };
}

function asBearer(token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
}

function open(waves = 'all') {
  const wallet = new MockAgentWalletAdapter(db.prisma, cfg, { sleep });
  const bus = new EventBus();
  const pushed: DirectorKeyStatusPayload[] = [];
  bus.on('director.status', (event) => pushed.push(event.payload), { module: 'test' });
  const keys = new DirectorKeyService(new FlagsService({ TA_WAVES: waves } as never), wallet, new DirectorKeyRepository(db.prisma), bus);
  return { wallet, pushed, controller: new DirectorKeyController(keys) };
}

async function seatColony(id: string, playerId: string): Promise<void> {
  await db.prisma.colony.create({ data: { id, playerId, planetId: 'pl_w15_18', colonyIndex: seat, name: id } });
  seat += 1;
}

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

describe('W15-18 director key on Postgres', () => {
  it('POST writes one row from the limits, and a second POST does not add another key', async () => {
    const { controller, pushed } = open();
    const colonyId = 'co_post';
    await seatColony(colonyId, owner.id);
    const created = await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit(600) } });
    expect(created.state).toBe('active');
    expect(created.tokens).toEqual([expect.objectContaining({ token: 'metals.t1', allowance: '600', spent: '0', available: '600' })]);
    expect(created.gasAllowance).toBe('0');
    expect(pushed.at(-1)?.state).toBe('active');
    const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    expect(row.allowance.toFixed(0)).toBe('600');
    expect(row.spent.toFixed(0)).toBe('0');
    expect(row.revokedAt).toBeNull();
    expect(await db.prisma.directorKey.count({ where: { colonyId } })).toBe(1);
    expect(await db.prisma.mockChainAgentKey.count({ where: { accountId: row.accountId } })).toBe(1);

    const again = await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit(1) } });
    expect(again.tokens[0]?.allowance).toBe('600');
    const after = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    expect(after.publicKey).toBe(row.publicKey);
    expect(after.allowance.toFixed(0)).toBe('600');
    expect(after.createdAt.getTime()).toBe(row.createdAt.getTime());
    expect(await db.prisma.mockChainAgentKey.count({ where: { accountId: row.accountId } })).toBe(1);
  });
});

describe('W15-18 director key revoke and refusal', () => {
  it('DELETE sets revoked_at, the push is revoked, reserve fails, and a new adapter still shows revoked', async () => {
    const { controller, wallet, pushed } = open();
    const colonyId = 'co_revoke';
    await seatColony(colonyId, owner.id);
    await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit(600) } });
    const before = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    const revoked = await controller.remove(asBearer('dev:owner'), { colonyId });
    expect(revoked.state).toBe('revoked');
    expect(pushed.at(-1)?.state).toBe('revoked');
    const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    expect(row.revokedAt).not.toBeNull();
    expect(await db.prisma.directorKey.count({ where: { colonyId } })).toBe(1);

    await expect(wallet.reserveAllowance({
      opId: `${colonyId}:reserve`, accountId: row.accountId, publicKey: row.publicKey, token: 'metals.t1', amount: '1',
    })).rejects.toMatchObject({ errorCode: 'NEAR_KEY_REVOKED' });

    const again = new MockAgentWalletAdapter(db.prisma, cfg, { sleep });
    const status = await again.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(status.revoked).toBe(true);
    expect(status.tokens[0]?.allowance).toBe('600');

    const repeat = await controller.remove(asBearer('dev:owner'), { colonyId });
    expect(repeat.state).toBe('revoked');
    const kept = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    expect(kept.revokedAt?.getTime()).toBe(row.revokedAt?.getTime());
    expect(before.publicKey).toBe(row.publicKey);
  });

  it('a stranger, a missing colony, empty limits, and W15 off write nothing', async () => {
    const { controller } = open();
    const colonyId = 'co_denied';
    await seatColony(colonyId, owner.id);
    await expect(controller.add(asBearer('dev:other'), { colonyId, limits: { 'metals.t1': limit(600) } })).rejects.toMatchObject({
      status: 403, errorCode: 'NEAR_NOT_OWNER',
    });
    await expect(controller.add(asBearer('dev:owner'), { colonyId: 'co_missing', limits: { 'metals.t1': limit(600) } })).rejects.toMatchObject({
      status: 404, errorCode: 'NOT_FOUND',
    });
    await expect(controller.add(asBearer('dev:owner'), { colonyId, limits: {} })).rejects.toMatchObject({ status: 400, errorCode: 'INVALID_REQUEST' });
    await expect(controller.remove(asBearer('dev:owner'), { colonyId: 'co_none' })).rejects.toMatchObject({ status: 404 });
    const none = 'co_nokey';
    await seatColony(none, owner.id);
    await expect(controller.remove(asBearer('dev:owner'), { colonyId: none })).rejects.toMatchObject({ status: 404, errorCode: 'director_key_missing' });
    expect(await db.prisma.directorKey.findUnique({ where: { colonyId } })).toBeNull();
    expect(stranger.id).not.toBe(owner.id);

    const offId = 'co_wave_off';
    await seatColony(offId, owner.id);
    const off = open('..14');
    await expect(off.controller.add(asBearer('dev:owner'), { colonyId: offId, limits: { 'metals.t1': limit(600) } })).rejects.toMatchObject({
      status: 403, errorCode: 'wave_disabled',
    });
    await expect(off.controller.remove(asBearer('dev:owner'), { colonyId: offId })).rejects.toMatchObject({ status: 403, errorCode: 'wave_disabled' });
    expect(await db.prisma.directorKey.findUnique({ where: { colonyId: offId } })).toBeNull();
    expect(await db.prisma.mockChainAgentKey.count({ where: { accountId: 'co_wave_off.dir.terraagent.mock' } })).toBe(0);
  });

  it('maxPerSession 0 creates allowance 0 and the next reserve throws NEAR_ALLOWANCE_EXHAUSTED', async () => {
    const { controller, wallet } = open();
    const colonyId = 'co_zero';
    await seatColony(colonyId, owner.id);
    const created = await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit(0) } });
    expect(created.tokens[0]).toMatchObject({ token: 'metals.t1', allowance: '0', available: '0' });
    const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    expect(row.allowance.toFixed(0)).toBe('0');
    const pool = await db.prisma.mockChainAgentAllowance.findUniqueOrThrow({
      where: { accountId_publicKey_token: { accountId: row.accountId, publicKey: row.publicKey, token: 'metals.t1' } },
    });
    expect(pool.allowance.toFixed(0)).toBe('0');
    await expect(wallet.reserveAllowance({
      opId: `${colonyId}:reserve`, accountId: row.accountId, publicKey: row.publicKey, token: 'metals.t1', amount: '1',
    })).rejects.toMatchObject({ errorCode: 'NEAR_ALLOWANCE_EXHAUSTED' });
  });
});

type MetalPool = { allowance: string; reserved: string; spent: string; available: string };

function withinCap(row: MetalPool): void {
  const allowance = BigInt(row.allowance);
  expect(BigInt(row.reserved) + BigInt(row.spent) + BigInt(row.available)).toBe(allowance);
  expect(BigInt(row.reserved) + BigInt(row.spent) <= allowance).toBe(true);
}

async function posted(colonyId: string, maxPerSession = 600) {
  const index = seat;
  const opened = open();
  await seatColony(colonyId, owner.id);
  await opened.controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit(maxPerSession) } });
  const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
  return { ...opened, row, index };
}

function refOf(row: { accountId: string; publicKey: string }) {
  return { accountId: row.accountId, publicKey: row.publicKey, token: 'metals.t1' };
}

async function metal(accountId: string, publicKey: string, reader?: MockAgentWalletAdapter): Promise<MetalPool> {
  const status = await (reader ?? new MockAgentWalletAdapter(db.prisma, cfg, { sleep })).keyStatus({ accountId, publicKey });
  const row = status.tokens.find((token) => token.token === 'metals.t1');
  if (!row) throw new Error('missing metals.t1');
  return row;
}

function tradeView(colonyId: string, colonyIndex: number): DirectorColonyView {
  return {
    colonyId,
    colonyIndex,
    planetId: 'pl_w15_18',
    playerId: owner.id,
    away: true,
    tick: 30,
    rows: [{
      forecast: {
        resource: 'metals.t1', stock: 1400, storageCap: 1500, queued: 0, reserved: 0, serviceWindow: 0,
        reserveFloor: 200, reserveHorizon: 0, sessionSpent: 0, partner: 'guild', limit: limit(600),
      },
      reference: { num: 1_000_000n, den: 1n },
      ownUnitCost: { num: 800_000n, den: 1n },
      target: 750,
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
  constructor(private readonly onPlace: (order: DirectorPlace) => Promise<DirectorFill> | DirectorFill) { super(); }
  place(order: DirectorPlace): Promise<DirectorFill> {
    this.placed.push(order);
    return Promise.resolve(this.onPlace(order));
  }
}

function startLoop(colonyId: string, index: number, wallet: MockAgentWalletAdapter, market: DirectorMarketPort) {
  const flags = new FlagsService({ TA_WAVES: 'all' } as never);
  return new DirectorLoopService(
    flags, wallet, new DirectorKeyRepository(db.prisma), new EventBus(), new FixedSource(tradeView(colonyId, index)), market,
  );
}

describe('W15-30 director key allowance races', () => {
  it('one of two concurrent reserves holds and the other exhausts without passing the allowance', async () => {
    const { wallet, row } = await posted('co_race30');
    const other = new MockAgentWalletAdapter(db.prisma, cfg, { sleep });
    const raced = await Promise.allSettled([
      wallet.reserveAllowance({ opId: 'co_race30:a', ...refOf(row), amount: '400' }),
      other.reserveAllowance({ opId: 'co_race30:b', ...refOf(row), amount: '400' }),
    ]);
    expect(raced.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = raced.find((item) => item.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' && (rejected.reason as { errorCode?: string }).errorCode).toBe(
      'NEAR_ALLOWANCE_EXHAUSTED',
    );
    const held = await metal(row.accountId, row.publicKey);
    expect(held).toMatchObject({ allowance: '600', reserved: '400', spent: '0', available: '200' });
    withinCap(held);
    expect((await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId: 'co_race30' } })).spent.toFixed(0)).toBe('0');
  });

  it('a partial fill then cancel releases the unused hold, and a new adapter keeps spent', async () => {
    const { wallet, row } = await posted('co_part30');
    const ref = refOf(row);
    await wallet.reserveAllowance({ opId: 'co_part30:rsv', ...ref, amount: '300' });
    await wallet.consumeAllowance({ opId: 'co_part30:use', ...ref, amount: '200' });
    expect(await metal(row.accountId, row.publicKey)).toMatchObject({ reserved: '100', spent: '200', available: '300' });
    await wallet.releaseAllowance({ opId: 'co_part30:rel', ...ref, amount: '100' });
    const closed = await metal(row.accountId, row.publicKey);
    expect(closed).toMatchObject({ allowance: '600', reserved: '0', spent: '200', available: '400' });
    withinCap(closed);
    const restarted = await metal(row.accountId, row.publicKey, new MockAgentWalletAdapter(db.prisma, cfg, { sleep }));
    expect(restarted).toEqual(closed);
    await expect(wallet.releaseAllowance({ opId: 'co_part30:over', ...ref, amount: '1' })).rejects.toMatchObject({
      errorCode: 'NEAR_ALLOWANCE_EXHAUSTED',
    });
    expect((await metal(row.accountId, row.publicKey)).spent).toBe('200');
  });

  it('reserves the exact remainder and refuses one more unit', async () => {
    const { wallet, row } = await posted('co_exact30');
    const ref = refOf(row);
    await wallet.reserveAllowance({ opId: 'co_exact30:all', ...ref, amount: '600' });
    const held = await metal(row.accountId, row.publicKey);
    expect(held).toMatchObject({ reserved: '600', spent: '0', available: '0' });
    withinCap(held);
    await expect(wallet.reserveAllowance({ opId: 'co_exact30:more', ...ref, amount: '1' })).rejects.toMatchObject({
      errorCode: 'NEAR_ALLOWANCE_EXHAUSTED',
    });
    await wallet.consumeAllowance({ opId: 'co_exact30:use', ...ref, amount: '600' });
    const drained = await metal(row.accountId, row.publicKey, new MockAgentWalletAdapter(db.prisma, cfg, { sleep }));
    expect(drained).toMatchObject({ reserved: '0', spent: '600', available: '0' });
    withinCap(drained);
    expect((await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey })).gasSpent).toBe('0');
  });
});

describe('W15-30 director key revoke and fee hold', () => {
  it('revoke before submit places no order and leaves the key revoked', async () => {
    const { controller, wallet, row, index } = await posted('co_pre30');
    await controller.remove(asBearer('dev:owner'), { colonyId: 'co_pre30' });
    const market = new ScriptedMarket(() => ({ status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' }));
    const ran = await startLoop('co_pre30', index, wallet, market).runDirectorOnce('co_pre30');
    expect(ran).toEqual({ ok: false, skip: 'director_key_revoked' });
    expect(market.placed).toHaveLength(0);
    const status: KeyStatus = await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(status.revoked).toBe(true);
    expect(await metal(row.accountId, row.publicKey)).toMatchObject({ reserved: '0', spent: '0', available: '600' });
  });

  it('revoke after a reserve rejects the rest of the hold and does not raise spent', async () => {
    const { controller, wallet, row } = await posted('co_mid30');
    const ref = refOf(row);
    await wallet.reserveAllowance({ opId: 'co_mid30:rsv', ...ref, amount: '300' });
    await wallet.consumeAllowance({ opId: 'co_mid30:part', ...ref, amount: '100' });
    await controller.remove(asBearer('dev:owner'), { colonyId: 'co_mid30' });
    await expect(wallet.consumeAllowance({ opId: 'co_mid30:rest', ...ref, amount: '200' })).rejects.toMatchObject({
      errorCode: 'NEAR_KEY_REVOKED',
    });
    await expect(wallet.releaseAllowance({ opId: 'co_mid30:rel', ...ref, amount: '200' })).rejects.toMatchObject({
      errorCode: 'NEAR_KEY_REVOKED',
    });
    const held = await metal(row.accountId, row.publicKey, new MockAgentWalletAdapter(db.prisma, cfg, { sleep }));
    expect(held).toMatchObject({ reserved: '200', spent: '100', available: '300' });
    withinCap(held);
    const stored = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId: 'co_mid30' } });
    expect(stored.revokedAt).not.toBeNull();
    expect(stored.spent.toFixed(0)).toBe('100');
  });

  it('a 300 metal sell reserves 300 metal, not the quote, and a new adapter keeps that spent', async () => {
    const { wallet, row, index } = await posted('co_fee30');
    let quote = 0n;
    const market = new ScriptedMarket(async (order) => {
      const held = await metal(row.accountId, row.publicKey);
      expect(held).toMatchObject({ reserved: '300', spent: '0', available: '300' });
      withinCap(held);
      const args = order.command.args as { amount?: number; price?: { token?: string; amount?: string } };
      expect(args.amount).toBe(300);
      expect(args.price?.token).toBe('USDC');
      quote = BigInt(args.price?.amount ?? '0');
      expect(quote).toBeGreaterThan(300n);
      return { status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' };
    });
    const sold = await startLoop('co_fee30', index, wallet, market).runDirectorOnce('co_fee30');
    expect(sold).toMatchObject({ ok: true, amount: 300, spent: 300, allowance: 600 });
    expect(market.placed).toHaveLength(1);
    const spent = await metal(row.accountId, row.publicKey, new MockAgentWalletAdapter(db.prisma, cfg, { sleep }));
    expect(spent).toMatchObject({ reserved: '0', spent: '300', available: '300', allowance: '600' });
    expect(spent.spent).toBe('300');
    expect(BigInt(spent.spent)).toBeLessThan(quote);
    const status = await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(status.tokens.map((token) => token.token)).toEqual(['metals.t1']);
    expect(status.gasSpent).toBe('0');
    expect((await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId: 'co_fee30' } })).spent.toFixed(0)).toBe('300');
  });
});
