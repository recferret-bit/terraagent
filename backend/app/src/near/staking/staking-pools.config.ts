import { z } from 'zod';
import { AccountId } from '../domain/types.js';
import type { StakingPoolView } from '../application/ports/staking.port.js';

export const DEFAULT_STAKING_POOLS_RAW =
  'astro-stakers.pool.mock:Astro Stakers:900,chorus-one.pool.mock:Chorus One:900,kiln.pool.mock:Kiln Validator:900';

export const DEFAULT_TESTNET_STAKING_POOLS_RAW =
  'astro-stakers.pool.testnet:Astro Stakers:900,chorus-one.pool.testnet:Chorus One:900,kiln.pool.testnet:Kiln Validator:900';

export const DEFAULT_MAINNET_STAKING_POOLS_RAW =
  'astro-stakers.poolv1.near:Astro Stakers:900,chorus-one.poolv1.near:Chorus One:900,kiln.poolv1.near:Kiln Validator:900';

export const DEFAULT_STAKING_APY_BP = 900;

function humanizePoolName(poolId: string): string {
  const stem = poolId.split('.')[0] ?? poolId;
  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseSinglePoolEntry(entry: string): StakingPoolView {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error('empty staking pool entry in NEAR_STAKING_POOLS');
  }
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.length > 3) {
    throw new Error(`invalid staking pool entry "${trimmed}" (expected poolId[:name[:apyBp]])`);
  }
  const [rawPoolId, rawName, rawApy] = parts;
  if (!rawPoolId || !rawPoolId.includes('.')) {
    throw new Error(`invalid staking pool account id "${rawPoolId ?? ''}"`);
  }
  const parsedAccount = AccountId.safeParse(rawPoolId);
  if (!parsedAccount.success) {
    throw new Error(`invalid staking pool account id "${rawPoolId}"`);
  }
  const name = rawName && rawName.length > 0 ? rawName : humanizePoolName(rawPoolId);
  if (name.length > 80) {
    throw new Error(`staking pool name "${name}" exceeds 80 chars`);
  }
  let apyBp = DEFAULT_STAKING_APY_BP;
  if (rawApy !== undefined && rawApy !== '') {
    if (!/^\d+$/.test(rawApy)) {
      throw new Error(`invalid staking pool apyBp "${rawApy}" for "${rawPoolId}"`);
    }
    apyBp = Number(rawApy);
    if (!Number.isInteger(apyBp) || apyBp <= 0 || apyBp > 100_000) {
      throw new Error(`staking pool apyBp out of range (1..100000): ${rawApy}`);
    }
  }
  return { poolId: parsedAccount.data, name, apyBp };
}

/**
 * Parses and validates `NEAR_STAKING_POOLS` (W20-17 / NEAR §9).
 * When unset (`undefined`), returns the default 3 mock validator pools at 9 % APY (900 bp).
 * Throws a descriptive Error when explicitly set to an empty or malformed string.
 */
export function parseStakingPoolsConfig(
  raw: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly StakingPoolView[] {
  const stakingMode = env.NEAR_ADAPTER_STAKING ?? env.NEAR_MODE;
  const fallback =
    stakingMode === 'mainnet'
      ? DEFAULT_MAINNET_STAKING_POOLS_RAW
      : stakingMode === 'testnet' || stakingMode === 'devnet'
        ? DEFAULT_TESTNET_STAKING_POOLS_RAW
        : DEFAULT_STAKING_POOLS_RAW;
  const source = raw === undefined ? fallback : raw;
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('NEAR_STAKING_POOLS must not be empty when set');
  }

  const entries = trimmed.split(',');
  const pools: StakingPoolView[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const pool = parseSinglePoolEntry(entry);
    if (seen.has(pool.poolId)) {
      throw new Error(`duplicate staking pool "${pool.poolId}" in NEAR_STAKING_POOLS`);
    }
    seen.add(pool.poolId);
    pools.push(pool);
  }

  return pools;
}

/** Zod schema for `NEAR_STAKING_POOLS` in `nearEnv` (fails at boot on malformed pool list). */
export const NearStakingPoolsEnvSchema = z
  .string()
  .optional()
  .superRefine((val, ctx) => {
    if (val === undefined) return;
    try {
      parseStakingPoolsConfig(val);
    } catch (err) {
      ctx.addIssue({
        code: 'custom',
        message: err instanceof Error ? err.message : 'Invalid NEAR_STAKING_POOLS',
      });
    }
  });
