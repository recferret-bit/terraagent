import { afterEach, describe, expect, it } from 'vitest';
import { buildStakerPerksFromYocto } from '../../src/near/staking/staker-perks';
import { releasePerksClock, resetPerksDeps, setPerksDeps, stakingNowMs } from '../../src/near/staking/perks/perks-deps';

const YOCTO = 10n ** 24n;
const DAY = 86_400_000;
const perksAt = () => buildStakerPerksFromYocto(50n * YOCTO, { w28: true, stakedSinceMs: 0, lastStakedAtMs: 0 });

afterEach(() => resetPerksDeps());

describe('W28 one staking clock (PerksDeps.clock)', () => {
  it('defaults to wall time (positive)', () => {
    const before = Date.now();
    expect(stakingNowMs()).toBeGreaterThanOrEqual(before);
  });

  it('a swapped clock moves the 24h fee warmup for every caller that passes no nowMs (corner: exact boundary)', () => {
    setPerksDeps({ clock: () => DAY - 1 });
    expect(perksAt().platformFeeBp).toBe(65);
    setPerksDeps({ clock: () => DAY });
    expect(perksAt().platformFeeBp).toBe(50);
  });

  it('an explicit nowMs still wins over the clock, and reset restores wall time (negative)', () => {
    setPerksDeps({ clock: () => 10 * DAY });
    expect(buildStakerPerksFromYocto(50n * YOCTO, { w28: true, stakedSinceMs: 0, lastStakedAtMs: 0, nowMs: 1 }).platformFeeBp).toBe(65);
    resetPerksDeps();
    expect(Math.abs(stakingNowMs() - Date.now())).toBeLessThan(1_000);
  });

  it('releasePerksClock restores wall time only when the released clock is still installed (corner)', () => {
    const mine = () => 5 * DAY;
    const theirs = () => 9 * DAY;
    setPerksDeps({ clock: mine });
    setPerksDeps({ clock: theirs });
    releasePerksClock(mine); // a later app installed its own clock: untouched
    expect(stakingNowMs()).toBe(9 * DAY);
    releasePerksClock(theirs);
    expect(Math.abs(stakingNowMs() - Date.now())).toBeLessThan(1_000);
  });
});
