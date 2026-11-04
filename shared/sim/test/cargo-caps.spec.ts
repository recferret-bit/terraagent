import { describe, expect, it } from 'vitest';
import type { ColonyState } from '../src/kernel/state';
import {
  CARGO_THROUGHPUT_WINDOW_S,
  CARGO_THROUGHPUT_WINDOW_TICKS,
  DEFAULT_CARGO_MINT_CAP_PER_DAY,
  TRADE_HUB_THROUGHPUT_PER_MIN,
  UTC_DAY_MS,
  checkCargoMintCaps,
  computeCargoUtcDay,
  computeSecondsUntilUtcMidnight,
  ensureColonyCargoCapState,
  getMintedToday,
  getRollingThroughputUsed,
  getTradeHubTierThroughputPerMin,
  recordCargoMint,
  resetColonyCargoCaps,
  resolveDailyCargoMintCap,
} from '../src/systems/cargo/caps';

function makeColony(index = 0): ColonyState {
  return {
    index,
    id: `col_${index}`,
    name: `Colony ${index}`,
    color: 0xff6600,
    status: 'active',
    changedAt: 0,
  };
}

describe('W10-06 cargo mint caps — rolling 60 s throughput window', () => {
  it('enforces the rolling 60 s (300 ticks) window for a T1 Trade Hub (250/min) and expires after 300 ticks', () => {
    const colony = makeColony(0);
    const capState = ensureColonyCargoCapState(colony, 0);
    const t1Throughput = getTradeHubTierThroughputPerMin(1);
    expect(t1Throughput).toBe(250);
    expect(CARGO_THROUGHPUT_WINDOW_S).toBe(60);
    expect(CARGO_THROUGHPUT_WINDOW_TICKS).toBe(300);

    // Tick 10: export 200 metals.t1 -> succeeds
    expect(
      checkCargoMintCaps({
        capState,
        amount: 200,
        resource: 'metals.t1',
        currentTick: 10,
        onlineThroughputPerMin: t1Throughput,
      }),
    ).toEqual({ ok: true });
    recordCargoMint(capState, 200, 'metals.t1', 10, 0);
    expect(getRollingThroughputUsed(capState, 10)).toBe(200);

    // Tick 10: exporting 100 more exceeds 250/min -> rejected with mint_cap and retryInS = 60
    expect(
      checkCargoMintCaps({
        capState,
        amount: 100,
        resource: 'metals.t1',
        currentTick: 10,
        onlineThroughputPerMin: t1Throughput,
      }),
    ).toEqual({
      ok: false,
      code: 'mint_cap',
      reason: 'throughput',
      retryInS: 60,
      detail: 'Throughput cap reached (200/250/min). Retry in 60s.',
    });

    // Tick 140 (26s later, 34s remaining): retryInS is 34s
    expect(
      checkCargoMintCaps({
        capState,
        amount: 100,
        resource: 'metals.t1',
        currentTick: 140,
        onlineThroughputPerMin: t1Throughput,
      }),
    ).toEqual({
      ok: false,
      code: 'mint_cap',
      reason: 'throughput',
      retryInS: 34,
      detail: 'Throughput cap reached (200/250/min). Retry in 34s.',
    });

    // Tick 309 (one tick before window expiry): still used = 200, retryInS = 1s
    expect(
      checkCargoMintCaps({
        capState,
        amount: 100,
        resource: 'metals.t1',
        currentTick: 309,
        onlineThroughputPerMin: t1Throughput,
      }),
    ).toEqual({
      ok: false,
      code: 'mint_cap',
      reason: 'throughput',
      retryInS: 1,
      detail: 'Throughput cap reached (200/250/min). Retry in 1s.',
    });

    // Tick 310 (10 + 300 ticks = 60s later): window entry expires and exporting 100 succeeds
    expect(getRollingThroughputUsed(capState, 310)).toBe(0);
    expect(
      checkCargoMintCaps({
        capState,
        amount: 100,
        resource: 'metals.t1',
        currentTick: 310,
        onlineThroughputPerMin: t1Throughput,
      }),
    ).toEqual({ ok: true });
  });
});

