import 'reflect-metadata';
import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SignedIntent } from '../../src/near/application/ports/intents.port.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';

/** Deterministic fault injection (`mockChainControls.faults`) against the DB-backed mock intents adapter. */
let db: TestDatabase;
let ix: MockIntentsAdapter;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 5 };
const WATER = MARKET_TOKENS['bio.water'].verifierId;
const w = (n: number) => toChainUnits('bio.water', String(n));
const FUTURE = Date.now() + 3_600_000;
let n = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  ix = new MockIntentsAdapter(db.prisma, cfg, { sleep: async () => undefined });
});
afterAll(async () => { await db?.drop(); });
afterEach(() => mockChainControls.reset());

async function acct(water: bigint): Promise<string> {
  n += 1;
  const id = `f${n}.mock`;
  await ix.testRegisterSigner(id);
  if (water > 0n) await ix.testSeedVerifier(id, WATER, water);
  return id;
}
const waterOf = (a: string) => ix.verifierBalance(a, WATER);

async function transfer(from: string, to: string, units: number): Promise<SignedIntent[]> {
  return [
    await ix.signTokenDiff({ accountId: from, deltas: { [WATER]: (-w(units)).toString() }, deadlineMs: FUTURE }),
    await ix.signTokenDiff({ accountId: to, deltas: { [WATER]: w(units).toString() }, deadlineMs: FUTURE }),
  ];
}

describe('mock chain fault injection (DB adapter)', () => {
  it('fail_before: no receipt, no balance change; the same opId runs on retry', async () => {
    const [a, b] = [await acct(w(10)), await acct(0n)];
    const batch = await transfer(a, b, 4);
    const h = mockChainControls.faults.inject({ kind: 'fail_before', port: 'Intents', method: 'execute', opIdPrefix: 'trade:' });
    await expect(ix.execute({ opId: 'trade:f1', intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE' });
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'trade:f1' } })).toBe(0);
    expect(await waterOf(a)).toBe(10n);
    await ix.execute({ opId: 'trade:f1', intents: batch });
    expect(h.fired()).toBe(1);
    expect([await waterOf(a), await waterOf(b)]).toEqual([6n, 4n]);
  });

  it('fail_after: applied but NEAR_UNAVAILABLE; retry returns the stored receipt without a second effect', async () => {
    const [a, b] = [await acct(w(10)), await acct(0n)];
    const batch = await transfer(a, b, 4);
    mockChainControls.faults.inject({ kind: 'fail_after', method: 'execute' });
    await expect(ix.execute({ opId: 'trade:f2', intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
    expect([await waterOf(a), await waterOf(b)]).toEqual([6n, 4n]);
    const receipt = await ix.execute({ opId: 'trade:f2', intents: batch });
    expect(receipt.status).toBe('success');
    expect([await waterOf(a), await waterOf(b)]).toEqual([6n, 4n]);
  });

  it('insufficient_funds is forced even when the balance is there, and writes nothing', async () => {
    const [a, b] = [await acct(w(10)), await acct(0n)];
    const batch = await transfer(a, b, 1);
    mockChainControls.faults.inject({ kind: 'insufficient_funds', method: 'execute' });
    await expect(ix.execute({ opId: 'trade:f3', intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(await db.prisma.mockChainIntentNonce.count({ where: { signer: a } })).toBe(0);
    expect(await waterOf(a)).toBe(10n);
  });

  it('duplicate delivery: one effect, one receipt', async () => {
    const [a, b] = [await acct(w(10)), await acct(0n)];
    const batch = await transfer(a, b, 3);
    mockChainControls.faults.inject({ kind: 'duplicate', method: 'execute' });
    await ix.execute({ opId: 'trade:f4', intents: batch });
    expect([await waterOf(a), await waterOf(b)]).toEqual([7n, 3n]);
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'trade:f4' } })).toBe(1);
  });

  it('hold: finality is delayed until the test releases the call', async () => {
    const [a, b] = [await acct(w(10)), await acct(0n)];
    const batch = await transfer(a, b, 2);
    const h = mockChainControls.faults.inject({ kind: 'hold', method: 'execute' });
    let done = false;
    const p = ix.execute({ opId: 'trade:f5', intents: batch }).then(() => { done = true; });
    await h.waitHeld();
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    expect(await waterOf(a)).toBe(10n);
    h.release();
    await p;
    expect([await waterOf(a), await waterOf(b)]).toEqual([8n, 2n]);
  });

  it('a rule for another opId prefix leaves the call alone', async () => {
    const [a, b] = [await acct(w(10)), await acct(0n)];
    const h = mockChainControls.faults.inject({ kind: 'fail_before', opIdPrefix: 'market-deposit:' });
    await ix.execute({ opId: 'trade:f6', intents: await transfer(a, b, 1) });
    expect(h.fired()).toBe(0);
  });
});
