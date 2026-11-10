import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { AgentWalletPort } from '../../src/near/application/ports/agent-wallet.port';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter';
import type { KeyStatus } from '../../src/near/application/ports/agent-wallet.port';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 15 };
const wallet = () => new MockAgentWalletAdapter(db.prisma, cfg, { sleep });

const GAS = '1000000000000000000000000';
const TOKEN = 'metals.t1';

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function op(accountId: string, publicKey: string, token = TOKEN) {
  return { accountId, publicKey, token };
}

async function openKey(
  id: string,
  tokens: { token: string; allowance: string }[] = [{ token: TOKEN, allowance: '600' }],
): Promise<MockAgentWalletAdapter> {
  const w = wallet();
  const accountId = `${id}.npc.terraagent.mock`;
  await w.createSubAccount({ opId: `${id}:acct`, parent: 'npc.terraagent.mock', name: id });
  await w.addLimitedKey({
    opId: `${id}:key`,
    accountId,
    publicKey: `ed25519:${id}`,
    allowance: GAS,
    receiverId: 'intents.near',
    methodNames: ['execute_intents'],
    tokens,
  });
  return w;
}

function tokenOf(status: KeyStatus, token = TOKEN) {
  const row = status.tokens.find((item) => item.token === token);
  if (!row) throw new Error(`missing ${token}`);
  return row;
}

describe('MockAgentWalletAdapter acceptance (W15-03)', () => {
  it('reserve 300, settle 200, cancel 100 leaves spent 200 and available 400 after a new instance', async () => {
    const id = 'accept';
    const accountId = `${id}.npc.terraagent.mock`;
    const publicKey = `ed25519:${id}`;
    const first = await openKey(id);
    const held = await first.reserveAllowance({ opId: `${id}:reserve`, ...op(accountId, publicKey), amount: '300' });
    expect(tokenOf(held.status)).toMatchObject({ allowance: '600', reserved: '300', spent: '0', available: '300' });
    expect(held.status.gasAllowance).toBe(GAS);
    expect(held.status.gasSpent).toBe('0');

    const settled = await first.consumeAllowance({ opId: `${id}:settle`, ...op(accountId, publicKey), amount: '200' });
    expect(tokenOf(settled.status)).toMatchObject({ reserved: '100', spent: '200', available: '300' });

    const closed = await first.releaseAllowance({ opId: `${id}:cancel`, ...op(accountId, publicKey), amount: '100' });
    expect(tokenOf(closed.status)).toMatchObject({ allowance: '600', reserved: '0', spent: '200', available: '400' });
    expect(closed.status.gasSpent).toBe('0');

    const again = wallet();
    const status = await again.keyStatus({ accountId, publicKey });
    expect(tokenOf(status)).toEqual(tokenOf(closed.status));
    expect(status.gasAllowance).toBe(GAS);
    expect(status.gasSpent).toBe('0');
    const row = await db.prisma.mockChainAgentAllowance.findUniqueOrThrow({
      where: { accountId_publicKey_token: { accountId, publicKey, token: TOKEN } },
    });
    expect(row.spent.toFixed(0)).toBe('200');
    expect(row.reserved.toFixed(0)).toBe('0');
    expect(row.allowance.toFixed(0)).toBe('600');
  });

  it('replays the same opId without reserving, spending, or creating twice', async () => {
    const id = 'replay';
    const accountId = `${id}.npc.terraagent.mock`;
    const publicKey = `ed25519:${id}`;
    const w = await openKey(id);
    const sub = await w.createSubAccount({ opId: `${id}:acct`, parent: 'npc.terraagent.mock', name: id });
    expect(sub.accountId).toBe(accountId);
    const key = await w.addLimitedKey({
      opId: `${id}:key`,
      accountId,
      publicKey,
      allowance: GAS,
      receiverId: 'intents.near',
      methodNames: ['execute_intents'],
      tokens: [{ token: TOKEN, allowance: '600' }],
    });
    expect(key.txHash).toBe(
      (
        await w.addLimitedKey({
          opId: `${id}:key`,
          accountId,
          publicKey,
          allowance: '1',
          receiverId: 'res.terraagent.mock',
          methodNames: [],
          tokens: [{ token: TOKEN, allowance: '1' }],
        })
      ).txHash,
    );

    const reserve = await w.reserveAllowance({ opId: `${id}:reserve`, ...op(accountId, publicKey), amount: '300' });
    const replay = await w.reserveAllowance({ opId: `${id}:reserve`, ...op(accountId, publicKey), amount: '300' });
    expect(replay.receipt.txHash).toBe(reserve.receipt.txHash);
    expect(tokenOf(replay.status)).toMatchObject({ reserved: '300', spent: '0', available: '300' });
    expect(tokenOf(await w.keyStatus({ accountId, publicKey })).reserved).toBe('300');

    await w.consumeAllowance({ opId: `${id}:settle`, ...op(accountId, publicKey), amount: '200' });
    const consumeReplay = await w.consumeAllowance({
      opId: `${id}:settle`,
      ...op(accountId, publicKey),
      amount: '200',
    });
    expect(tokenOf(consumeReplay.status)).toMatchObject({ reserved: '100', spent: '200' });
    await w.releaseAllowance({ opId: `${id}:cancel`, ...op(accountId, publicKey), amount: '100' });
    const releaseReplay = await w.releaseAllowance({
      opId: `${id}:cancel`,
      ...op(accountId, publicKey),
      amount: '100',
    });
    expect(tokenOf(releaseReplay.status)).toMatchObject({ reserved: '0', spent: '200', available: '400' });
    expect(await db.prisma.mockChainAccount.count({ where: { accountId } })).toBe(1);
  });
});

