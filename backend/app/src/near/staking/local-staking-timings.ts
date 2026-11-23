import { STAKING_RULES } from '@terra/contracts';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { UNBONDING_DURATION_MS } from './yocto.js';

type EnvBag = Readonly<Record<string, string | undefined>>;

export interface StakingTimingRules {
  readonly fast: boolean;
  readonly feeWarmupMs: number;
  readonly unbondingMs: number;
  readonly earlyExitWindowMs: number;
  readonly rewardMultiplier: number;
}

/**
 * True in local dev mode (`NODE_ENV=development`, `NEAR_MODE=local`, or `TA_LOCAL_STAKING_TIMINGS=1`) when `Staking`
 * runs on the mock adapter outside production. Explicit `TA_LOCAL_STAKING_TIMINGS=0|false` opts back into 24h/2d/7d.
 */
export function isLocalStakingFastTimings(env: EnvBag = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (nearAdapterFor('Staking', env) !== 'mock') return false;
  const flag = env.TA_LOCAL_STAKING_TIMINGS?.trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  const nearMode = env.NEAR_MODE?.trim().toLowerCase();
  return nearMode === 'local' || env.NODE_ENV === 'development';
}

export function resolveStakingTimings(env: EnvBag = process.env): StakingTimingRules {
  if (!isLocalStakingFastTimings(env)) {
    return {
      fast: false,
      feeWarmupMs: STAKING_RULES.feeWarmupMs,
      unbondingMs: UNBONDING_DURATION_MS,
      earlyExitWindowMs: STAKING_RULES.earlyExitWindowMs,
      rewardMultiplier: 1,
    };
  }
  return {
    fast: true,
    feeWarmupMs: STAKING_RULES.localFeeWarmupMs,
    unbondingMs: STAKING_RULES.localUnbondingMs,
    earlyExitWindowMs: STAKING_RULES.localEarlyExitWindowMs,
    rewardMultiplier: STAKING_RULES.localRewardMultiplier,
  };
}
