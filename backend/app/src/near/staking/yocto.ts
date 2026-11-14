export const ONE_NEAR_YOCTO = 10n ** 24n;
export const NEAR_TOKEN_ID = 'NEAR';
export const PROTOCOL_STAKING_ACCOUNT_ID = 'protocol.terraagent.mock';
export const CLAIM_ACCOUNT_PATH = '/v1/near/claim-account';
export const GAME_DAY_MS = 86_400_000;
export const UNBONDING_GAME_DAYS = 2;
export const UNBONDING_DURATION_MS = UNBONDING_GAME_DAYS * GAME_DAY_MS;

/** 20% of validator yield goes to TerraAgent Protocol (`1.80%` APY on `9.00%` validator APY); 80% (`7.20%` net APY) goes to the staker. */
export const PROTOCOL_YIELD_SHARE_BP = 2_000;
export const STAKER_NET_YIELD_SHARE_BP = 8_000;
export const MIN_PERK_STAKE_NEAR = 10;
export const MIN_PERK_STAKE_YOCTO = BigInt(MIN_PERK_STAKE_NEAR) * ONE_NEAR_YOCTO;

export function computeAccruedRewardDelta(
  staked: bigint,
  apyBp: number,
  elapsedMs: number,
): bigint {
  if (staked <= 0n || apyBp <= 0 || elapsedMs <= 0) return 0n;
  const num = staked * BigInt(apyBp) * BigInt(Math.floor(elapsedMs));
  const den = 10_000n * 365n * BigInt(GAME_DAY_MS);
  return num / den;
}

export function computeSplitRewardDelta(
  staked: bigint,
  apyBp: number,
  elapsedMs: number,
  protocolYieldShareBp: number = PROTOCOL_YIELD_SHARE_BP,
): { readonly gross: bigint; readonly userReward: bigint; readonly protocolYield: bigint } {
  const gross = computeAccruedRewardDelta(staked, apyBp, elapsedMs);
  const clampedShareBp = Math.min(Math.max(Math.trunc(protocolYieldShareBp), 0), 10_000);
  const protocolYield = (gross * BigInt(clampedShareBp)) / 10_000n;
  return {
    gross,
    userReward: gross - protocolYield,
    protocolYield,
  };
}

export const stakeOpId = (colonyId: string, pool: string, nonce: string | number): string =>
  `stake:${colonyId}:${pool}:${String(nonce)}`;

export const unstakeOpId = (colonyId: string, pool: string, nonce: string | number): string =>
  `unstake:${colonyId}:${pool}:${String(nonce)}`;

export const withdrawOpId = (colonyId: string, pool: string, nonce: string | number): string =>
  `withdraw:${colonyId}:${pool}:${String(nonce)}`;

/** Converts a decimal NEAR string or number into a yoctoNEAR integer string. */
export function nearToYocto(nearAmount: string | number): string {
  const str = String(nearAmount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid NEAR amount "${str}"`);
  }
  const [wholePart = '0', fracPart = ''] = str.split('.');
  if (fracPart.length === 0 && wholePart.length >= 19) {
    return BigInt(wholePart).toString();
  }
  const paddedFrac = (fracPart + '0'.repeat(24)).slice(0, 24);
  return (BigInt(wholePart) * ONE_NEAR_YOCTO + BigInt(paddedFrac)).toString();
}

/** Formats a yoctoNEAR integer string or bigint into a decimal NEAR string (up to `maxFracDigits` decimals). */
export function yoctoToNear(yoctoAmount: string | bigint, maxFracDigits = 6): string {
  const val = typeof yoctoAmount === 'bigint' ? yoctoAmount : BigInt(yoctoAmount || '0');
  if (val <= 0n) return '0';
  const whole = val / ONE_NEAR_YOCTO;
  const rem = val % ONE_NEAR_YOCTO;
  if (rem === 0n || maxFracDigits <= 0) return whole.toString();
  const fracFull = rem.toString().padStart(24, '0').slice(0, maxFracDigits).replace(/0+$/, '');
  return fracFull.length > 0 ? `${whole.toString()}.${fracFull}` : whole.toString();
}
