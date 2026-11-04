import 'reflect-metadata';
import { RESOURCE_KEYS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  CARGO_DECIMALS,
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  fromCargoBaseUnits,
  toCargoBaseUnits,
} from '../../src/near/application/ports/cargo-token.port.js';
import { NearException } from '../../src/near/domain/errors.js';
import { nearAdapterFor } from '../../src/near/infrastructure/adapter-selection.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash.js';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module.js';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = (failRate = 0) => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate, seed: 10 });
const cargo = (failRate = 0) => new MockCargoTokenAdapter(db.prisma, cfg(failRate), { sleep });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

async function assertNep245Receipts(
  mintHash: string,
  transferHash: string,
  burnHash: string,
  alice: string,
  bob: string,
  tokenId: string,
): Promise<void> {
  const storedMint = await db.prisma.mockChainReceipt.findUniqueOrThrow({ where: { txHash: mintHash } });
  expect(storedMint.port).toBe('CargoToken');
  expect(storedMint.method).toBe('mt_mint');
  expect(storedMint.payload).toEqual({
    standard: 'nep245',
    event: 'mt_mint',
    caller: CARGO_MINTER_ACCOUNT,
    owner_id: alice,
    token_ids: [tokenId],
    amounts: [toCargoBaseUnits(300)],
    decimals: CARGO_DECIMALS,
  });

  const storedTransfer = await db.prisma.mockChainReceipt.findUniqueOrThrow({ where: { txHash: transferHash } });
  expect(storedTransfer.port).toBe('CargoToken');
  expect(storedTransfer.method).toBe('mt_transfer');
  expect(storedTransfer.payload).toEqual({
    standard: 'nep245',
    event: 'mt_transfer',
    sender_id: alice,
    receiver_id: bob,
    token_ids: [tokenId],
    amounts: [toCargoBaseUnits(120)],
    decimals: CARGO_DECIMALS,
  });

  const storedBurn = await db.prisma.mockChainReceipt.findUniqueOrThrow({ where: { txHash: burnHash } });
  expect(storedBurn.port).toBe('CargoToken');
  expect(storedBurn.method).toBe('mt_burn');
  expect(storedBurn.payload).toEqual({
    standard: 'nep245',
    event: 'mt_burn',
    caller: CARGO_MINTER_ACCOUNT,
    owner_id: alice,
    token_ids: [tokenId],
    amounts: [toCargoBaseUnits(180)],
    decimals: CARGO_DECIMALS,
  });
}

describe('MockCargoTokenAdapter lifecycle & NEP-245 receipts (W10-10)', () => {
  it('acceptance: mint -> balanceOf -> transfer -> balanceOf -> burn -> 0 in 18-decimal base units', async () => {
    const c = cargo();
    const alice = 'co-alice.pilot.terraagent.mock';
    const bob = 'co-bob.pilot.terraagent.mock';
    const tokenId = 'metals.t1';
    const amount300 = toCargoBaseUnits(300);
    const amount120 = toCargoBaseUnits(120);
    const amount180 = toCargoBaseUnits(180);

    expect(amount300).toBe('300000000000000000000');

    const mintReceipt = await c.mint({ opId: 'cargo:mint:1', to: alice, tokenId, amount: amount300 });
    expect(mintReceipt.txHash).toMatch(MOCK_HASH_RE);
    expect(mintReceipt.status).toBe('success');
    expect(await c.balanceOf({ accountId: alice, tokenId })).toBe(amount300);
    expect(fromCargoBaseUnits(await c.balanceOf({ accountId: alice, tokenId }))).toBe(300);

    const transferReceipt = await c.transfer({
      opId: 'cargo:transfer:1',
      from: alice,
      to: bob,
      tokenId,
      amount: amount120,
    });
    expect(transferReceipt.txHash).toMatch(MOCK_HASH_RE);
    expect(await c.balanceOf({ accountId: alice, tokenId })).toBe(amount180);
    expect(await c.balanceOf({ accountId: bob, tokenId })).toBe(amount120);

    const burnAlice = await c.burn({ opId: 'cargo:burn:1', from: alice, tokenId, amount: amount180 });
    const burnBob = await c.burn({ opId: 'cargo:burn:2', from: bob, tokenId, amount: amount120 });
    expect(burnAlice.txHash).toMatch(MOCK_HASH_RE);
    expect(burnBob.txHash).toMatch(MOCK_HASH_RE);
    expect(await c.balanceOf({ accountId: alice, tokenId })).toBe('0');
    expect(await c.balanceOf({ accountId: bob, tokenId })).toBe('0');

    expect(await db.prisma.mockChainAccount.count({ where: { accountId: { in: [alice, bob] } } })).toBe(2);
    await assertNep245Receipts(mintReceipt.txHash, transferReceipt.txHash, burnAlice.txHash, alice, bob, tokenId);
  });

  it('replays mint, transfer, and burn idempotently by opId without double-crediting or double-debiting', async () => {
    const c = cargo();
    const acctA = 'idem-a.terraagent.mock';
    const acctB = 'idem-b.terraagent.mock';
    const tokenId = 'minerals.t1';
    const m1 = await c.mint({ opId: 'cargo:idem:m1', to: acctA, tokenId, amount: toCargoBaseUnits(100) });
    const m2 = await c.mint({ opId: 'cargo:idem:m1', to: acctA, tokenId, amount: toCargoBaseUnits(100) });
    expect(m1.txHash).toBe(m2.txHash);
    expect(await c.balanceOf({ accountId: acctA, tokenId })).toBe(toCargoBaseUnits(100));

    const t1 = await c.transfer({ opId: 'cargo:idem:t1', from: acctA, to: acctB, tokenId, amount: toCargoBaseUnits(40) });
    const t2 = await c.transfer({ opId: 'cargo:idem:t1', from: acctA, to: acctB, tokenId, amount: toCargoBaseUnits(40) });
    expect(t1.txHash).toBe(t2.txHash);
    expect(await c.balanceOf({ accountId: acctA, tokenId })).toBe(toCargoBaseUnits(60));
    expect(await c.balanceOf({ accountId: acctB, tokenId })).toBe(toCargoBaseUnits(40));

    const b1 = await c.burn({ opId: 'cargo:idem:b1', from: acctB, tokenId, amount: toCargoBaseUnits(15) });
    const b2 = await c.burn({ opId: 'cargo:idem:b1', from: acctB, tokenId, amount: toCargoBaseUnits(15) });
    expect(b1.txHash).toBe(b2.txHash);
    expect(await c.balanceOf({ accountId: acctB, tokenId })).toBe(toCargoBaseUnits(25));
  });
});

