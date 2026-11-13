import { DEFAULT_ESCROW_SLASH_PROTOCOL_BP } from '../../application/ports/escrow.port.js';
import {
  MIN_PERK_STAKE_NEAR,
  nearToYocto,
  PROTOCOL_YIELD_SHARE_BP,
  STAKER_NET_YIELD_SHARE_BP,
} from '../../staking/yocto.js';

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface ProtocolFeeSchedule {
  readonly standardPlatformFeeBp: number;
  readonly stakerPlatformFeeBp: number;
  readonly daoCarveOutShareBp: number;
  readonly protocolFeeShareBp: number;
  readonly protocolNetStandardBp: number;
  readonly protocolNetStakerBp: number;
  readonly validatorGrossApyBp: number;
  readonly stakerNetApyBp: number;
  readonly protocolStakingYieldBp: number;
  readonly protocolStakingYieldShareBp: number;
  readonly minStakeForPerksNear: string;
  readonly minStakeForPerksYocto: bigint;
  readonly escrowSlashVictimShareBp: number;
  readonly escrowSlashProtocolShareBp: number;
}

function parseOptionalBp(raw: string | undefined, min: number, max: number): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const val = Number(trimmed);
  if (!Number.isSafeInteger(val) || val < min || val > max) return undefined;
  return val;
}

function parseMinStakeNear(raw: string | undefined): { near: string; yocto: bigint } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    const def = String(MIN_PERK_STAKE_NEAR);
    return { near: def, yocto: BigInt(nearToYocto(def)) };
  }
  try {
    const yocto = BigInt(nearToYocto(trimmed));
    if (yocto > 0n) return { near: trimmed, yocto };
  } catch {
    // Fall back to default threshold on malformed env string
  }
  const def = String(MIN_PERK_STAKE_NEAR);
  return { near: def, yocto: BigInt(nearToYocto(def)) };
}

/**
 * Resolves the active `TerraAgent Protocol` fee, staking perk, and escrow slash schedule
 * from environment overrides (`NEAR_PLATFORM_FEE_BP`, `NEAR_STAKER_PLATFORM_FEE_BP`,
 * `NEAR_DAO_FEE_SHARE_BP`, `NEAR_STAKER_MIN_NEAR`, `NEAR_ESCROW_SLASH_PROTOCOL_BP`),
 * falling back to D-44 defaults (`100 bp` / `50 bp`, `20%` DAO / `80%` Protocol, `10 NEAR`, `10%` slash).
 */
export function resolveProtocolFeeSchedule(
  env: EnvMap = process.env,
  defaults: {
    readonly basePlatformFeeBp?: number;
    readonly baseDaoShareBp?: number;
    readonly validatorGrossApyBp?: number;
  } = {},
): ProtocolFeeSchedule {
  const standardPlatformFeeBp =
    parseOptionalBp(env.NEAR_PLATFORM_FEE_BP, 0, 1_000) ?? defaults.basePlatformFeeBp ?? 100;
  const stakerPlatformFeeBp =
    parseOptionalBp(env.NEAR_STAKER_PLATFORM_FEE_BP, 0, standardPlatformFeeBp) ??
    Math.floor(standardPlatformFeeBp / 2);
  const daoCarveOutShareBp =
    parseOptionalBp(env.NEAR_DAO_FEE_SHARE_BP, 0, 10_000) ?? defaults.baseDaoShareBp ?? 2_000;
  const protocolFeeShareBp = 10_000 - daoCarveOutShareBp;
  const protocolNetStandardBp = Math.floor((standardPlatformFeeBp * protocolFeeShareBp) / 10_000);
  const protocolNetStakerBp = Math.floor((stakerPlatformFeeBp * protocolFeeShareBp) / 10_000);

  const validatorGrossApyBp = defaults.validatorGrossApyBp ?? 900;
  const stakerNetApyBp = Math.floor((validatorGrossApyBp * STAKER_NET_YIELD_SHARE_BP) / 10_000);
  const protocolStakingYieldBp = validatorGrossApyBp - stakerNetApyBp;

  const minStake = parseMinStakeNear(env.NEAR_STAKER_MIN_NEAR);
  const escrowSlashProtocolShareBp =
    parseOptionalBp(env.NEAR_ESCROW_SLASH_PROTOCOL_BP, 0, 10_000) ?? DEFAULT_ESCROW_SLASH_PROTOCOL_BP;

  return {
    standardPlatformFeeBp,
    stakerPlatformFeeBp,
    daoCarveOutShareBp,
    protocolFeeShareBp,
    protocolNetStandardBp,
    protocolNetStakerBp,
    validatorGrossApyBp,
    stakerNetApyBp,
    protocolStakingYieldBp,
    protocolStakingYieldShareBp: PROTOCOL_YIELD_SHARE_BP,
    minStakeForPerksNear: minStake.near,
    minStakeForPerksYocto: minStake.yocto,
    escrowSlashVictimShareBp: 10_000 - escrowSlashProtocolShareBp,
    escrowSlashProtocolShareBp,
  };
}
