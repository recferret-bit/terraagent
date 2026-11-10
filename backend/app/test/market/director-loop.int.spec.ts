import 'reflect-metadata';
import type { AutoTradeLimit } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DirectorLoopService } from '../../src/market/director/director-loop.service.js';
import {
  DirectorMarketPort,
  type DirectorFill,
  type DirectorPlace,
} from '../../src/market/director/director-market.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';
import { DirectorKeyController } from '../../src/near/director-key/director-key.controller.js';
import { DirectorKeyRepository } from '../../src/near/director-key/director-key.repository.js';
import { DirectorKeyService } from '../../src/near/director-key/director-key.service.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';
import { devBearerPlayer } from '../../src/ws/session-verifier.js';

const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};
const owner = devBearerPlayer('dev:owner')!;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 21 };

let db: TestDatabase;
let seat = 0;

function asBearer(token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
}

function demoView(colonyId: string, colonyIndex: number, rowLimit: AutoTradeLimit = limit): DirectorColonyView {
  return {
    colonyId,
    colonyIndex,
    planetId: 'pl_w15_21',
    playerId: owner.id,
    away: true,
    tick: 6,
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
          limit: rowLimit,
        },
        reference: { num: 1_000_000n, den: 1n },
        ownUnitCost: { num: 800_000n, den: 1n },
        target: 750,
      },
    ],
  };
}

class MemSource extends DirectorColonySource {
  loads = 0;
  constructor(private row: DirectorColonyView | null) {
    super();
  }
  async load(): Promise<DirectorColonyView | null> {
    this.loads += 1;
    return this.row;
  }
  async listAway(): Promise<readonly string[]> {
    return [];
  }
}

class MemMarket extends DirectorMarketPort {
  readonly placed: DirectorPlace[] = [];
  async place(order: DirectorPlace): Promise<DirectorFill> {
    this.placed.push(order);
    return { status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' };
  }
}

async function seatColony(id: string): Promise<void> {
  await db.prisma.colony.create({
    data: { id, playerId: owner.id, planetId: 'pl_w15_21', colonyIndex: seat, name: id },
  });
  seat += 1;
}

function harness(waves = 'all') {
  const wallet = new MockAgentWalletAdapter(db.prisma, cfg, { sleep: async () => undefined });
  const bus = new EventBus();
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const repo = new DirectorKeyRepository(db.prisma);
  const keys = new DirectorKeyService(flags, wallet, repo, bus);
  return { wallet, bus, flags, repo, controller: new DirectorKeyController(keys) };
}

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W15-21 director sell on Postgres', () => {
  it('one tick sells 300 metals and the next tick does not sell again', async () => {
    const { wallet, bus, flags, repo, controller } = harness();
    const colonyId = 'co_sell21';
    const index = seat;
    await seatColony(colonyId);
    const created = await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit } });
    expect(created.tokens[0]).toMatchObject({ token: 'metals.t1', allowance: '600', spent: '0', available: '600' });
    const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    const market = new MemMarket();
    const events: string[] = [];
    bus.on('planet.event', (event) => events.push(event.kind), { module: 'test' });
    const loop = new DirectorLoopService(flags, wallet, repo, bus, new MemSource(demoView(colonyId, index)), market);
    const sold = await loop.runDirectorOnce(colonyId);
    expect(sold).toMatchObject({
      ok: true,
      side: 'sell',
      resource: 'metals.t1',
      amount: 300,
      spent: 300,
      allowance: 600,
    });
    expect(market.placed).toHaveLength(1);
    expect(market.placed[0]?.command).toMatchObject({
      source: 'player',
      colonyIndex: index,
      kind: 'market.placeOrder',
    });
    expect(market.placed[0]?.command.args).toMatchObject({ side: 'sell', resource: 'metals.t1', amount: 300 });
    expect(events).toEqual(['directorOrderRequested', 'directorTrade']);
    const status = await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(status.tokens.find((token) => token.token === 'metals.t1')).toMatchObject({
      spent: '300',
      available: '300',
      allowance: '600',
    });
    const stored = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    expect(stored.spent.toFixed(0)).toBe('300');

    const again = await loop.runDirectorOnce(colonyId);
    expect(again).toEqual({ ok: false, skip: 'session_cap' });
    expect(market.placed).toHaveLength(1);
    const after = await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(after.tokens.find((token) => token.token === 'metals.t1')).toMatchObject({ spent: '300', available: '300' });
  });

  it('a missing key and W15 off leave spent at 0', async () => {
    const { wallet, bus, flags, repo, controller } = harness();
    const colonyId = 'co_miss21';
    const index = seat;
    await seatColony(colonyId);
    await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': limit } });
    const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    await db.prisma.directorKey.delete({ where: { colonyId } });
    const market = new MemMarket();
    const loop = new DirectorLoopService(flags, wallet, repo, bus, new MemSource(demoView(colonyId, index)), market);
    expect(await loop.runDirectorOnce(colonyId)).toEqual({ ok: false, skip: 'director_key_missing' });
    expect(market.placed).toHaveLength(0);
    const untouched = await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(untouched.tokens[0]).toMatchObject({ spent: '0', available: '600' });

    const offId = 'co_off21';
    const offIndex = seat;
    await seatColony(offId);
    await controller.add(asBearer('dev:owner'), { colonyId: offId, limits: { 'metals.t1': limit } });
    const offRow = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId: offId } });
    const offFlags = new FlagsService({ TA_WAVES: '..14' } as never);
    const offSource = new MemSource(demoView(offId, offIndex));
    const offMarket = new MemMarket();
    const off = new DirectorLoopService(offFlags, wallet, repo, bus, offSource, offMarket);
    expect(await off.runDirectorOnce(offId)).toEqual({ ok: false, skip: 'wave_disabled' });
    expect(offSource.loads).toBe(0);
    expect(offMarket.placed).toHaveLength(0);
    const still = await wallet.keyStatus({ accountId: offRow.accountId, publicKey: offRow.publicKey });
    expect(still.tokens[0]).toMatchObject({ spent: '0', available: '600' });
  });
});

