import 'reflect-metadata';
import { STAKING_RULES } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { isLocalStakingFastTimings, resolveStakingTimings } from '../../src/near/staking/local-staking-timings.js';
import { resolvePerkLadder } from '../../src/near/staking/perks/legacy-ladder.js';
import { evaluatePerks } from '../../src/near/staking/perks/tier-engine.js';
import { EMPTY_AI_USAGE } from '../../src/near/staking/perks/ai-usage.reader.js';
import { ONE_NEAR_YOCTO, UNBONDING_DURATION_MS } from '../../src/near/staking/yocto.js';

describe('local staking 1-minute timings (NODE_ENV=development / NEAR_MODE=local / TA_LOCAL_STAKING_TIMINGS)', () => {
  it('enables 1-minute warmup, unbonding, early-exit & accelerated yield in NODE_ENV=development, NEAR_MODE=local, or TA_LOCAL_STAKING_TIMINGS=1', () => {
    for (const env of [
      { NEAR_MODE: 'local' },
      { NEAR_MODE: 'mock', NODE_ENV: 'development' },
      { NEAR_MODE: 'mock', TA_LOCAL_STAKING_TIMINGS: '1' },
    ]) {
      expect(isLocalStakingFastTimings(env)).toBe(true);
      expect(resolveStakingTimings(env)).toEqual({
        fast: true,
        feeWarmupMs: 60_000,
        unbondingMs: 60_000,
        earlyExitWindowMs: 60_000,
        rewardMultiplier: 10_080,
      });
    }
  });

  it('stays fail-closed on standard 24h/2d/7d timings in mock tests, explicit 0 override, testnet, mainnet, and production', () => {
    for (const env of [
      {},
      { NEAR_MODE: 'mock' },
      { NEAR_MODE: 'mock', NODE_ENV: 'test' },
      { NEAR_MODE: 'mock', NODE_ENV: 'development', TA_LOCAL_STAKING_TIMINGS: '0' },
      { NEAR_MODE: 'local', TA_LOCAL_STAKING_TIMINGS: '0' },
      { NEAR_MODE: 'testnet', NODE_ENV: 'development', TA_LOCAL_STAKING_TIMINGS: '1' },
      { NEAR_MODE: 'mainnet', NODE_ENV: 'development', TA_LOCAL_STAKING_TIMINGS: '1' },
      { NEAR_MODE: 'local', NODE_ENV: 'production', TA_LOCAL_STAKING_TIMINGS: '1' },
    ]) {
      expect(isLocalStakingFastTimings(env)).toBe(false);
      expect(resolveStakingTimings(env)).toEqual({
        fast: false,
        feeWarmupMs: STAKING_RULES.feeWarmupMs,
        unbondingMs: UNBONDING_DURATION_MS,
        earlyExitWindowMs: STAKING_RULES.earlyExitWindowMs,
        rewardMultiplier: 1,
      });
    }
  });

  it('matures Tier 2+ fee warmup and early-exit window after 60 seconds in NEAR_MODE=local', () => {
    const ladder = resolvePerkLadder({ w28: true, env: { NEAR_MODE: 'local' } });
    const t0 = 1_000_000;
    const base = {
      ladder,
      activeStakedYocto: 50n * ONE_NEAR_YOCTO,
      unbondingYocto: 0n,
      stakedSinceMs: t0,
      lastStakedAtMs: t0,
      protocolAccountId: 'protocol.terraagent.mock',
      nearUsd: 4,
      dailyProtocolTradeFeeUsd: 0,
      usage: EMPTY_AI_USAGE,
      leadPatronPlanetIds: [],
    };

    const at30s = evaluatePerks({ ...base, nowMs: t0 + 30_000 });
    expect(at30s.tier).toBe(2);
    expect(at30s.platformFeeBp).toBe(65);
    expect(at30s.feeWarmupReadyAtMs).toBe(t0 + 60_000);
    expect(at30s.earlyExitFeeBp).toBe(25);
    expect(at30s.earlyExitFreeAtMs).toBe(t0 + 60_000);

    const at60s = evaluatePerks({ ...base, nowMs: t0 + 60_000 });
    expect(at60s.platformFeeBp).toBe(50);
    expect(at60s.feeWarmupReadyAtMs).toBeNull();
    expect(at60s.earlyExitFeeBp).toBe(0);
    expect(at60s.earlyExitFreeAtMs).toBeNull();
  });
});