describe('MockCargoTokenAdapter guards & binding (W10-10)', () => {
  it('throws NEAR_INSUFFICIENT_BALANCE on transfer or burn above balance and leaves balances unchanged', async () => {
    const c = cargo();
    const acct = 'lowbal.terraagent.mock';
    const other = 'other.terraagent.mock';
    const tokenId = 'bio.water';
    await c.mint({ opId: 'cargo:low:m1', to: acct, tokenId, amount: toCargoBaseUnits(50) });

    await expect(
      c.transfer({ opId: 'cargo:low:t1', from: acct, to: other, tokenId, amount: toCargoBaseUnits(51) }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE', status: 409 });

    await expect(
      c.burn({ opId: 'cargo:low:b1', from: acct, tokenId, amount: toCargoBaseUnits(51) }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE', status: 409 });

    expect(await c.balanceOf({ accountId: acct, tokenId })).toBe(toCargoBaseUnits(50));
    expect(await c.balanceOf({ accountId: other, tokenId })).toBe('0');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: { in: ['cargo:low:t1', 'cargo:low:b1'] } } })).toBe(0);
  });

  it('enforces minter-only on mint and burn and validates the 10 ResourceKey tokenIds', async () => {
    const c = cargo();
    const acct = 'guard.terraagent.mock';

    await expect(
      c.mint({ opId: 'cargo:guard:m1', to: acct, tokenId: 'metals.t1', amount: toCargoBaseUnits(10), caller: 'rogue.terraagent.mock' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER', status: 403 });

    await expect(
      c.burn({ opId: 'cargo:guard:b1', from: acct, tokenId: 'metals.t1', amount: toCargoBaseUnits(10), caller: 'rogue.terraagent.mock' }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER', status: 403 });

    await expect(
      c.mint({ opId: 'cargo:guard:badtoken', to: acct, tokenId: 'unknown.token', amount: toCargoBaseUnits(10) }),
    ).rejects.toBeInstanceOf(NearException);

    expect(RESOURCE_KEYS).toHaveLength(10);
    for (const key of RESOURCE_KEYS) {
      expect(await c.balanceOf({ accountId: acct, tokenId: key })).toBe('0');
    }
  });

  it('discovers MockCargoTokenAdapter and resolves CargoTokenPort from the booted app', async () => {
    expect(
      nearAdapters.some((a) => a.port === CargoTokenPort && a.kind === 'mock' && a.useClass === MockCargoTokenAdapter),
    ).toBe(true);
    expect(nearAdapterFor('CargoToken', { NEAR_ADAPTER_CARGO: 'testnet' })).toBe('testnet');
    expect(nearAdapterFor('CargoToken', {})).toBe('mock');

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
      const port = app.get(CargoTokenPort, { strict: false });
      expect(port).toBeInstanceOf(MockCargoTokenAdapter);
      const r = await port.mint({
        opId: 'cargo:app:m1',
        to: 'app-colony.terraagent.mock',
        tokenId: 'bio.biomass',
        amount: toCargoBaseUnits(25),
      });
      expect(r.txHash).toMatch(MOCK_HASH_RE);
      expect(await port.balanceOf({ accountId: 'app-colony.terraagent.mock', tokenId: 'bio.biomass' })).toBe(
        toCargoBaseUnits(25),
      );
    } finally {
      await app.close();
    }
  });
});
