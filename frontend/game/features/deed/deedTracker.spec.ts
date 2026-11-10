import { describe, expect, it } from 'vitest';
import { createDeedTracker, DEED_EVENTS, DeedTracker } from './deedTracker';

describe('W20-26 Frontend DeedTracker analytics events (unit)', () => {
  it('tracks all 7 W20 analytics events with colonyId and planetId', () => {
    expect(DEED_EVENTS).toEqual([
      'deed_viewed',
      'deed_shared',
      'stake_started',
      'stake_completed',
      'stake_cancelled',
      'unstake_started',
      'withdraw_completed',
    ]);

    const forwarded: Array<{ name: string; props: Record<string, unknown> }> = [];
    const tracker = createDeedTracker((name, props) => {
      forwarded.push({ name, props: props ?? {} });
    });
    expect(tracker).toBeInstanceOf(DeedTracker);

    const base = {
      colonyId: 'col_0',
      planetId: 'planet_a',
      pool: 'astro-stakers.poolv1.near',
      amount: '10',
    };
    tracker.deedViewed({
      colonyId: 'col_0',
      planetId: 'planet_a',
      tokenId: 'deed-col_0',
      settled: false,
    });
    tracker.deedShared({
      colonyId: 'col_0',
      planetId: 'planet_a',
      tokenId: 'deed-col_0',
      channel: 'x',
    });
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
    for (const ev of forwarded) {
      expect(ev.props).toMatchObject({ colonyId: 'col_0', planetId: 'planet_a' });
    }
  });
});
