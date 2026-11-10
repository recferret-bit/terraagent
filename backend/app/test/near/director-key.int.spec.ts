import 'reflect-metadata';
import type { DirectorKeyStatusPayload } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
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
