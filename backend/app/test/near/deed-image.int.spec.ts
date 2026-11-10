import 'reflect-metadata';
import { DeedMetadataV1, deedTokenId } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeedImageRendererService } from '../../src/near/deed/deed-image.renderer.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W20-08 DeedImageRendererService on Postgres', () => {
  it('renders 1200x630 PNG from Postgres deed row, serves cached second call in < 20ms, and re-renders on version/settlement update', async () => {
    const env = {
      NODE_ENV: 'development',
      DATABASE_URL: db.url,
      TA_WAVES: '..20',
    };
    const flags = new FlagsService(env as never);
    const repo = new DeedRepository(env as never, db.prisma);
    const renderer = new DeedImageRendererService(repo, flags);

    const colonyId = 'co_img_pg_1';
    const tokenId = deedTokenId(colonyId);
    const v1Meta = DeedMetadataV1.parse({
      planet: 'pl_img_1',
      colony: colonyId,
      colonyName: 'Helios Prime',
      planetType: 'oceanForest',
      stage: 2,
      terraformBp: 3000,
      territoryHexes: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
      ],
      status: 'active',
      settled: false,
      version: 1,
      imageUrl: `/v1/near/deed/${encodeURIComponent(tokenId)}/image.png?v=1`,
    });

    await repo.upsertInitialMint({
      colonyId,
      planetId: 'pl_img_1',
      playerId: 'pl_img_owner',
      accountId: 'co-img-pg-1.owner.terraagent.mock',
      tokenId,
      metadata: v1Meta,
      opId: `deed-mint:${colonyId}`,
    });

    const r1 = await renderer.renderForToken(tokenId);
    expect(r1.cached).toBe(false);
    expect(r1.version).toBe(1);
    expect(r1.png.readUInt32BE(16)).toBe(1200);
    expect(r1.png.readUInt32BE(20)).toBe(630);
    expect(r1.svg).toContain('Helios Prime');
    expect(r1.svg).toContain('ACTIVE DEED');

    const t0 = performance.now();
    const r2 = await renderer.renderForToken(tokenId);
    const elapsedMs = performance.now() - t0;
    expect(r2.cached).toBe(true);
    expect(elapsedMs).toBeLessThan(20);
    expect(r2.png.equals(r1.png)).toBe(true);

    // Update Postgres deed row to v2 Settled Deed
    const v2Meta = DeedMetadataV1.parse({
      ...v1Meta,
      stage: 4,
      terraformBp: 10_000,
      status: 'settled',
      settled: true,
      version: 2,
      imageUrl: `/v1/near/deed/${encodeURIComponent(tokenId)}/image.png?v=2`,
    });
    await db.prisma.deed.update({
      where: { colonyId },
      data: {
        metadata: v2Meta as object,
        metadataVersion: 2,
        status: 'settled',
        settled: true,
      },
    });

    const r3 = await renderer.renderForToken(tokenId);
    expect(r3.cached).toBe(false);
    expect(r3.version).toBe(2);
    expect(r3.svg).toContain('SETTLED DEED');
    expect(r3.svg).toContain('#FFCF5A');
    expect(r3.png.equals(r1.png)).toBe(false);

    await expect(renderer.renderForToken('deed:missing_pg')).rejects.toMatchObject({
      errorCode: 'DEED_NOT_FOUND',
      status: 404,
    });
  });
});
