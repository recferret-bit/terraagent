import { describe, expect, it } from 'vitest';
import { DeedTracker, DEED_EVENTS } from '../../../../frontend/game/features/deed/deedTracker.js';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { OutboxListeners } from '../../src/near/application/outbox/outbox-listeners.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import {
  DEED_ANALYTICS_EVENTS,
  DeedTelemetryService,
} from '../../src/near/deed/deed-telemetry.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking.js';

function createTelemetryHarness(waves = 'W05,W08,W20') {
  const flags = new FlagsService({ TA_WAVES: waves });
  const metrics = new MetricsRegistry();
  const deeds = new DeedRepository();
  const listeners = new OutboxListeners();
  const mintService = new DeedMintOutboxService(flags, deeds, undefined, undefined, listeners);
  const projector = new DeedProjectorService(flags, deeds);
  const debounce = new DeedDebounceService(flags, deeds, projector, mintService, undefined, undefined, listeners);
  const stakingPort = new InMemoryStaking();
  const positionSync = new StakingPositionSyncService(stakingPort, undefined, undefined, flags);
  const telemetry = new DeedTelemetryService(
    metrics,
    flags,
    deeds,
    debounce,
    projector,
    positionSync,
    listeners,
  );
  mintService.onModuleInit();
  debounce.onModuleInit();
  telemetry.onModuleInit();

  return {
    flags,
    metrics,
    deeds,
    listeners,
    mintService,
    projector,
    debounce,
    stakingPort,
    positionSync,
    telemetry,
  };
}

describe('DeedTelemetryService Prometheus metrics (W20-26)', () => {
  it('registers near_tx_total, deed_updates_pending, and staking_positions on MetricsRegistry', async () => {
    const h = createTelemetryHarness();

    await h.mintService.mintForColony({
      colonyId: 'col_0',
      planetId: 'planet_a',
      stage: 4,
      terraformBp: 4000,
    });
    expect(await h.telemetry.computePendingDeedUpdates()).toBe(1);

    await h.listeners.emitDone(
      {
        opId: 'deed-mint:col_0',
        port: 'DeedNft',
        method: 'mint',
        payload: { colonyId: 'col_0', planetId: 'planet_a' },
        attempts: 1,
      },
      { txHash: 'mock:1' },
      'mock:1',
    );
    expect(await h.telemetry.computePendingDeedUpdates()).toBe(0);

    await h.projector.projectMilestone({
      colonyId: 'col_0',
      planetId: 'planet_a',
      terraformBp: 5000,
      change: 'Terraform 50 %',
    });
    expect(await h.telemetry.computePendingDeedUpdates()).toBe(1);

    await h.debounce.flushColony('col_0', { forceImmediate: true });
    await h.listeners.emitDone(
      {
        opId: 'deed-final:col_0:2',
        port: 'DeedNft',
        method: 'updateMetadata',
        payload: { colonyId: 'col_0', planetId: 'planet_a', version: 2, change: 'Terraform 50 %' },
        attempts: 1,
      },
      { txHash: 'mock:2' },
      'mock:2',
    );

    h.telemetry.recordTx('stake');
    const poolId = (await h.stakingPort.listPools())[0]!.poolId;
    await h.stakingPort.creditNear('col_0.terraagent.mock', (100n * 10n ** 24n).toString());
    await h.stakingPort.stake({
      opId: 'stake:col_0:1',
      accountId: 'col_0.terraagent.mock',
      pool: poolId,
      amount: (25n * 10n ** 24n).toString(),
    });
    await h.positionSync.syncAccount('col_0.terraagent.mock', 'col_0');
    expect(await h.telemetry.computeActiveStakingPositions()).toBe(1);

    const rendered = await h.metrics.render();
    expect(rendered).toMatch(/near_tx_total\{kind="deed_mint"\} 1/);
    expect(rendered).toMatch(/near_tx_total\{kind="deed_update"\} 1/);
    expect(rendered).toMatch(/near_tx_total\{kind="stake"\} 1/);
    expect(rendered).toMatch(/deed_updates_pending 0/);
    expect(rendered).toMatch(/staking_positions 1/);
  });
});

describe('DeedTracker analytics events (W20-26)', () => {
  it('tracks all 7 W20 analytics events with colonyId and planetId', async () => {
    const h = createTelemetryHarness();
    expect(DEED_EVENTS).toEqual(DEED_ANALYTICS_EVENTS);

    const forwarded: Array<{ name: string; props: Record<string, unknown> }> = [];
    const tracker = new DeedTracker((name, props) => {
      forwarded.push({ name, props: props ?? {} });
      void h.telemetry.trackEvent(
        name as (typeof DEED_ANALYTICS_EVENTS)[number],
        (props ?? { colonyId: 'col_0', planetId: 'planet_a' }) as {
          colonyId: string;
          planetId: string;
        },
      );
    });

    const base = { colonyId: 'col_0', planetId: 'planet_a', pool: 'astro-stakers.poolv1.near', amount: '10' };
    tracker.deedViewed({ colonyId: 'col_0', planetId: 'planet_a', tokenId: 'deed-col_0', settled: false });
    tracker.deedShared({ colonyId: 'col_0', planetId: 'planet_a', tokenId: 'deed-col_0', channel: 'x' });
    tracker.stakeStarted(base);
    tracker.stakeCancelled(base);
    tracker.stakeCompleted({ ...base, txHash: 'mock:stake1' });
    tracker.unstakeStarted({ ...base, amount: '5' });
    tracker.withdrawCompleted({ ...base, amount: '5', txHash: 'mock:wd1' });

    expect(forwarded.map((e) => e.name)).toEqual([
      'deed_viewed',
      'deed_shared',
      'stake_started',
      'stake_cancelled',
      'stake_completed',
      'unstake_started',
      'withdraw_completed',
    ]);
    for (const ev of h.telemetry.recordedEvents) {
      expect(ev.props).toMatchObject({ colonyId: 'col_0', planetId: 'planet_a' });
    }
  });
});
