import { parseWaves, STAKING_TIERS, stakingTierForYocto, type StakingTierRow } from '@terra/contracts';
import { resolveProtocolFeeSchedule } from '../../infrastructure/network/protocol-fee.config.js';
import { resolveStakingTimings } from '../local-staking-timings.js';

type EnvBag = Readonly<Record<string, string | undefined>>;

/** The tier rows one evaluation reads: the W28 table, or the W20 two-row ladder when `W28` is off. */
export interface PerkLadder {
  readonly w28: boolean;
  readonly rows: readonly StakingTierRow[];
  readonly standardPlatformFeeBp: number;
  /** Minimum active stake for any perk (Tier 1), whole NEAR as text. */
  readonly minStakeNear: string;
  readonly minStakeYocto: bigint;
  readonly grossApyBp: number;
  readonly netApyBp: number;
  readonly protocolYieldShareBp: number;
  readonly feeWarmupMs?: number;
  readonly earlyExitWindowMs?: number;
}

/** Wave gate: an explicit flag wins, else `TA_WAVES` of `env` (then of `process.env`), default `all` (W28 on). */
export function isW28Enabled(env?: EnvBag, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const spec = env?.TA_WAVES ?? process.env.TA_WAVES;
  return parseWaves(spec).has('W28');
}

/**
 * One ladder per evaluation. With `W28` off it is the W20 behaviour as data: Tier 0 pays the standard fee, Tier 1
 * (the env `NEAR_STAKER_MIN_NEAR`, default `10`) pays `NEAR_STAKER_PLATFORM_FEE_BP` (default half of standard = `50`),
 * no warmup. With `W28` on it is `STAKING_TIERS` unchanged.
 */
export function resolvePerkLadder(opts: {
  readonly w28: boolean;
  readonly env?: EnvBag;
  readonly standardPlatformFeeBp?: number;
  readonly grossApyBp?: number;
}): PerkLadder {
  const envSource = opts.env ?? process.env;
  const sched = resolveProtocolFeeSchedule(envSource, {
    basePlatformFeeBp: opts.standardPlatformFeeBp,
    validatorGrossApyBp: opts.grossApyBp,
    w28: opts.w28,
  });
  const timings = resolveStakingTimings(envSource);
  const common = {
    w28: opts.w28,
    standardPlatformFeeBp: sched.standardPlatformFeeBp,
    minStakeNear: sched.minStakeForPerksNear,
    minStakeYocto: sched.minStakeForPerksYocto,
    grossApyBp: sched.validatorGrossApyBp,
    netApyBp: sched.stakerNetApyBp,
    protocolYieldShareBp: sched.protocolStakingYieldShareBp,
    feeWarmupMs: timings.feeWarmupMs,
    earlyExitWindowMs: timings.earlyExitWindowMs,
  };
  if (opts.w28) return { ...common, rows: STAKING_TIERS };
  const cadet = STAKING_TIERS[0]!;
  const scout = STAKING_TIERS[1]!;
  return {
    ...common,
    rows: [
      { ...cadet, takerFeeBp: sched.standardPlatformFeeBp },
      { ...scout, minStakeNear: Number(sched.minStakeForPerksNear), takerFeeBp: sched.stakerPlatformFeeBp, warmupRequired: false },
    ],
  };
}

/** Highest row the ACTIVE stake reaches (`stakingTierForYocto` for W28, exact yocto compare on the legacy rows). */
export function tierForLadder(ladder: PerkLadder, activeStakedYocto: bigint): StakingTierRow {
  if (ladder.w28) return stakingTierForYocto(activeStakedYocto);
  return activeStakedYocto >= ladder.minStakeYocto && activeStakedYocto > 0n ? ladder.rows[1]! : ladder.rows[0]!;
}
