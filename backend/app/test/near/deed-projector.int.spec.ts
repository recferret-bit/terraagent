import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W20-06 DeedProjectorService on Postgres', () => {
  it('persists pendingMilestone to chain.deed on stage, terraform, trade, and truce milestones and transfers owner', async () => {
    const env = {
      NODE_ENV: 'development',
      DATABASE_URL: db.url,
      TA_WAVES: 'W00,W01,W05,W06,W08,W13,W18,W20',
    };
    const flags = new FlagsService(env as never);
    const repo = new DeedRepository(env as never, db.prisma);
    const bus = new EventBus();
    const minter = new DeedMintOutboxService(
      flags,
      repo,
      bus,
      undefined,
      undefined,
      env as never,
      db.prisma,
    );
    const projector = new DeedProjectorService(
      flags,
      repo,
      bus,
      undefined,
      env as never,
      db.prisma,
    );
    minter.onModuleInit();
    projector.onModuleInit();

    await minter.mintForColony({
      colonyId: 'co_proj_pg_1',
      planetId: 'pl_proj_1',
      playerId: 'pl_owner_1',
      stage: 1,
      terraformBp: 1000,
    });

    await projector.handleEvent({
      planetId: 'pl_proj_1',
      kind: 'stageReached',
      colonyIds: ['co_proj_pg_1'],
      data: { colonyId: 'co_proj_pg_1', colonyIndex: 0, stage: 3 },
    });
    await projector.handleEvent({
      planetId: 'pl_proj_1',
      kind: 'tileStateChanged',
      colonyIds: ['co_proj_pg_1'],
      data: { colonyId: 'co_proj_pg_1', terraformBp: 4500 },
    });
    await projector.handleEvent({
      planetId: 'pl_proj_1',
      kind: 'tradeSettled',
      colonyIds: ['co_proj_pg_1'],
      data: { colonyId: 'co_proj_pg_1', quoteTotal: 350 },
    });
    await projector.handleEvent({
      planetId: 'pl_proj_1',
      kind: 'truceSigned',
      colonyIds: ['co_proj_pg_1'],
      data: { colonyId: 'co_proj_pg_1' },
    });

    const row = await db.prisma.deed.findUnique({ where: { colonyId: 'co_proj_pg_1' } });
    const pending = row?.pendingMilestone as Record<string, unknown> | null;
    expect(pending).not.toBeNull();
    expect(pending?.stage).toBe(3);
    expect(pending?.terraformBp).toBe(4000);
    expect(pending?.tradeVolume).toBe(300);
    expect(pending?.truces).toBe(1);
    expect(pending?.walls).toBeUndefined();

    const txRes = await projector.transferDeedOwnership({
      colonyId: 'co_proj_pg_1',
      newPlayerId: 'pl_owner_2',
      newAccountId: 'co-proj-pg-1.owner2.terraagent.mock',
    });
    expect(txRes.newPlayerId).toBe('pl_owner_2');
    const updatedRow = await db.prisma.deed.findUnique({ where: { colonyId: 'co_proj_pg_1' } });
    expect(updatedRow?.playerId).toBe('pl_owner_2');
    expect(updatedRow?.accountId).toBe('co-proj-pg-1.owner2.terraagent.mock');

    projector.onModuleDestroy();
    minter.onModuleDestroy();
  });
});
