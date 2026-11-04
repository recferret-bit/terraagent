import 'reflect-metadata';
import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SignedIntent } from '../../src/near/application/ports/intents.port.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';
import { loadKekRing } from '../../src/near/keystore/kek.js';
import { KeyStore } from '../../src/near/keystore/keys.js';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 5 };
const adapter = (now?: () => number) => new MockIntentsAdapter(db.prisma, cfg, { sleep, ...(now ? { now } : {}) });
const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const w = (n: number) => toChainUnits('bio.water', String(n));
const FUTURE = Date.now() + 3_600_000;
let n = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});
afterEach(() => mockChainControls.reset());

async function colony(name: string, water: bigint, usdc: bigint): Promise<string> {
  const g = new KeyStore(loadKekRing({ NODE_ENV: 'test' })).generate();
  n += 1;
  await db.prisma.mockChainAccount.create({ data: { accountId: name, kind: 'named' } });
  await db.prisma.$executeRaw`INSERT INTO chain.near_colony_account (account_id, player_id, slot, owner_account_id, public_key, encrypted_secret, kek_version)
    VALUES (${name}, ${'p' + n}, 'colony-1', 'owner.mock', ${g.row.publicKey}, ${g.row.encryptedSecret}, ${g.row.kekVersion})`;
  await db.prisma.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES (${name}, ${WATER}, ${water.toString()}::numeric), (${name}, ${USDC}, ${usdc.toString()}::numeric)`;
  return name;
}
const bal = async (a: string) => {
  const rows = await db.prisma.mockChainIntentsBalance.findMany({ where: { accountId: a } });
  return Object.fromEntries(rows.map((r) => [r.tokenId, r.amount.toFixed()]));
};

/** A trade: seller gives `water` water for `usdc` USDC. */
async function trade(ix: MockIntentsAdapter, seller: string, buyer: string, water: bigint, usdc: bigint, extra: { buyerWater?: bigint; deadlineMs?: number } = {}): Promise<SignedIntent[]> {
  const deadlineMs = extra.deadlineMs ?? FUTURE;
  return [
    await ix.signTokenDiff({ accountId: seller, deltas: { [WATER]: (-w(Number(water))).toString(), [USDC]: usdc.toString() }, deadlineMs }),
    await ix.signTokenDiff({ accountId: buyer, deltas: { [WATER]: (w(Number(water)) + (extra.buyerWater ?? 0n)).toString(), [USDC]: (-usdc).toString() }, deadlineMs }),
  ];
}

describe('MockIntentsAdapter simulate/execute (W13-05)', () => {
  it('acceptance: water legs summing to +1 reject the whole batch; a valid batch moves all legs', async () => {
    const ix = adapter();
    const s = await colony('sell1.mock', w(100), 0n);
    const b = await colony('buy1.mock', 0n, 1000n);
    const bad = await trade(ix, s, b, 10n, 500n, { buyerWater: 1n });
    expect(await ix.simulate(bad)).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_DIFF_NOT_ZERO' });
    await expect(ix.execute({ opId: 'bad1', intents: bad })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_DIFF_NOT_ZERO' });
    expect(await bal(s)).toEqual({ [WATER]: w(100).toString(), [USDC]: '0' });
    expect(await bal(b)).toEqual({ [WATER]: '0', [USDC]: '1000' });
    expect(await db.prisma.mockChainIntentNonce.count({ where: { signer: { in: [s, b] } } })).toBe(0);

    const good = await trade(ix, s, b, 10n, 500n);
    expect(await ix.simulate(good)).toMatchObject({ ok: true });
    const r = await ix.execute({ opId: 'good1', intents: good });
    expect(r.txHash).toMatch(/^mock:/);
    expect(await bal(s)).toEqual({ [WATER]: w(90).toString(), [USDC]: '500' });
    expect(await bal(b)).toEqual({ [WATER]: w(10).toString(), [USDC]: '500' });
    expect(await db.prisma.mockChainIntent.count({ where: { signer: { in: [s, b] }, status: 'executed' } })).toBe(2);
    expect(await db.prisma.mockChainIntentNonce.count({ where: { signer: { in: [s, b] } } })).toBe(2);

    // idempotent retry: same receipt, nothing applied twice (and the nonce is not "reused" for the same opId)
    expect(await ix.execute({ opId: 'good1', intents: good })).toEqual(r);
    expect(await bal(s)).toEqual({ [WATER]: w(90).toString(), [USDC]: '500' });
  });

  it('replay with a new opId, expired, bad signature, insufficient', async () => {
    const ix = adapter();
    const s = await colony('sell2.mock', w(5), 0n);
    const b = await colony('buy2.mock', 0n, 100n);
    const batch = await trade(ix, s, b, 5n, 100n);
    await ix.execute({ opId: 'r1', intents: batch });
    const afterFirst = [await bal(s), await bal(b)];
    expect(await ix.simulate(batch)).toMatchObject({ ok: false, errorCode: 'NEAR_INTENT_NONCE_REUSED' });
    await expect(ix.execute({ opId: 'r2', intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_NONCE_REUSED' });
    expect([await bal(s), await bal(b)]).toEqual(afterFirst);

    const expired = await trade(ix, b, s, 0n, 0n, { deadlineMs: Date.now() - 1000 });
    await expect(ix.execute({ opId: 'e1', intents: expired })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_EXPIRED' });

    const fresh = await trade(ix, b, s, 1n, 1n);
    const tampered = [fresh[0]!, { ...fresh[1]!, diff: { ...fresh[1]!.diff, deltas: { ...fresh[1]!.diff.deltas, [USDC]: '-2' } } }];
    await expect(ix.execute({ opId: 'sig1', intents: tampered })).rejects.toMatchObject({ errorCode: 'NEAR_INTENT_BAD_SIGNATURE' });
    // a key that is valid but not the registered one of the signer
    const other = new KeyStore(loadKekRing({ NODE_ENV: 'test' })).generate();
    expect(await ix.simulate([{ ...fresh[0]!, publicKey: other.row.publicKey }, fresh[1]!])).toMatchObject({ ok: true });

    const poor = await trade(ix, s, b, 50n, 1n); // s only has 0 water now
    expect(await ix.simulate(poor)).toMatchObject({ ok: false, errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    await expect(ix.execute({ opId: 'poor1', intents: poor })).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect([await bal(s), await bal(b)]).toEqual(afterFirst);
    expect(await db.prisma.mockChainIntentNonce.count({ where: { signer: { in: [s, b] } } })).toBe(2);
  });

  it('injected failure changes nothing; outcome-unknown applies then throws, retry returns the receipt', async () => {
    const ix = adapter();
    const s = await colony('sell3.mock', w(20), 0n);
    const b = await colony('buy3.mock', 0n, 100n);
    const batch = await trade(ix, s, b, 20n, 100n);
    mockChainControls.setFail('intents', 1);
    await expect(ix.execute({ opId: 'f1', intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE' });
    expect(await bal(s)).toEqual({ [WATER]: w(20).toString(), [USDC]: '0' });
    expect(await db.prisma.mockChainIntentNonce.count({ where: { signer: s } })).toBe(0);
    mockChainControls.setFail('intents', 0);

    mockChainControls.setOutcomeUnknown('Intents', true);
    await expect(ix.execute({ opId: 'u1', intents: batch })).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
    expect(await bal(s)).toEqual({ [WATER]: '0', [USDC]: '100' });
    mockChainControls.setOutcomeUnknown('Intents', false);
    const receipt = await ix.execute({ opId: 'u1', intents: batch });
    expect(receipt.status).toBe('success');
    expect(await bal(s)).toEqual({ [WATER]: '0', [USDC]: '100' });
  });
});
