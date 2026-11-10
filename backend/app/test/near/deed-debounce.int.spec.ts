import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DEFAULT_RELAY_CONFIG, OutboxRelay } from '../../src/near/application/outbox/outbox-relay.js';
import { DEED_DEBOUNCE_WINDOW_MS, DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import { MockDeedNftAdapter } from '../../src/near/infrastructure/adapters/mock/deed.adapter.js';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash.js';

let db: TestDatabase;
const sleep = async () => undefined;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function createPgDebounceHarness() {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: '..20' };
  const flags = new FlagsService(env as never);
  const repo = new DeedRepository({ ...env, NODE_ENV: 'development' } as never, db.prisma);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const outboxRepo = new ChainOutboxRepository(db.prisma);
  const deedAdapter = new MockDeedNftAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 19 },
    { sleep },
  );
  const relay = new OutboxRelay(outboxRepo, DEFAULT_RELAY_CONFIG, {
    resolve: (port) => {
      if (port === 'DeedNft') return deedAdapter;
      throw new Error(`unexpected port ${port}`);
    },
    onRowDone: async (row, res, txHash) => listeners.emitDone(row, res, txHash),
    onRowFailed: async (row, err, dead) => listeners.emitFailed(row, err, dead),
  });
  const minter = new DeedMintOutboxService(
    flags,
    repo,
    bus,
    outboxRepo,
    listeners,
    { ...env, NODE_ENV: 'development' } as never,
    db.prisma,
  );
  const projector = new DeedProjectorService(
    flags,
    repo,
    bus,
    undefined,
    { ...env, NODE_ENV: 'development' } as never,
    db.prisma,
  );
  const debounce = new DeedDebounceService(
    flags,
    repo,
    projector,
    minter,
    bus,
    outboxRepo,
    listeners,
    undefined,
    { ...env, NODE_ENV: 'test' } as never,
    db.prisma,
  );
  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  return { repo, deedAdapter, relay, minter, projector, debounce };
}

describe('W20-07 DeedDebounceService on Postgres', () => {
  it('coalesces 5 milestones in 1 min into 1 outbox update after 10 min and relays to MockDeedNftAdapter', async () => {
    const { repo, deedAdapter, relay, minter, projector, debounce } = createPgDebounceHarness();

    await minter.mintForColony({
      colonyId: 'co_deb_pg_1',
      planetId: 'pl_deb_1',
      playerId: 'p_deb_1',
      stage: 1,
      terraformBp: 1000,
    });
    await relay.pollOnce();

    // 5 milestones within 1 min
    await projector.projectMilestone({ colonyId: 'co_deb_pg_1', stage: 2, change: 'Stage S2' });
    await projector.projectMilestone({ colonyId: 'co_deb_pg_1', terraformBp: 2000, change: 'Terraform 20 %' });
    await projector.projectMilestone({ colonyId: 'co_deb_pg_1', stage: 4, change: 'Stage S4' });
    await projector.projectMilestone({ colonyId: 'co_deb_pg_1', tradeVolume: 500, change: 'Trade 500' });
    await projector.projectMilestone({ colonyId: 'co_deb_pg_1', terraformBp: 6000, truces: 2, change: 'Terraform 60 %' });

    const beforeFlush = await db.prisma.chainOutbox.findMany({
      where: { opId: { startsWith: 'deed-meta:co_deb_pg_1:' } },
    });
    expect(beforeFlush).toHaveLength(0);

    await debounce.advanceClockMs(DEED_DEBOUNCE_WINDOW_MS);
    const afterFlush = await db.prisma.chainOutbox.findMany({
      where: { opId: { startsWith: 'deed-meta:co_deb_pg_1:' } },
    });
    expect(afterFlush).toHaveLength(1);
    expect(afterFlush[0]?.opId).toBe('deed-meta:co_deb_pg_1:2');

    await relay.pollOnce();

    const record = await repo.findByColonyId('co_deb_pg_1');
    expect(record?.metadataVersion).toBe(2);
    expect(record?.chainState).toBe('ACTIVE');
    expect(record?.lastUpdateTx).toMatch(MOCK_HASH_RE);
    expect(record?.metadata.stage).toBe(4);
    expect(record?.metadata.terraformBp).toBe(6000);
    expect(record?.metadata.tradeVolume).toBe(500);
    expect(record?.metadata.truces).toBe(2);
    expect(record?.history).toHaveLength(2);

    const onChain = await deedAdapter.get('deed:co_deb_pg_1');
    expect(onChain?.version).toBe(2);
    expect(onChain?.metadata.terraformBp).toBe(6000);

    debounce.onModuleDestroy();
    projector.onModuleDestroy();
    minter.onModuleDestroy();
  });
});
