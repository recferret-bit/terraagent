import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DeedNftPort } from '../../src/near/application/ports/deed-nft.port';
import { MockDeedNftAdapter } from '../../src/near/infrastructure/adapters/mock/deed.adapter';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = (failRate = 0) => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate, seed: 7 });
const makeDeed = (failRate = 0) => new MockDeedNftAdapter(db.prisma, cfg(failRate), { sleep });

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W20-03 MockDeedNftAdapter on Postgres', () => {
  it('registers MockDeedNftAdapter in nearAdapters and boots with NEAR_ADAPTER_DEED=typo (fail-closed)', async () => {
    expect(
      nearAdapters.some((a) => a.port === DeedNftPort && a.kind === 'mock' && a.useClass === MockDeedNftAdapter),
    ).toBe(true);

    const { app } = await createApp({
      source: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: db.url,
        SIM_THREADS: '1',
        MOCK_LATENCY_MIN_MS: '0',
        MOCK_LATENCY_MAX_MS: '0',
        NEAR_ADAPTER_DEED: 'typo',
      },
    });
    try {
      const port = app.get(DeedNftPort, { strict: false });
      expect(port).toBeInstanceOf(MockDeedNftAdapter);
      const minted = await port.mint({
        opId: 'deed-mint:boot-1',
        collection: 'deed',
        tokenId: 'deed:boot-1',
        ownerAccountId: 'boot-1.pilot.terraagent.mock',
        metadata: { planet: 'pl_1', colony: 'boot-1', status: 'active', settled: false, version: 1 },
      });
      expect(minted.receipt.txHash).toMatch(MOCK_HASH_RE);
      expect(await port.ownerOf({ collection: 'deed', tokenId: 'deed:boot-1' })).toBe('boot-1.pilot.terraagent.mock');
    } finally {
      await app.close();
    }
  });

  it('mints idempotently, increments version on updateMetadata, records history, and enforces one-way settled', async () => {
    const adapter = makeDeed();
    const input = {
      opId: 'deed-mint:pg-1',
      collection: 'deed',
      tokenId: 'deed:pg-1',
      ownerAccountId: 'pg-1.pilot.terraagent.mock',
      metadata: {
        planet: 'pl_dune_01',
        colony: 'pg-1',
        stage: 1,
        terraformBp: 1000,
        status: 'active',
        settled: false,
        version: 1,
        imageUrl: '/v1/near/deed/deed:pg-1/image.png',
      },
    };
    const a = await adapter.mint(input);
    const b = await adapter.mint(input);
    expect(a.tokenId).toBe('deed:pg-1');
    expect(a.receipt.txHash).toBe(b.receipt.txHash);

    await adapter.updateMetadata({
      opId: 'deed-meta:pg-1:2',
      collection: 'deed',
      tokenId: 'deed:pg-1',
      metadata: { stage: 4, terraformBp: 4000 },
    });

    const record = await adapter.get('deed:pg-1');
    expect(record).not.toBeNull();
    expect(record!.version).toBe(2);
    expect(record!.settled).toBe(false);
    expect(record!.metadata.terraformBp).toBe(4000);
    expect(record!.history).toHaveLength(2);

    await adapter.updateMetadata({
      opId: 'deed-settle:pg-1',
      collection: 'deed',
      tokenId: 'deed:pg-1',
      metadata: { settled: true, status: 'settled', terraformBp: 10_000 },
    });

    const settledRecord = await adapter.get({ collection: 'deed', tokenId: 'deed:pg-1' });
    expect(settledRecord!.version).toBe(3);
    expect(settledRecord!.settled).toBe(true);
    expect(settledRecord!.metadata.status).toBe('settled');

    await expect(
      adapter.updateMetadata({
        opId: 'deed-unsettle:pg-1',
        collection: 'deed',
        tokenId: 'deed:pg-1',
        metadata: { settled: false, status: 'active' },
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
  });
});