describe('MockAgentWalletAdapter revoke, races, and rejections (W15-03)', () => {
  it('revoke keeps the pool and later moves fail', async () => {
    const id = 'revoke';
    const accountId = `${id}.npc.terraagent.mock`;
    const publicKey = `ed25519:${id}`;
    const w = await openKey(id);
    await w.reserveAllowance({ opId: `${id}:reserve`, ...op(accountId, publicKey), amount: '300' });
    await w.consumeAllowance({ opId: `${id}:settle`, ...op(accountId, publicKey), amount: '200' });
    await w.releaseAllowance({ opId: `${id}:cancel`, ...op(accountId, publicKey), amount: '100' });
    const receipt = await w.revokeKey({ opId: `${id}:revoke`, accountId, publicKey });
    expect((await w.revokeKey({ opId: `${id}:revoke`, accountId, publicKey })).txHash).toBe(receipt.txHash);
    await w.revokeKey({ opId: `${id}:revoke-2`, accountId, publicKey });
    const status = await w.keyStatus({ accountId, publicKey });
    expect(status.revoked).toBe(true);
    expect(tokenOf(status)).toMatchObject({ reserved: '0', spent: '200', available: '400' });
    expect(status.gasSpent).toBe('0');
    await expect(
      w.reserveAllowance({ opId: `${id}:again`, ...op(accountId, publicKey), amount: '1' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_KEY_REVOKED' });
    await expect(
      w.consumeAllowance({ opId: `${id}:spend`, ...op(accountId, publicKey), amount: '1' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_KEY_REVOKED' });
    await expect(
      w.releaseAllowance({ opId: `${id}:free`, ...op(accountId, publicKey), amount: '1' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_KEY_REVOKED' });
    expect(tokenOf(await w.keyStatus({ accountId, publicKey })).spent).toBe('200');
  });
});

describe('MockAgentWalletAdapter races (W15-03)', () => {
  it('one of two reserves that together exceed available throws, and a revoke race keeps the sum', async () => {
    const id = 'race';
    const accountId = `${id}.npc.terraagent.mock`;
    const publicKey = `ed25519:${id}`;
    await openKey(id);
    const a = wallet();
    const b = wallet();
    const raced = await Promise.allSettled([
      a.reserveAllowance({ opId: `${id}:a`, ...op(accountId, publicKey), amount: '400' }),
      b.reserveAllowance({ opId: `${id}:b`, ...op(accountId, publicKey), amount: '400' }),
    ]);
    expect(raced.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = raced.find((item) => item.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' && (rejected.reason as { errorCode?: string }).errorCode).toBe(
      'NEAR_ALLOWANCE_EXHAUSTED',
    );
    const after = tokenOf(await wallet().keyStatus({ accountId, publicKey }));
    expect(after).toMatchObject({ allowance: '600', reserved: '400', spent: '0', available: '200' });

    const rid = 'racer';
    const raceAccount = `${rid}.npc.terraagent.mock`;
    const raceKey = `ed25519:${rid}`;
    await openKey(rid);
    const c = wallet();
    const d = wallet();
    await Promise.allSettled([
      c.reserveAllowance({ opId: `${rid}:hold`, ...op(raceAccount, raceKey), amount: '300' }),
      d.revokeKey({ opId: `${rid}:revoke`, accountId: raceAccount, publicKey: raceKey }),
    ]);
    const status = await wallet().keyStatus({ accountId: raceAccount, publicKey: raceKey });
    expect(status.revoked).toBe(true);
    expect(status.gasSpent).toBe('0');
    const row = tokenOf(status);
    expect(row.spent).toBe('0');
    expect(row.allowance).toBe('600');
    expect(BigInt(row.reserved) + BigInt(row.spent) + BigInt(row.available)).toBe(600n);
    expect(['0', '300']).toContain(row.reserved);
  });
});

describe('MockAgentWalletAdapter rejections (W15-03)', () => {
  it('rejects exhaustion, over-consume, a bad receiver, and a duplicate key without writing the attempt', async () => {
    const id = 'neg';
    const accountId = `${id}.npc.terraagent.mock`;
    const publicKey = `ed25519:${id}`;
    const w = await openKey(id);
    await expect(
      w.reserveAllowance({ opId: `${id}:over`, ...op(accountId, publicKey), amount: '601' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ALLOWANCE_EXHAUSTED' });
    await w.reserveAllowance({ opId: `${id}:hold`, ...op(accountId, publicKey), amount: '200' });
    await expect(
      w.consumeAllowance({ opId: `${id}:too`, ...op(accountId, publicKey), amount: '201' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ALLOWANCE_EXHAUSTED' });
    await expect(
      w.releaseAllowance({ opId: `${id}:too-rel`, ...op(accountId, publicKey), amount: '201' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ALLOWANCE_EXHAUSTED' });
    expect(tokenOf(await w.keyStatus({ accountId, publicKey }))).toMatchObject({
      reserved: '200',
      spent: '0',
      available: '400',
    });
    expect(
      await db.prisma.mockChainReceipt.count({ where: { opId: { in: [`${id}:over`, `${id}:too`, `${id}:too-rel`] } } }),
    ).toBe(0);

    await expect(
      w.addLimitedKey({
        opId: `${id}:bad-recv`,
        accountId,
        publicKey: 'ed25519:other',
        allowance: GAS,
        receiverId: 'guild.near',
        methodNames: [],
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_RELAY_RECEIVER_NOT_ALLOWED' });
    await expect(w.keyStatus({ accountId, publicKey: 'ed25519:missing' })).rejects.toMatchObject({
      errorCode: 'NEAR_ACCOUNT_NOT_FOUND',
    });
    await expect(
      w.addLimitedKey({
        opId: `${id}:dup`,
        accountId,
        publicKey,
        allowance: GAS,
        receiverId: 'intents.near',
        methodNames: [],
        tokens: [{ token: TOKEN, allowance: '1' }],
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ACCOUNT_EXISTS' });
    await expect(
      w.createSubAccount({ opId: `${id}:dup-acct`, parent: 'npc.terraagent.mock', name: id }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ACCOUNT_EXISTS' });
    await expect(
      w.reserveAllowance({ opId: `${id}:bad-amt`, ...op(accountId, publicKey), amount: '01' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_INVALID_INPUT' });
    expect(await db.prisma.mockChainAgentKey.count({ where: { publicKey: 'ed25519:other' } })).toBe(0);
    expect(tokenOf(await w.keyStatus({ accountId, publicKey })).allowance).toBe('600');
  });
});

describe('MockAgentWalletAdapter boundaries and wiring (W15-03)', () => {
  it('hits exact zero, accepts a zero release, and does not move a second token or gas', async () => {
    const id = 'edge';
    const accountId = `${id}.npc.terraagent.mock`;
    const publicKey = `ed25519:${id}`;
    const w = await openKey(id, [
      { token: TOKEN, allowance: '600' },
      { token: 'minerals.t1', allowance: '50' },
    ]);
    const full = await w.reserveAllowance({ opId: `${id}:all`, ...op(accountId, publicKey), amount: '600' });
    expect(tokenOf(full.status).available).toBe('0');
    await expect(
      w.reserveAllowance({ opId: `${id}:more`, ...op(accountId, publicKey), amount: '1' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ALLOWANCE_EXHAUSTED' });
    const zero = await w.releaseAllowance({ opId: `${id}:zero`, ...op(accountId, publicKey), amount: '0' });
    expect(tokenOf(zero.status)).toMatchObject({ reserved: '600', spent: '0', available: '0' });
    await w.consumeAllowance({ opId: `${id}:all-spent`, ...op(accountId, publicKey), amount: '0' });
    const drained = await w.consumeAllowance({ opId: `${id}:drain`, ...op(accountId, publicKey), amount: '600' });
    expect(tokenOf(drained.status)).toMatchObject({ reserved: '0', spent: '600', available: '0' });
    expect(tokenOf(drained.status, 'minerals.t1')).toMatchObject({
      allowance: '50',
      reserved: '0',
      spent: '0',
      available: '50',
    });
    expect(drained.status.gasAllowance).toBe(GAS);
    expect(drained.status.gasSpent).toBe('0');
    const released = await w.releaseAllowance({ opId: `${id}:none`, ...op(accountId, publicKey), amount: '0' });
    expect(tokenOf(released.status).spent).toBe('600');

    const wide = 'a'.repeat(59);
    const created = await w.createSubAccount({ opId: `${id}:wide`, parent: 'near', name: wide });
    expect(created.accountId).toHaveLength(64);
    await expect(w.createSubAccount({ opId: `${id}:bad-name`, parent: 'near', name: 'No' })).rejects.toMatchObject({
      errorCode: 'NEAR_INVALID_INPUT',
    });
    expect(await db.prisma.mockChainAccount.count({ where: { accountId: 'No.near' } })).toBe(0);
  });

  it('resolves AgentWalletPort to the mock adapter from the booted app', async () => {
    const { app } = await createApp({
      source: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: db.url,
        SIM_THREADS: '1',
        MOCK_LATENCY_MIN_MS: '0',
        MOCK_LATENCY_MAX_MS: '0',
      },
    });
    try {
      const port = app.get(AgentWalletPort, { strict: false });
      expect(port).toBeInstanceOf(MockAgentWalletAdapter);
      const accountId = 'boot.npc.terraagent.mock';
      await port.createSubAccount({ opId: 'boot:acct', parent: 'npc.terraagent.mock', name: 'boot' });
      await port.addLimitedKey({
        opId: 'boot:key',
        accountId,
        publicKey: 'ed25519:boot',
        allowance: GAS,
        receiverId: 'res.terraagent.mock',
        methodNames: ['mt_transfer'],
        tokens: [{ token: TOKEN, allowance: '600' }],
      });
      const status = await port.keyStatus({ accountId, publicKey: 'ed25519:boot' });
      expect(status.receiverId).toBe('res.terraagent.mock');
      expect(tokenOf(status).available).toBe('600');
      expect(status.gasSpent).toBe('0');
    } finally {
      await app.close();
    }
  });
});
