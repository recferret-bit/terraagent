import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DEFAULT_RELAY_CONFIG, OutboxRelay } from '../../src/near/application/outbox/outbox-relay.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedImageRendererService } from '../../src/near/deed/deed-image.renderer.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import { MockDeedNftAdapter } from '../../src/near/infrastructure/adapters/mock/deed.adapter.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';
import { ProgressionEngine } from '../../src/progression/progression-engine.js';

let db: TestDatabase;
const sleep = async () => undefined;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function createPgSettledHarness() {
  const env = { NODE_ENV: 'development', DATABASE_URL: db.url, TA_WAVES: '..20' };
  const flags = new FlagsService(env as never);
  const repo = new DeedRepository(env as never, db.prisma);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const outboxRepo = new ChainOutboxRepository(db.prisma);
  const deedAdapter = new MockDeedNftAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 31 },
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
  const imageRenderer = new DeedImageRendererService(repo, flags);
  const settled = new DeedSettledService(
    flags,
    repo,
    projector,
    debounce,
    minter,
    imageRenderer,
    bus,
    listeners,
  );
  const availability = new FamilyAvailabilityService(flags);
  const engine = new ProgressionEngine(db.prisma, availability, env as never);
  const factsStore = new FactsStore(db.prisma, env as never);
  const factsUpdater = new FactsUpdaterService(factsStore, bus, undefined, engine);

  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  settled.onModuleInit();
  factsUpdater.onModuleInit();
  return { repo, deedAdapter, relay, minter, projector, debounce, settled, factsUpdater };
}

describe('W20-15 DeedSettledService & W12 settler progression on Postgres', () => {
  it('settles deed via outbox, updates MockDeedNftAdapter, and unlocks W12 Star Settler achievement in Postgres', async () => {
    const h = createPgSettledHarness();
    await db.prisma.player.upsert({
      where: { id: 'pl_settler_pg_1' },
      create: { id: 'pl_settler_pg_1', handle: 'settler-pg' },
      update: {},
    });

    await h.minter.mintForColony({
      colonyId: 'co_settle_pg_1',
      planetId: 'pl_settle_1',
      playerId: 'pl_settler_pg_1',
      stage: 4,
      terraformBp: 8000,
    });
    await h.relay.pollOnce();

    const settledView = await h.settled.settleColonyDeed({ colonyId: 'co_settle_pg_1' });
    expect(settledView.settled).toBe(true);
    expect(settledView.status).toBe('settled');

    await h.relay.pollOnce();

    const onChain = await h.deedAdapter.get('deed:co_settle_pg_1');
    expect(onChain?.settled).toBe(true);
    expect(onChain?.metadata.status).toBe('settled');

    const fact = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pl_settler_pg_1', family: 'settler' } },
    });
    expect(fact?.value).toBe(1);

    const unlock = await db.prisma.achievementUnlock.findUnique({
      where: {
        playerId_achievementId: { playerId: 'pl_settler_pg_1', achievementId: 'settler' },
      },
    });
    expect(unlock).not.toBeNull();

    // Replay is idempotent: settling again does not double-count settler
    await h.settled.settleColonyDeed({ colonyId: 'co_settle_pg_1' });
    const factAfterReplay = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pl_settler_pg_1', family: 'settler' } },
    });
    expect(factAfterReplay?.value).toBe(1);

    h.factsUpdater.onModuleDestroy();
    h.settled.onModuleDestroy();
    h.debounce.onModuleDestroy();
    h.projector.onModuleDestroy();
    h.minter.onModuleDestroy();
  });
});