const tight: AutoTradeLimit = { ...limit, maxPerSession: 300 };

async function spendMetal(
  wallet: MockAgentWalletAdapter,
  accountId: string,
  publicKey: string,
  amount: string,
): Promise<void> {
  await wallet.reserveAllowance({ opId: `pre-r:${publicKey}`, accountId, publicKey, token: 'metals.t1', amount });
  await wallet.consumeAllowance({ opId: `pre-c:${publicKey}`, accountId, publicKey, token: 'metals.t1', amount });
}

describe('W15-22 allowance exhaustion on Postgres', () => {
  it('one 300 sell emits directorAllowanceExhausted once and the next tick places nothing', async () => {
    const { wallet, bus, flags, repo, controller } = harness();
    const colonyId = 'co_cap22';
    const index = seat;
    await seatColony(colonyId);
    await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': tight } });
    const market = new MemMarket();
    const seen: { kind: string; data: unknown }[] = [];
    bus.on('planet.event', (event) => seen.push({ kind: event.kind, data: event.data }), { module: 'test' });
    const loop = new DirectorLoopService(flags, wallet, repo, bus, new MemSource(demoView(colonyId, index, tight)), market);

    const sold = await loop.runDirectorOnce(colonyId);
    expect(sold).toMatchObject({ ok: true, side: 'sell', resource: 'metals.t1', amount: 300, spent: 300, allowance: 300 });
    expect(market.placed).toHaveLength(1);
    expect(seen.map((event) => event.kind)).toEqual([
      'directorOrderRequested',
      'directorTrade',
      'directorAllowanceExhausted',
    ]);
    expect(seen[2]?.data).toEqual({
      colonyId,
      colonyIndex: index,
      resource: 'metals.t1',
      spent: 300,
      allowance: 300,
      reason: 'allowance_exhausted',
    });

    expect(await loop.runDirectorOnce(colonyId)).toEqual({ ok: false, skip: 'allowance_exhausted' });
    expect(market.placed).toHaveLength(1);
    expect(seen.filter((event) => event.kind === 'directorAllowanceExhausted')).toHaveLength(1);
  });

  it('available 0 before the tick emits once and places nothing', async () => {
    const { wallet, bus, flags, repo, controller } = harness();
    const colonyId = 'co_zero22';
    const index = seat;
    await seatColony(colonyId);
    await controller.add(asBearer('dev:owner'), { colonyId, limits: { 'metals.t1': tight } });
    const row = await db.prisma.directorKey.findUniqueOrThrow({ where: { colonyId } });
    await spendMetal(wallet, row.accountId, row.publicKey, '300');
    const before = await wallet.keyStatus({ accountId: row.accountId, publicKey: row.publicKey });
    expect(before.tokens.find((token) => token.token === 'metals.t1')).toMatchObject({
      spent: '300',
      available: '0',
      allowance: '300',
    });
    const market = new MemMarket();
    const seen: { kind: string; data: unknown }[] = [];
    bus.on('planet.event', (event) => seen.push({ kind: event.kind, data: event.data }), { module: 'test' });
    const loop = new DirectorLoopService(flags, wallet, repo, bus, new MemSource(demoView(colonyId, index, tight)), market);

    expect(await loop.runDirectorOnce(colonyId)).toEqual({ ok: false, skip: 'allowance_exhausted' });
    expect(market.placed).toHaveLength(0);
    expect(seen.map((event) => event.kind)).toEqual(['directorAllowanceExhausted']);
    expect(seen[0]?.data).toMatchObject({
      colonyId,
      resource: 'metals.t1',
      spent: 300,
      allowance: 300,
      reason: 'allowance_exhausted',
    });
    expect(await loop.runDirectorOnce(colonyId)).toEqual({ ok: false, skip: 'allowance_exhausted' });
    expect(market.placed).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });
});
