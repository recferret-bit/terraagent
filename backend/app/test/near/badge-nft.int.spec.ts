import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeNftPortContract } from '../../src/near/__contract__/nft.contract';
import { BadgeNftPort } from '../../src/near/application/ports/badge-nft.port';
import { MockBadgeNftAdapter } from '../../src/near/infrastructure/adapters/badge-nft/mock-badge-nft.adapter';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { createApp } from '../../src/app';
import { TestNftMock } from './test-nft.mock';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = (failRate = 0) => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate, seed: 5 });
const badge = (failRate = 0) => new MockBadgeNftAdapter(db.prisma, cfg(failRate), { sleep });
const rows = (collection: string) => db.prisma.mockChainNft.findMany({ where: { collection } });

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

describeNftPortContract('MockBadgeNftAdapter', () => ({ port: badge(), collection: 'badge', mock: true }));
describeNftPortContract('TestNftMock (base reuse)', () => ({ port: new TestNftMock(db.prisma, cfg(), { sleep }) as never, collection: 'test', mock: true }));

describe('MockBadgeNftAdapter on Postgres', () => {
  it('acceptance: mint twice with the same opId gives one NFT row and the same mock: receipt', async () => {
    const input = { opId: 'badge:acc:1', collection: 'badge', ownerAccountId: 'acc.near', metadata: { name: 'Founder' } };
    const a = await badge().mint(input);
    const b = await badge().mint(input);
    const found = (await rows('badge')).filter((r) => r.opId === input.opId);
    console.log('acceptance:', { rows: found.length, first: a, second: b });
    expect(found).toHaveLength(1);
    expect(a.receipt.txHash).toBe(b.receipt.txHash);
    expect(a.receipt.txHash).toMatch(MOCK_HASH_RE);
    expect(a.tokenId).toBe(b.tokenId);
    expect(await db.prisma.mockChainNftMetaHistory.count({ where: { opId: input.opId } })).toBe(1);
    expect(await db.prisma.mockChainAccount.count({ where: { accountId: 'acc.near' } })).toBe(1);
  });

  it('concurrent double mint with one opId yields one row and one receipt', async () => {
    const input = { opId: 'badge:conc:1', collection: 'badge', ownerAccountId: 'conc.near', metadata: { n: 1 } };
    const [a, b] = await Promise.all([badge().mint(input), badge().mint(input)]);
    expect(a.tokenId).toBe(b.tokenId);
    expect(a.receipt.txHash).toBe(b.receipt.txHash);
    expect((await rows('badge')).filter((r) => r.opId === input.opId)).toHaveLength(1);
    expect(await db.prisma.mockChainNftMetaHistory.count({ where: { opId: input.opId } })).toBe(1);
  });

  it('different opId with an existing tokenId is NEAR_NFT_EXISTS', async () => {
    await badge().mint({ opId: 'badge:t:1', collection: 'badge', ownerAccountId: 'a.near', tokenId: 'T1', metadata: {} });
    await expect(badge().mint({ opId: 'badge:t:2', collection: 'badge', ownerAccountId: 'b.near', tokenId: 'T1', metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_EXISTS', status: 409 });
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'badge:t:2' } })).toBe(0);
  });

  it('every metadata change appends a history row, mint included', async () => {
    const m = badge();
    await m.mint({ opId: 'badge:h:1', collection: 'badge', ownerAccountId: 'h.near', tokenId: 'H1', metadata: { v: 1 } });
    await m.updateMetadata({ opId: 'badge:h:2', collection: 'badge', tokenId: 'H1', metadata: { v: 2 } });
    await m.updateMetadata({ opId: 'badge:h:2', collection: 'badge', tokenId: 'H1', metadata: { v: 2 } });
    const hist = await db.prisma.mockChainNftMetaHistory.findMany({ where: { collection: 'badge', tokenId: 'H1' }, orderBy: { id: 'asc' } });
    expect(hist.map((h) => h.metadata)).toEqual([{ v: 1 }, { v: 2 }]);
    expect((await db.prisma.mockChainNft.findUniqueOrThrow({ where: { collection_tokenId: { collection: 'badge', tokenId: 'H1' } } })).metadata).toEqual({ v: 2 });
  });

  it('rejects metadata that is not plain JSON or too large, and other collections', async () => {
    const m = badge();
    const base = { opId: 'badge:bad', collection: 'badge', ownerAccountId: 'x.near' };
    await expect(m.mint({ ...base, metadata: { n: NaN } })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
    await expect(m.mint({ ...base, metadata: { d: new Date() } })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
    await expect(m.mint({ ...base, metadata: { big: 'x'.repeat(20_000) } })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
    await expect(m.mint({ ...base, collection: 'deed', metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'badge:bad' } })).toBe(0);
  });

  it('MOCK_FAIL_RATE=1 throws the injected failure and leaves no row', async () => {
    await expect(badge(1).mint({ opId: 'badge:fail', collection: 'badge', ownerAccountId: 'f.near', metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE' });
    expect(await db.prisma.mockChainNft.count({ where: { opId: 'badge:fail' } })).toBe(0);
  });

  it('the binding module discovers the mock adapter for BadgeNftPort', () => {
    expect(nearAdapters.some((a) => a.port === BadgeNftPort && a.kind === 'mock' && a.useClass === MockBadgeNftAdapter)).toBe(true);
  });

  it('BadgeNftPort resolves to the mock from the booted app', async () => {
    const { app } = await createApp({ source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' } });
    try {
      const port = app.get(BadgeNftPort, { strict: false });
      expect(port).toBeInstanceOf(MockBadgeNftAdapter);
      const r = await port.mint({ opId: 'badge:app:1', collection: 'badge', ownerAccountId: 'app.near', metadata: {} });
      expect(await port.ownerOf({ collection: 'badge', tokenId: r.tokenId })).toBe('app.near');
    } finally { await app.close(); }
  });
});
