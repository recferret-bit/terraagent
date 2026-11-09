import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DEED_CARD_HEIGHT, DEED_CARD_WIDTH, DeedImageRendererService } from '../../src/near/deed/deed-image.renderer.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import { NearDeedController, PublicDeedController } from '../../src/near/deed/deed.controller.js';

async function setupDeedApiHarness(taWaves = '..20') {
  const flags = new FlagsService({ TA_WAVES: taWaves } as never);
  const repo = new DeedRepository({ NODE_ENV: 'test' } as never);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const outbox = {
    enqueue: vi.fn(async () => undefined),
    find: vi.fn(async () => undefined),
  } as unknown as ChainOutboxRepository;

  const minter = new DeedMintOutboxService(
    flags,
    repo,
    bus,
    outbox,
    listeners,
    { NODE_ENV: 'test' } as never,
  );
  const projector = new DeedProjectorService(
    flags,
    repo,
    bus,
    undefined,
    { NODE_ENV: 'test' } as never,
  );
  const debounce = new DeedDebounceService(
    flags,
    repo,
    projector,
    minter,
    bus,
    outbox,
    listeners,
    undefined,
    { NODE_ENV: 'test' } as never,
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
  );
  const publicController = new PublicDeedController(flags, repo, imageRenderer);

  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  settled.onModuleInit();

  await minter.mintForColony({
    colonyId: 'col_0',
    planetId: 'pl_dune_1',
    playerId: 'secret_player_id_123',
    colonyName: 'Aegis Spire',
    planetType: 'dune',
    stage: 4,
    terraformBp: 4000,
  });
  await listeners.emitDone(
    { opId: 'deed-mint:col_0', port: 'DeedNft', method: 'mint', payload: { colonyId: 'col_0' }, attempts: 1 },
    { tokenId: 'deed:col_0' },
    'mock:tx_deed_api_1',
  );

  return { nearController, publicController };
}

describe('NearDeedController & PublicDeedController (W20-09 unit)', () => {
  it('returns own colonies deeds with history on GET /v1/near/deed and public read-only fields on GET /v1/deeds/:tokenId', async () => {
    const { nearController, publicController } = await setupDeedApiHarness('..20');
    const req = { headers: { authorization: 'Bearer dev:secret_player_id_123:Pilot' } } as unknown as IncomingMessage;

    const own = await nearController.getOwnDeeds(req);
    expect(own.deed).not.toBeNull();
    expect(own.deed?.tokenId).toBe('deed:col_0');
    expect(own.deed?.metadata.colonyName).toBe('Aegis Spire');
    expect(own.deed?.history).toHaveLength(1);
    expect(own.deed?.txHash).toBe('mock:tx_deed_api_1');

    // Public endpoint requires no auth and omits playerId / pendingState / secrets
    const pub = await publicController.getPublicDeed('deed:col_0');
    expect(pub.tokenId).toBe('deed:col_0');
    expect(pub.metadata.terraformBp).toBe(4000);
    expect('playerId' in pub).toBe(false);
    expect('pendingState' in pub).toBe(false);
    expect('lastError' in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('secret_player_id_123');
  });

  it('serves 1200x630 PNG from cache on second request (< 20 ms) and settles deed on POST /v1/near/deed/settle', async () => {
    const { nearController, publicController } = await setupDeedApiHarness('..20');
    const headers1: Record<string, string> = {};
    const res1 = { header: (k: string, v: string) => (headers1[k] = v) };
    const png1 = (await nearController.getDeedImage('deed:col_0', res1)) as Buffer;
    expect(Buffer.isBuffer(png1)).toBe(true);
    expect(png1.readUInt32BE(16)).toBe(DEED_CARD_WIDTH);
    expect(png1.readUInt32BE(20)).toBe(DEED_CARD_HEIGHT);
    expect(headers1['x-deed-cache']).toBe('MISS');

    const headers2: Record<string, string> = {};
    const res2 = { header: (k: string, v: string) => (headers2[k] = v) };
    const t0 = performance.now();
    const png2 = (await publicController.getPublicDeedImage('deed:col_0', res2)) as Buffer;
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(20);
    expect(headers2['x-deed-cache']).toBe('HIT');
    expect(png2.equals(png1)).toBe(true);

    const settledRes = await nearController.settleDeed({ colonyId: 'col_0' });
    expect(settledRes.deed.settled).toBe(true);
    expect(settledRes.deed.status).toBe('settled');
  });

  it('returns 404 DEED_NOT_FOUND for unknown token and 404 NOT_FOUND when W20 is disabled', async () => {
    const { publicController } = await setupDeedApiHarness('..20');
    await expect(publicController.getPublicDeed('deed:missing')).rejects.toMatchObject({
      errorCode: 'DEED_NOT_FOUND',
      status: 404,
    });

    const off = await setupDeedApiHarness('..19');
    await expect(off.publicController.getPublicDeed('deed:col_0')).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
  });
});
