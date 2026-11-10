import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { ChainOutboxRepository, ClaimedRow } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

function createHarness(taWaves = '..20') {
  const flags = new FlagsService({ TA_WAVES: taWaves } as never);
  const repo = new DeedRepository({ NODE_ENV: 'test' } as never);
  const bus = new EventBus();
  const listeners = new OutboxListeners();
  const enqueued: Array<{ opId: string; port: string; method: string; payload: Record<string, unknown> }> = [];
  const outbox = {
    enqueue: vi.fn(async (row: { opId: string; port: string; method: string; payload: Record<string, unknown> }) => {
      if (!enqueued.some((r) => r.opId === row.opId)) enqueued.push(row);
    }),
    find: vi.fn(async () => undefined),
  } as unknown as ChainOutboxRepository;

  const service = new DeedMintOutboxService(
    flags,
    repo,
    bus,
    outbox,
    listeners,
    { NODE_ENV: 'test' } as never,
  );
  service.onModuleInit();
  return { flags, repo, bus, listeners, outbox, enqueued, service };
}

describe('DeedMintOutboxService (W20-05 unit)', () => {
  it('mints a PENDING deed and enqueues deed-mint:{colonyId} on colonyFounded, then marks ACTIVE on outbox DONE', async () => {
    const { repo, bus, listeners, enqueued, service } = createHarness('..20');
    const mintedEvents: unknown[] = [];
    const updatedPushes: unknown[] = [];
    bus.on(
      'planet.event',
      (ev) => {
        if (ev.kind === 'deedMinted') mintedEvents.push(ev);
      },
      { module: 'test' },
    );
    bus.on('near.deed.updated', (ev) => updatedPushes.push(ev), { module: 'test' });

    bus.emit('planet.event', {
      planetId: 'pl_dune_1',
      tick: 12,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['col_0'],
      data: { colonyId: 'col_0', playerId: 'pl_1' },
    });

    await vi.waitFor(async () => {
      expect(enqueued).toHaveLength(1);
    });
    expect(enqueued[0]?.opId).toBe('deed-mint:col_0');
    expect(enqueued[0]?.port).toBe('DeedNft');
    expect(enqueued[0]?.method).toBe('mint');

    const pendingRecord = await repo.findByColonyId('col_0');
    expect(pendingRecord?.chainState).toBe('PENDING');
    expect(pendingRecord?.tokenId).toBe('deed:col_0');
    const pendingView = await repo.toDeedView(pendingRecord!);
    expect(pendingView.pendingState).toBe('PENDING');

    const claimedRow: ClaimedRow = {
      id: 1n,
      opId: 'deed-mint:col_0',
      port: 'DeedNft',
      method: 'mint',
      payload: enqueued[0]!.payload,
      attempts: 1,
    };
    await listeners.emitDone(claimedRow, { tokenId: 'deed:col_0' }, 'mock:tx_deed_mint_1');

    const activeRecord = await repo.findByColonyId('col_0');
    expect(activeRecord?.chainState).toBe('ACTIVE');
    expect(activeRecord?.lastUpdateTx).toBe('mock:tx_deed_mint_1');
    expect(activeRecord?.history[0]?.txHash).toBe('mock:tx_deed_mint_1');
    expect(mintedEvents).toHaveLength(1);
    expect(updatedPushes).toHaveLength(1);

    const activeView = await repo.toDeedView(activeRecord!);
    expect(activeView.pendingState).toBe('NONE');
    expect(activeView.txHash).toBe('mock:tx_deed_mint_1');
    service.onModuleDestroy();
  });
});

describe('DeedMintOutboxService idempotency & wave gating (W20-05 unit)', () => {
  it('is idempotent on duplicate colonyFounded and tracks failed/dead outbox states', async () => {
    const { repo, listeners, enqueued, service } = createHarness('..20');
    await service.mintForColony({
      colonyId: 'col_dup',
      planetId: 'pl_1',
      playerId: 'p_1',
      stage: 2,
      terraformBp: 3000,
    });
    await service.mintForColony({
      colonyId: 'col_dup',
      planetId: 'pl_1',
      playerId: 'p_1',
      stage: 2,
      terraformBp: 3000,
    });
    expect(enqueued).toHaveLength(1);

    const claimedRow: ClaimedRow = {
      id: 2n,
      opId: 'deed-mint:col_dup',
      port: 'DeedNft',
      method: 'mint',
      payload: enqueued[0]!.payload,
      attempts: 2,
    };
    await listeners.emitFailed(claimedRow, 'NEAR_UNAVAILABLE: mock fail', false);
    const failedOnce = await repo.findByColonyId('col_dup');
    expect(failedOnce?.chainState).toBe('PENDING');
    expect(failedOnce?.lastError).toContain('NEAR_UNAVAILABLE');

    await listeners.emitFailed(claimedRow, 'NEAR_UNAVAILABLE: dead', true);
    const deadRec = await repo.findByColonyId('col_dup');
    expect(deadRec?.chainState).toBe('FAILED');
    expect((await repo.toDeedView(deadRec!)).pendingState).toBe('FAILED');
    service.onModuleDestroy();
  });

  it('does nothing when W20 flag is disabled (TA_WAVES=..19)', async () => {
    const { repo, bus, enqueued, service } = createHarness('..19');
    bus.emit('planet.event', {
      planetId: 'pl_dune_1',
      tick: 1,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['col_off'],
      data: { colonyId: 'col_off', playerId: 'pl_1' },
    });
    const res = await service.mintForColony({ colonyId: 'col_off', planetId: 'pl_dune_1' });
    expect(res).toBeNull();
    expect(enqueued).toHaveLength(0);
    expect(await repo.findByColonyId('col_off')).toBeNull();
    service.onModuleDestroy();
  });
});
