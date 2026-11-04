import 'reflect-metadata';
import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { CargoTokenPort, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { IntentsBalanceReadPort } from '../../src/near/application/ports/intents-balance-read.port.js';
import { MockIntentsBalanceReadAdapter } from '../../src/near/infrastructure/adapters/mock/intents-balance-read.adapter.js';
import { verifyTokenDiffIntent } from '../../src/near/intents/nep413-token-diff.js';
import { loadKekRing } from '../../src/near/keystore/kek.js';
import { KeyStore } from '../../src/near/keystore/keys.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash.js';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 4 };
const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const NEAR = MARKET_TOKENS.NEAR.verifierId;
const w = (n: number) => toChainUnits('bio.water', String(n)).toString();

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

const make = () => ({
  cargo: new MockCargoTokenAdapter(db.prisma, cfg, { sleep }),
  intents: new MockIntentsAdapter(db.prisma, cfg, { sleep }),
});
const own = (account: string, token: string) =>
  db.prisma.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId: account, tokenId: token } } }).then((r) => r?.amount.toFixed() ?? '0');

describe('MockIntentsAdapter (W13-04)', () => {
  it('acceptance: deposit 300 water, withdraw 100, idempotent, insufficient, USDC round-trip', async () => {
    const { cargo, intents } = make();
    const acc = 'alice.mock';
    await cargo.mint({ opId: 'm1', to: acc, tokenId: 'bio.water', amount: toCargoBaseUnits(300) });

    const dep = await intents.deposit({ opId: 'd1', accountId: acc, tokenId: WATER, amount: w(300) });
    expect(dep.txHash).toMatch(MOCK_HASH_RE);
    expect(dep.network).toBe('mock');
    expect(await own(acc, 'bio.water')).toBe('0');
    expect(await intents.verifierBalance(acc, WATER)).toBe(300n);
    expect(await intents.verifierBalances(acc)).toEqual({ 'bio.water': 300n });
    const raw = await db.prisma.mockChainIntentsBalance.findUniqueOrThrow({ where: { accountId_tokenId: { accountId: acc, tokenId: WATER } } });
    expect(raw.amount.toFixed()).toBe(toCargoBaseUnits(300));

    const wd = await intents.withdraw({ opId: 'w1', accountId: acc, tokenId: WATER, amount: w(100), to: acc });
    expect(await own(acc, 'bio.water')).toBe(toCargoBaseUnits(100));
    expect(await intents.verifierBalance(acc, WATER)).toBe(200n);

    // replay: same receipt, no change
    expect(await intents.deposit({ opId: 'd1', accountId: acc, tokenId: WATER, amount: w(300) })).toEqual(dep);
    expect(await intents.withdraw({ opId: 'w1', accountId: acc, tokenId: WATER, amount: w(100), to: acc })).toEqual(wd);
    expect(await intents.verifierBalance(acc, WATER)).toBe(200n);
    expect(await own(acc, 'bio.water')).toBe(toCargoBaseUnits(100));

    // insufficient: nothing changes
    for (const p of [
      intents.deposit({ opId: 'd2', accountId: acc, tokenId: WATER, amount: w(101) }),
      intents.withdraw({ opId: 'w2', accountId: acc, tokenId: WATER, amount: w(201), to: acc }),
    ]) await expect(p).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(await intents.verifierBalance(acc, WATER)).toBe(200n);
    expect(await own(acc, 'bio.water')).toBe(toCargoBaseUnits(100));
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: { in: ['d2', 'w2'] } } })).toBe(0);

    // withdraw to another account
    await intents.withdraw({ opId: 'w3', accountId: acc, tokenId: WATER, amount: w(50), to: 'bob.mock' });
    expect(await own('bob.mock', 'bio.water')).toBe(toCargoBaseUnits(50));
  });

  it('USDC and NEAR round-trip; unknown token rejected; unimplemented methods unavailable', async () => {
    const { intents } = make();
    const acc = 'carol.mock';
    await db.prisma.$executeRaw`INSERT INTO chain.mock_chain_account (account_id, kind) VALUES (${acc}, 'named') ON CONFLICT DO NOTHING`;
    await db.prisma.$executeRaw`INSERT INTO chain.mock_chain_balance (account_id, token_id, amount) VALUES (${acc}, 'USDC', 5000000), (${acc}, 'NEAR', 7)`;
    await intents.deposit({ opId: 'cu1', accountId: acc, tokenId: USDC, amount: '5000000' });
    await intents.deposit({ opId: 'cn1', accountId: acc, tokenId: NEAR, amount: '7' });
    expect(await intents.verifierBalances(acc)).toEqual({ USDC: 5000000n, NEAR: 7n });
    expect(await own(acc, 'USDC')).toBe('0');
    await intents.withdraw({ opId: 'cu2', accountId: acc, tokenId: USDC, amount: '5000000', to: acc });
    expect(await own(acc, 'USDC')).toBe('5000000');
    expect(await intents.verifierBalances(acc)).toEqual({ NEAR: 7n });
    await expect(intents.deposit({ opId: 'x1', accountId: acc, tokenId: 'nep141:nope', amount: '1' })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
    await expect(intents.execute({ opId: 'x2', intents: [] })).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
  });

  it('IntentsPort resolves to MockIntentsAdapter from the container by default (cargo port too)', async () => {
    const { app } = await createApp({ source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' } });
    try {
      expect(app.get(IntentsPort, { strict: false })).toBeInstanceOf(MockIntentsAdapter);
      expect(app.get(CargoTokenPort, { strict: false })).toBeInstanceOf(MockCargoTokenAdapter);
    } finally {
      await app.close();
    }
  });
});

describe('signTokenDiff + balance read port (W13-07)', () => {
  it('signs with the decrypted colony key and reads balances through IntentsBalanceReadPort', async () => {
    const { app } = await createApp({ source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' } });
    try {
      const keys = new KeyStore(loadKekRing({ NODE_ENV: 'test' }));
      const g = keys.generate();
      await db.prisma.mockChainAccount.create({ data: { accountId: 'colx.mock', kind: 'named' } });
      await db.prisma.$executeRaw`INSERT INTO chain.near_colony_account (account_id, player_id, slot, owner_account_id, public_key, encrypted_secret, kek_version)
        VALUES ('colx.mock', 'p1', 'colony-1', 'owner.mock', ${g.row.publicKey}, ${g.row.encryptedSecret}, ${g.row.kekVersion})`;
      const intents = app.get(IntentsPort, { strict: false });
      const signed = await intents.signTokenDiff({ accountId: 'colx.mock', deltas: { [USDC]: '5' }, deadlineMs: Date.now() + 60000 });
      expect(signed.publicKey).toBe(g.row.publicKey);
      expect(verifyTokenDiffIntent(signed)).toBe(true);
      expect(verifyTokenDiffIntent({ ...signed, diff: { ...signed.diff, deltas: { [USDC]: '6' } } })).toBe(false);
      await expect(intents.signTokenDiff({ accountId: 'nobody.mock', deltas: {}, deadlineMs: 1 })).rejects.toMatchObject({ errorCode: 'NEAR_ACCOUNT_NOT_FOUND' });
      expect(await db.prisma.mockChainIntentNonce.count({ where: { signer: 'colx.mock' } })).toBe(0);

      const reader = app.get(IntentsBalanceReadPort, { strict: false });
      expect(reader).toBeInstanceOf(MockIntentsBalanceReadAdapter);
      await db.prisma.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES ('colx.mock', ${WATER}, ${w(42)}::numeric), ('colx.mock', ${USDC}, 9)`;
      expect(await reader.verifierBalance('colx.mock', 'bio.water')).toBe(42n);
      expect(await reader.verifierBalance('colx.mock', USDC)).toBe(9n);
      expect(await reader.verifierBalances('colx.mock')).toEqual({ 'bio.water': 42n, USDC: 9n });
    } finally {
      await app.close();
    }
  });
});
