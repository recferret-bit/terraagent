import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { ChainOutboxRepository, ClaimedRow } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DEED_DEBOUNCE_WINDOW_MS, DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

async function setupDebounceHarness(taWaves = '..20') {
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
  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();

  await minter.mintForColony({
    colonyId: 'col_0',
    planetId: 'pl_1',
    playerId: 'p_1',
    stage: 1,
    terraformBp: 1000,
  });
  await listeners.emitDone(
    { opId: 'deed-mint:col_0', port: 'DeedNft', method: 'mint', payload: { colonyId: 'col_0' }, attempts: 1 },
    { tokenId: 'deed:col_0' },
    'mock:tx_mint_1',
  );
  enqueued.length = 0;

  return { flags, repo, bus, listeners, enqueued, minter, projector, debounce };
}

describe('DeedDebounceService 10-minute coalescing (W20-07 unit)', () => {
  it('triggers 5 milestones in 1 min -> sends 0 updates before 10 min and exactly 1 update after 10 min carrying latest values', async () => {
    const { repo, bus, listeners, enqueued, projector, debounce } = await setupDebounceHarness('..20');
    const updatedEvents: unknown[] = [];
    bus.on(
      'planet.event',
      (ev) => {
        if (ev.kind === 'deedUpdated') updatedEvents.push(ev);
      },
      { module: 'test' },
    );

    // 5 milestones within 1 minute (12 seconds apart)
    await projector.projectMilestone({ colonyId: 'col_0', stage: 2, change: 'Reached Stage S2' });
    await debounce.advanceClockMs(12_000);
    await projector.projectMilestone({ colonyId: 'col_0', terraformBp: 2000, change: 'Terraform 20 %' });
    await debounce.advanceClockMs(12_000);
    await projector.projectMilestone({ colonyId: 'col_0', stage: 3, change: 'Reached Stage S3' });
    await debounce.advanceClockMs(12_000);
    await projector.projectMilestone({ colonyId: 'col_0', tradeVolume: 300, change: 'Trade volume 300' });
    await debounce.advanceClockMs(12_000);
    await projector.projectMilestone({ colonyId: 'col_0', terraformBp: 4000, truces: 1, change: 'Terraform 40 %' });
    await debounce.advanceClockMs(12_000);

    // 60 seconds elapsed (< 10 min) -> 0 updates enqueued so far
    expect(enqueued).toHaveLength(0);

    // Advance remaining 9 minutes to reach the 10-minute debounce boundary
    const flushed = await debounce.advanceClockMs(DEED_DEBOUNCE_WINDOW_MS - 60_000);
    expect(flushed).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.opId).toBe('deed-meta:col_0:2');
    expect(enqueued[0]?.method).toBe('updateMetadata');

    const sentMeta = enqueued[0]?.payload.metadata as Record<string, unknown>;
    expect(sentMeta.version).toBe(2);
    expect(sentMeta.stage).toBe(3);
    expect(sentMeta.terraformBp).toBe(4000);
    expect(sentMeta.tradeVolume).toBe(300);
    expect(sentMeta.truces).toBe(1);

    const row: ClaimedRow = {
      opId: 'deed-meta:col_0:2',
      port: 'DeedNft',
      method: 'updateMetadata',
      payload: enqueued[0]!.payload,
      attempts: 1,
    };
    await listeners.emitDone(row, { tokenId: 'deed:col_0' }, 'mock:tx_meta_2');

    const updatedRec = await repo.findByColonyId('col_0');
    expect(updatedRec?.metadataVersion).toBe(2);
    expect(updatedRec?.lastUpdateTx).toBe('mock:tx_meta_2');
    expect(updatedRec?.history).toHaveLength(2);
    expect(updatedEvents).toHaveLength(1);
  });

  it('bypasses debounce immediately when forceImmediate is true', async () => {
    const { enqueued, projector } = await setupDebounceHarness('..20');
    await projector.projectMilestone({
      colonyId: 'col_0',
      status: 'eliminated',
      change: 'Colony eliminated',
      forceImmediate: true,
    });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.opId).toBe('deed-final:col_0:2');
  });
});
