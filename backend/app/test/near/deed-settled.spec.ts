import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedImageRendererService } from '../../src/near/deed/deed-image.renderer.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

async function setupSettledHarness(taWaves = '..20') {
  const flags = new FlagsService({ TA_WAVES: taWaves } as never);
  const repo = new DeedRepository({ NODE_ENV: 'test' } as never);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const enqueued: Array<{ opId: string; port: string; method: string; payload: Record<string, unknown> }> = [];
  const outbox = {
    enqueue: vi.fn(async (row: { opId: string; port: string; method: string; payload: Record<string, unknown> }) => {
      enqueued.push(row);
    }),
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

  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  settled.onModuleInit();

  await minter.mintForColony({
    colonyId: 'col_0',
    planetId: 'pl_1',
    playerId: 'p_settler_1',
    stage: 4,
    terraformBp: 4000,
  });
  await listeners.emitDone(
    { id: 1n, opId: 'deed-mint:col_0', port: 'DeedNft', method: 'mint', payload: { colonyId: 'col_0' }, attempts: 1 },
    { tokenId: 'deed:col_0' },
    'mock:tx_mint_1',
  );
  enqueued.length = 0;

  return { repo, bus, listeners, enqueued, projector, imageRenderer, settled };
}

describe('DeedSettledService transition hook (W20-15 unit)', () => {
  it('settleColonyDeed bypasses debounce with opId deed-settle:{colonyId}, re-renders gold card, and emits deedSettled + progression.fact', async () => {
    const { bus, listeners, enqueued, imageRenderer, settled } = await setupSettledHarness('..20');
    const settledEvents: unknown[] = [];
    const facts: unknown[] = [];
    bus.on(
      'planet.event',
      (ev) => {
        if (ev.kind === 'deedSettled') settledEvents.push(ev);
      },
      { module: 'test' },
    );
    bus.on('progression.fact', (ev) => facts.push(ev), { module: 'test' });

    const beforeImg = await imageRenderer.renderForToken('deed:col_0');
    expect(beforeImg.svg).toContain('ACTIVE DEED');

    const view = await settled.settleColonyDeed({ colonyId: 'col_0' });
    expect(view.settled).toBe(true);
    expect(view.status).toBe('settled');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.opId).toBe('deed-settle:col_0');

    await listeners.emitDone(
      {
        id: 2n,
        opId: 'deed-settle:col_0',
        port: 'DeedNft',
        method: 'updateMetadata',
        payload: enqueued[0]!.payload,
        attempts: 1,
      },
      { tokenId: 'deed:col_0' },
      'mock:tx_settle_2',
    );

    const afterImg = await imageRenderer.renderForToken('deed:col_0');
    expect(afterImg.svg).toContain('SETTLED DEED');
    expect(settledEvents).toHaveLength(1);
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect((facts[0] as { family: string }).family).toBe('settler');

    // Calling settleColonyDeed again is idempotent
    const second = await settled.settleColonyDeed({ colonyId: 'col_0' });
    expect(second.settled).toBe(true);
    expect(enqueued).toHaveLength(1);
  });

  it('auto-settles when a colony reaches Stage 4 + 100% Living Planet and rejects eliminated deeds', async () => {
    const { repo, enqueued, projector } = await setupSettledHarness('..20');

    await projector.projectMilestone({
      colonyId: 'col_0',
      stage: 4,
      terraformBp: 10_000,
      change: 'Terraform 100 %',
    });

    await vi.waitFor(async () => {
      const rec = await repo.findByColonyId('col_0');
      expect(rec?.settled).toBe(true);
      expect(rec?.status).toBe('settled');
    });
    expect(enqueued.some((e) => e.opId === 'deed-settle:col_0')).toBe(true);

    // Eliminated deed cannot be settled
    const { repo: repo2, settled: settled2 } = await setupSettledHarness('..20');
    const r2 = await repo2.findByColonyId('col_0');
    r2!.status = 'eliminated';
    await expect(settled2.settleColonyDeed({ colonyId: 'col_0' })).rejects.toMatchObject({
      errorCode: 'DEED_NOT_SETTLED',
      status: 409,
    });
  });
});