describe('W10-06 cargo mint caps — multi-entry window expiry & multi-hub sum', () => {
  it('computes retryInS from the earliest tick at which enough oldest entries expire', () => {
    const colony = makeColony(0);
    const capState = ensureColonyCargoCapState(colony, 0);

    recordCargoMint(capState, 100, 'metals.t1', 0, 0);
    recordCargoMint(capState, 100, 'metals.t1', 50, 0);
    recordCargoMint(capState, 50, 'metals.t1', 100, 0);
    expect(getRollingThroughputUsed(capState, 100)).toBe(250);

    // Requesting 80 only needs the first 100-unit entry (tick 0 -> expires tick 300) to expire
    expect(
      checkCargoMintCaps({
        capState,
        amount: 80,
        resource: 'metals.t1',
        currentTick: 100,
        onlineThroughputPerMin: 250,
      }),
    ).toEqual({
      ok: false,
      code: 'mint_cap',
      reason: 'throughput',
      retryInS: 40,
      detail: 'Throughput cap reached (250/250/min). Retry in 40s.',
    });

    // Requesting 150 needs the first two entries (tick 0 and tick 50 -> expires tick 350) to expire
    expect(
      checkCargoMintCaps({
        capState,
        amount: 150,
        resource: 'metals.t1',
        currentTick: 100,
        onlineThroughputPerMin: 250,
      }),
    ).toEqual({
      ok: false,
      code: 'mint_cap',
      reason: 'throughput',
      retryInS: 50,
      detail: 'Throughput cap reached (250/250/min). Retry in 50s.',
    });
  });

  it('supports multi-hub online throughput sum (T1 250 + T2 900 = 1150/min, T3 = 3500/min)', () => {
    const colony = makeColony(1);
    const capState = ensureColonyCargoCapState(colony, 0);
    expect(TRADE_HUB_THROUGHPUT_PER_MIN).toEqual({ 1: 250, 2: 900, 3: 3500 });

    const combined = getTradeHubTierThroughputPerMin(1) + getTradeHubTierThroughputPerMin(2);
    expect(combined).toBe(1150);

    expect(
      checkCargoMintCaps({
        capState,
        amount: 1100,
        resource: 'metals.t1',
        currentTick: 20,
        onlineThroughputPerMin: combined,
      }),
    ).toEqual({ ok: true });
    recordCargoMint(capState, 1100, 'metals.t1', 20, 0);

    const over = checkCargoMintCaps({
      capState,
      amount: 100,
      resource: 'metals.t1',
      currentTick: 20,
      onlineThroughputPerMin: combined,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.code).toBe('mint_cap');
      expect(over.reason).toBe('throughput');
    }
  });
});

describe('W10-06 cargo mint caps — daily per-resource cap & reset', () => {
  it('enforces the daily per-sub-resource cap (20,000 default), isolates resources, and resets on UTC day rollover', () => {
    const colony = makeColony(2);
    const capState = ensureColonyCargoCapState(colony, 10);
    expect(DEFAULT_CARGO_MINT_CAP_PER_DAY).toBe(20_000);

    for (let i = 0; i < 8; i++) {
      const tick = i * 400;
      expect(
        checkCargoMintCaps({
          capState,
          amount: 2500,
          resource: 'metals.t1',
          currentTick: tick,
          onlineThroughputPerMin: 3500,
          currentUtcDay: 10,
          secondsUntilUtcMidnight: 1234,
        }),
      ).toEqual({ ok: true });
      recordCargoMint(capState, 2500, 'metals.t1', tick, 10);
    }

    expect(getMintedToday(capState, 'metals.t1', 10)).toBe(20_000);

    expect(
      checkCargoMintCaps({
        capState,
        amount: 1,
        resource: 'metals.t1',
        currentTick: 4000,
        onlineThroughputPerMin: 3500,
        currentUtcDay: 10,
        secondsUntilUtcMidnight: 1234,
      }),
    ).toEqual({
      ok: false,
      code: 'mint_cap',
      reason: 'daily',
      retryInS: 1234,
      detail: 'Daily export cap reached (20000/20000 metals.t1). Retry in 1234s.',
    });

    // Another sub-resource on the same UTC day is unaffected
    expect(
      checkCargoMintCaps({
        capState,
        amount: 500,
        resource: 'minerals.t1',
        currentTick: 4000,
        onlineThroughputPerMin: 3500,
        currentUtcDay: 10,
        secondsUntilUtcMidnight: 1234,
      }),
    ).toEqual({ ok: true });
    recordCargoMint(capState, 500, 'minerals.t1', 4000, 10);
    expect(getMintedToday(capState, 'minerals.t1', 10)).toBe(500);

    // Day rollover resets mintedToday
    expect(
      checkCargoMintCaps({
        capState,
        amount: 1000,
        resource: 'metals.t1',
        currentTick: 5000,
        onlineThroughputPerMin: 3500,
        currentUtcDay: 11,
      }),
    ).toEqual({ ok: true });
    expect(getMintedToday(capState, 'metals.t1', 11)).toBe(0);
    expect(getMintedToday(capState, 'minerals.t1', 11)).toBe(0);
    expect(capState.utcDay).toBe(11);
  });

  it('resetColonyCargoCaps clears both rolling window and daily counters, and helpers resolve UTC day/cap', () => {
    const colony = makeColony(3);
    const capState = ensureColonyCargoCapState(colony, 5);
    recordCargoMint(capState, 250, 'metals.t1', 100, 5);
    capState.mintedToday['metals.t1'] = 20_000;

    resetColonyCargoCaps(capState);
    expect(getRollingThroughputUsed(capState, 100)).toBe(0);
    expect(getMintedToday(capState, 'metals.t1', 5)).toBe(0);

    expect(computeCargoUtcDay({ serverTimeMs: 3 * UTC_DAY_MS + 5000 })).toBe(3);
    expect(computeCargoUtcDay({ state: { clock: { wallTimeMs: 2 * UTC_DAY_MS } } })).toBe(2);
    expect(computeSecondsUntilUtcMidnight({ serverTimeMs: UTC_DAY_MS - 42_000 })).toBe(42);

    const dataWithCap = { hash: 'test', tables: { tradeHub: { caps: { dailyMintCapPerResource: 10_000 } } } };
    expect(resolveDailyCargoMintCap(dataWithCap, capState)).toBe(10_000);
    capState.dailyCapOverride = 5_000;
    expect(resolveDailyCargoMintCap(dataWithCap, capState)).toBe(5_000);
  });
});
