import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedLifecycleService } from '../../src/near/deed/deed-lifecycle.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

async function setupLifecycleHarness(taWaves = '..20') {
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
  const lifecycle = new DeedLifecycleService(flags, repo, projector, debounce, bus);

  minter.onModuleInit();
  projector.onModuleInit();
  debounce.onModuleInit();
  lifecycle.onModuleInit();

  await minter.mintForColony({
    colonyId: 'col_0',
    planetId: 'pl_1',
    playerId: 'p_1',
    stage: 3,
    terraformBp: 4000,
  });
  await listeners.emitDone(
    { opId: 'deed-mint:col_0', port: 'DeedNft', method: 'mint', payload: { colonyId: 'col_0' }, attempts: 1 },
    { tokenId: 'deed:col_0' },
    'mock:tx_mint_1',
  );
  enqueued.length = 0;

  return { repo, bus, listeners, enqueued, projector, lifecycle };
}

describe('DeedLifecycleService terminal status transitions (W20-14 unit)', () => {
  it('forces status eliminated immediately past debounce on colonyEliminated and ignores subsequent milestones', async () => {
    const { repo, listeners, enqueued, projector, lifecycle } = await setupLifecycleHarness('..20');

    // Stage a normal milestone in the 10-min debounce queue
    await projector.projectMilestone({
      colonyId: 'col_0',
      terraformBp: 5000,
      change: 'Terraform 50 %',
    });
    expect(enqueued).toHaveLength(0);

    // Eliminate colony -> forces immediate update with coalesced terraformBp + status 'eliminated'
    const meta = await lifecycle.handleEvent({
      planetId: 'pl_1',
      kind: 'colonyEliminated',
      colonyIds: ['col_0'],
      data: { colonyId: 'col_0' },
    });
    expect(meta?.status).toBe('eliminated');
    expect(meta?.terraformBp).toBe(5000);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.opId).toBe('deed-final:col_0:2');

    await listeners.emitDone(
      {
        opId: 'deed-final:col_0:2',
        port: 'DeedNft',
        method: 'updateMetadata',
        payload: enqueued[0]!.payload,
        attempts: 1,
      },
      { tokenId: 'deed:col_0' },
      'mock:tx_final_2',
    );

    const record = await repo.findByColonyId('col_0');
    expect(record?.status).toBe('eliminated');
    const view = await repo.toDeedView(record!);
    expect(view.status).toBe('eliminated');
    expect(view.pendingState).toBe('FINAL');

    // Subsequent milestones after elimination are ignored
    const afterElim = await projector.projectMilestone({
      colonyId: 'col_0',
      stage: 4,
      change: 'Stage S4',
    });
    expect(afterElim).toBeNull();
  });

  it('marks status abandoned on departure without settlement and never overwrites a settled deed', async () => {
    const { repo, enqueued, lifecycle } = await setupLifecycleHarness('..20');
    const meta = await lifecycle.handleEvent({
      planetId: 'pl_1',
      kind: 'colonyAbandoned',
      colonyIds: ['col_0'],
      data: { colonyId: 'col_0', settled: false },
    });
    expect(meta?.status).toBe('abandoned');
    expect(enqueued).toHaveLength(1);

    // Simulate settled deed -> markTerminalStatus refuses to overwrite settled
    const rec = await repo.findByColonyId('col_0');
    rec!.settled = true;
    rec!.status = 'settled';
    const refused = await lifecycle.markTerminalStatus({
      colonyId: 'col_0',
      status: 'eliminated',
    });
    expect(refused).toBeNull();
  });
});
