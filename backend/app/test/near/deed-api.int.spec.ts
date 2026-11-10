import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
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
import { NearDeedController, PublicDeedController } from '../../src/near/deed/deed.controller.js';
import { MockDeedNftAdapter } from '../../src/near/infrastructure/adapters/mock/deed.adapter.js';

let db: TestDatabase;
const sleep = async () => undefined;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function createPgDeedApiHarness() {
  const env = { NODE_ENV: 'development', DATABASE_URL: db.url, TA_WAVES: '..20' };
  const flags = new FlagsService(env as never);
  const repo = new DeedRepository(env as never, db.prisma);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const outboxRepo = new ChainOutboxRepository(db.prisma);
  const deedAdapter = new MockDeedNftAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 37 },
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
  const nearController = new NearDeedController(
    flags,
    repo,
    minter,
    debounce,
    settled,
    imageRenderer,
    undefined,
    undefined,
    { pollOnce: () => relay.pollOnce() } as never,
  );
  const publicController = new PublicDeedController(flags, repo, imageRenderer);

  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  settled.onModuleInit();
  return { relay, minter, projector, debounce, settled, nearController, publicController };
}

describe('W20-09 Deed API on Postgres', () => {
  it('returns own colonies deeds with history and public read-only deed without secrets on Postgres', async () => {
    const { relay, minter, projector, debounce, settled, nearController, publicController } =
      createPgDeedApiHarness();

    await minter.mintForColony({
      colonyId: 'co_api_pg_1',
      planetId: 'pl_api_1',
      playerId: 'secret_pg_player_99',
      colonyName: 'Solace Ridge',
      planetType: 'temperate',
      stage: 3,
      terraformBp: 3000,
    });
    await relay.pollOnce();

    const req = { headers: { authorization: 'Bearer dev:secret_pg_player_99:Pilot' } } as unknown as IncomingMessage;
    const own = await nearController.getOwnDeeds(req, 'co_api_pg_1');
    expect(own.deed?.colonyId).toBe('co_api_pg_1');
    expect(own.deed?.metadata.colonyName).toBe('Solace Ridge');
    expect(own.deed?.history).toHaveLength(1);

    const pub = await publicController.getPublicDeed('deed:co_api_pg_1');
    expect(pub.tokenId).toBe('deed:co_api_pg_1');
    expect(pub.metadata.colonyName).toBe('Solace Ridge');
    expect(JSON.stringify(pub)).not.toContain('secret_pg_player_99');

    settled.onModuleDestroy();
    debounce.onModuleDestroy();
    projector.onModuleDestroy();
    minter.onModuleDestroy();
  });
});
