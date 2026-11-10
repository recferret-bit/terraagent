import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DEFAULT_RELAY_CONFIG, OutboxRelay } from '../../src/near/application/outbox/outbox-relay.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedLifecycleService } from '../../src/near/deed/deed-lifecycle.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import { MockDeedNftAdapter } from '../../src/near/infrastructure/adapters/mock/deed.adapter.js';

let db: TestDatabase;
const sleep = async () => undefined;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function createPgLifecycleHarness() {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: '..20' };
  const flags = new FlagsService(env as never);
  const repo = new DeedRepository({ ...env, NODE_ENV: 'development' } as never, db.prisma);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const outboxRepo = new ChainOutboxRepository(db.prisma);
  const deedAdapter = new MockDeedNftAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 23 },
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
  const lifecycle = new DeedLifecycleService(flags, repo, projector, debounce, bus);

  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  lifecycle.onModuleInit();
  return { repo, deedAdapter, relay, minter, projector, debounce, lifecycle };
}

describe('W20-14 DeedLifecycleService on Postgres', () => {
  it('eliminating a colony forces status eliminated past debounce within one outbox cycle', async () => {
    const { repo, deedAdapter, relay, minter, projector, debounce, lifecycle } =
      createPgLifecycleHarness();

    await minter.mintForColony({
      colonyId: 'co_elim_pg_1',
      planetId: 'pl_elim_1',
      playerId: 'p_elim_1',
      stage: 3,
      terraformBp: 3000,
    });
    await relay.pollOnce();

    await lifecycle.markTerminalStatus({
      colonyId: 'co_elim_pg_1',
      planetId: 'pl_elim_1',
      status: 'eliminated',
    });

    // Without advancing the 10-min debounce clock, one outbox poll relays the forced final update
    const claimed = await relay.pollOnce();
    expect(claimed).toBe(1);

    const record = await repo.findByColonyId('co_elim_pg_1');
    expect(record?.status).toBe('eliminated');
    expect(record?.metadata.status).toBe('eliminated');
    expect(record?.chainState).toBe('ACTIVE');

    const onChain = await deedAdapter.get('deed:co_elim_pg_1');
    expect(onChain?.version).toBe(2);
    expect(onChain?.metadata.status).toBe('eliminated');

    lifecycle.onModuleDestroy();
    debounce.onModuleDestroy();
    projector.onModuleDestroy();
    minter.onModuleDestroy();
  });
});
