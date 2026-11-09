import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DEFAULT_RELAY_CONFIG, OutboxRelay } from '../../src/near/application/outbox/outbox-relay.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
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

function createPgHarness(taWaves = '..20', failRate = 0) {
  const env = { NODE_ENV: 'development', DATABASE_URL: db.url, TA_WAVES: taWaves };
  const flags = new FlagsService(env as never);
  const repo = new DeedRepository(env as never, db.prisma);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const outboxRepo = new ChainOutboxRepository(db.prisma);
  const deedAdapter = new MockDeedNftAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate, seed: 11 },
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
  const service = new DeedMintOutboxService(
    flags,
    repo,
    bus,
    outboxRepo,
    listeners,
    env as never,
    db.prisma,
  );
  service.onModuleInit();
  return { repo, bus, outboxRepo, deedAdapter, relay, service };
}

describe('W20-05 DeedMintOutboxService on Postgres', () => {
  it('founds a colony -> writes chain.deed PENDING, relays DeedNft.mint, and transitions to ACTIVE with mock: txHash', async () => {
    const { repo, bus, relay, deedAdapter, service } = createPgHarness('..20');
    bus.emit('planet.event', {
      planetId: 'pl_w01_landfall',
      tick: 5,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['co_mint_pg_1'],
      data: { colonyId: 'co_mint_pg_1', playerId: 'pl_pg_1' },
    });

    await new Promise((r) => setTimeout(r, 40));
    const beforeRelay = await repo.findByColonyId('co_mint_pg_1');
    expect(beforeRelay).not.toBeNull();
    expect(beforeRelay!.chainState).toBe('PENDING');

    const claimed = await relay.pollOnce();
    expect(claimed).toBeGreaterThanOrEqual(1);

    const afterRelay = await repo.findByColonyId('co_mint_pg_1');
    expect(afterRelay?.chainState).toBe('ACTIVE');
    expect(afterRelay?.lastUpdateTx).toMatch(MOCK_HASH_RE);
    expect(afterRelay?.history).toHaveLength(1);
    expect(afterRelay?.history[0]?.txHash).toBe(afterRelay?.lastUpdateTx);

    const onChainOwner = await deedAdapter.ownerOf({ collection: 'deed', tokenId: 'deed:co_mint_pg_1' });
    expect(onChainOwner).toBe(afterRelay?.accountId);
    service.onModuleDestroy();
  });

  it('survives crash mid-mint and restart -> still exactly one deed and one NFT', async () => {
    const first = createPgHarness('..20');
    const enq = await first.service.mintForColony({
      colonyId: 'co_crash_1',
      planetId: 'pl_w01',
      playerId: 'pl_crash_1',
      stage: 1,
      terraformBp: 1000,
    });
    expect(enq).not.toBeNull();

    // Simulate the outbox calling DeedNft.mint on chain, then the process crashing before chain.deed is updated
    const mintedOnChain = await first.deedAdapter.mint({
      opId: 'deed-mint:co_crash_1',
      collection: 'deed',
      tokenId: 'deed:co_crash_1',
      ownerAccountId: enq!.accountId,
      metadata: enq!.record.metadata,
    });
    first.service.onModuleDestroy();

    // Restart app: relay claims the outbox row and replays the same opId against the idempotent adapter
    const second = createPgHarness('..20');
    await second.service.mintForColony({
      colonyId: 'co_crash_1',
      planetId: 'pl_w01',
      playerId: 'pl_crash_1',
    });
    await second.relay.pollOnce();
    await second.service.reconcilePendingMints();

    const deedsInDb = await db.prisma.deed.findMany({ where: { colonyId: 'co_crash_1' } });
    expect(deedsInDb).toHaveLength(1);
    expect(deedsInDb[0]?.chainState).toBe('ACTIVE');
    expect(deedsInDb[0]?.lastUpdateTx).toBe(mintedOnChain.receipt.txHash);

    const nftsInDb = await db.prisma.mockChainNft.findMany({
      where: { collection: 'deed', tokenId: 'deed:co_crash_1' },
    });
    expect(nftsInDb).toHaveLength(1);
    second.service.onModuleDestroy();
  });

  it('creates no chain.deed row and no outbox job when TA_WAVES=..19', async () => {
    const { bus, service } = createPgHarness('..19');
    bus.emit('planet.event', {
      planetId: 'pl_w01',
      tick: 1,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['co_flag_off'],
      data: { colonyId: 'co_flag_off', playerId: 'pl_flag_off' },
    });
    await new Promise((r) => setTimeout(r, 30));
    const deedRow = await db.prisma.deed.findUnique({ where: { colonyId: 'co_flag_off' } });
    const outboxRow = await db.prisma.chainOutbox.findUnique({ where: { opId: 'deed-mint:co_flag_off' } });
    expect(deedRow).toBeNull();
    expect(outboxRow).toBeNull();
    service.onModuleDestroy();
  });
});
