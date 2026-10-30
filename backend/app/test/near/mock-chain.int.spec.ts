import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoreException } from '../../src/core/errors';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { FixtureMock } from './fixture-mock';

let db: TestDatabase;
const slept: number[] = [];
const sleep = async (ms: number) => void slept.push(ms);
const make = (failRate = 0) => new FixtureMock(db.prisma, { latencyMinMs: 300, latencyMaxMs: 1500, failRate, seed: 3 }, { sleep });
const bal = async (a: string, t: string) => (await db.prisma.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId: a, tokenId: t } } }))?.amount.toFixed();

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

describe('MockChainBase on Postgres', () => {
  it('success writes a mock: receipt, credits the ledger, latency in bounds', async () => {
    const r = await make().fund('fund:1', 'alice.near', 'NEAR', '1000');
    expect(r).toMatchObject({ status: 'success', network: 'mock' });
    expect(r.txHash).toMatch(MOCK_HASH_RE);
    const row = await db.prisma.mockChainReceipt.findUniqueOrThrow({ where: { txHash: r.txHash } });
    expect(row).toMatchObject({ opId: 'fund:1', port: 'Fixture', method: 'fund', status: 'success' });
    expect(await bal('alice.near', 'NEAR')).toBe('1000');
    expect(slept.at(-1)).toBeGreaterThanOrEqual(300);
    expect(slept.at(-1)).toBeLessThanOrEqual(1500);
  });

  it('same opId is idempotent: same receipt, no double credit; block height is monotonic', async () => {
    const m = make();
    const a = await m.fund('fund:1', 'alice.near', 'NEAR', '1000');
    expect(a.txHash).toBe((await m.fund('fund:1', 'alice.near', 'NEAR', '1000')).txHash);
    expect(await bal('alice.near', 'NEAR')).toBe('1000');
    const b = await m.fund('fund:2', 'alice.near', 'NEAR', '5');
    expect(b.blockHeight!).toBeGreaterThan(a.blockHeight!);
  });

  it('debit beyond balance throws NEAR_INSUFFICIENT_BALANCE and changes nothing', async () => {
    const err = await make().spend('spend:1', 'alice.near', 'NEAR', '99999').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreException);
    expect(err).toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE', status: 409 });
    expect(await bal('alice.near', 'NEAR')).toBe('1005');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'spend:1' } })).toBe(0);
    await make().spend('spend:2', 'alice.near', 'NEAR', '5');
    expect(await bal('alice.near', 'NEAR')).toBe('1000');
  });

  it('MOCK_FAIL_RATE=1 throws the injected-failure CoreException and writes nothing', async () => {
    const before = await db.prisma.mockChainReceipt.count();
    const err = await make(1).fund('fund:3', 'bob.near', 'NEAR', '1').catch((e: unknown) => e);
    console.log('acceptance:', { name: (err as Error).name, errorCode: (err as CoreException).errorCode, status: (err as CoreException).status, message: (err as Error).message });
    expect(err).toBeInstanceOf(CoreException);
    expect(err).toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE', status: 503 });
    expect(await db.prisma.mockChainReceipt.count()).toBe(before);
    expect(await bal('bob.near', 'NEAR')).toBeUndefined();
  });
});
