import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { MockBadgeNftAdapter } from '../../src/near/infrastructure/adapters/badge-nft/mock-badge-nft.adapter';
import { MockChainReadAdapter } from '../../src/near/infrastructure/adapters/chain-read/mock-chain-read.adapter';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: TestDatabase;
let app: INestApplication;
let url: string;
const fast = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 };
const get = async (path: string) => (await fetch(`${url}/v1/dev/chain/${path}`)).json() as Promise<Row[]>;

beforeAll(async () => {
  db = await createTestDatabase();
  ({ app } = await createApp({ source: { SIM_THREADS: '1', DATABASE_URL: db.url, NODE_ENV: 'test' } }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const p = db.prisma;
  await new MockChainReadAdapter(p, fast).ping('explorer:ping:1');
  await new MockBadgeNftAdapter(p, fast).mint({ opId: 'badge:alice:1', collection: 'badge', ownerAccountId: 'alice.test', metadata: { name: 'A' } });
  await new MockBadgeNftAdapter(p, fast).mint({ opId: 'badge:bob:1', collection: 'badge', ownerAccountId: 'bob.test', metadata: { name: 'B' } });
  await p.mockChainBalance.createMany({ data: [{ accountId: 'alice.test', tokenId: 'NEAR', amount: '1000' }, { accountId: 'bob.test', tokenId: 'USDC', amount: '5' }] });
  await p.mockChainDao.create({ data: { id: 'dao1', policy: {}, proposals: { create: [{ id: 0, proposer: 'alice.test', kind: {}, status: 'InProgress', votes: {} }] } } });
  await p.mockChainEscrow.create({ data: { id: 'esc1', opener: 'alice.test', beneficiary: 'bob.test', tokenId: 'NEAR', amount: '7', status: 'open' } });
  await p.mockChainEscrow.create({ data: { id: 'esc2', opener: 'carol.test', tokenId: 'NEAR', amount: '9', status: 'open' } });
  await p.chainOutbox.create({ data: { opId: 'x:1', port: 'ChainRead', method: 'ping', payload: { to: 'alice.test' }, status: 'DEAD' } });
  await p.chainOutbox.create({ data: { opId: 'x:2', port: 'ChainRead', method: 'ping', payload: { to: 'bob.test' } } });
  await p.mockChainReceipt.create({ data: { txHash: 'mock:payload-acct', port: 'Escrow', method: 'open', status: 'success', payload: { opener: 'carol.test' }, blockHeight: 99999 } });
});
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('mock chain explorer dev routes', () => {
  it('receipts: newest first, extra fields, account filter by payload and by owned NFT opId', async () => {
    const all = await get('receipts');
    expect(all[0]).toMatchObject({ txHash: 'mock:payload-acct', port: 'Escrow', method: 'open' });
    expect(all.some((r) => r.opId === 'explorer:ping:1' && r.txHash.startsWith('mock:'))).toBe(true);
    expect((await get('receipts?account=carol.test')).map((r) => r.txHash)).toEqual(['mock:payload-acct']);
    const alice = await get('receipts?account=alice.test');
    expect(alice.map((r) => r.opId)).toEqual(['badge:alice:1']);
    expect(await get('receipts?account=nobody.test')).toEqual([]);
    expect(await get('receipts?account=100%25')).toEqual([]); // LIKE metacharacters are escaped
    expect(await get('receipts?limit=1')).toHaveLength(1);
  });

  it('balances, nfts, dao, escrow, outbox', async () => {
    expect((await get('balances')).map((b) => `${b.accountId}:${b.tokenId}:${b.amount}`)).toEqual(['alice.test:NEAR:1000', 'bob.test:USDC:5']);
    expect(await get('balances?account=bob.test')).toHaveLength(1);
    expect((await get('nfts?account=alice.test')).map((n) => n.ownerAccountId)).toEqual(['alice.test']);
    expect(await get('nfts?collection=badge')).toHaveLength(2);
    expect(await get('nfts?collection=other')).toHaveLength(0);
    const dao = await get('dao');
    expect(dao[0]).toMatchObject({ id: 'dao1' });
    expect(dao[0].proposals).toHaveLength(1);
    expect((await get('escrow?account=bob.test')).map((e) => e.id)).toEqual(['esc1']);
    expect(await get('escrow')).toHaveLength(2);
    expect(await get('dao?limit=100')).toHaveLength(1);
    expect(await get('outbox')).toHaveLength(2);
    expect((await get('outbox?status=DEAD')).map((o) => o.opId)).toEqual(['x:1']);
    expect((await get('outbox?account=bob.test')).map((o) => o.opId)).toEqual(['x:2']);
  });

  it('validates query params (400) and caps page size', async () => {
    for (const q of ['receipts?limit=0', 'receipts?limit=201', 'outbox?status=NOPE', 'balances?account=', 'nfts?limit=abc']) {
      expect((await fetch(`${url}/v1/dev/chain/${q}`)).status, q).toBe(400);
    }
    expect((await fetch(`${url}/v1/dev/chain/receipts?limit=200`)).status).toBe(200);
  });

  it('is 404 in production, even with an invalid query', async () => {
    const { app: prod } = await createApp({ source: { SIM_THREADS: '1', DATABASE_URL: db.url, NODE_ENV: 'production', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' } });
    await prod.listen(0, '127.0.0.1');
    const u = (await prod.getUrl()).replace('[::1]', '127.0.0.1');
    try {
      for (const r of ['balances', 'nfts', 'dao', 'escrow', 'outbox', 'receipts?account=x', 'receipts?limit=0']) expect((await fetch(`${u}/v1/dev/chain/${r}`)).status, r).toBe(404);
    } finally { await prod.close(); }
  });
});
