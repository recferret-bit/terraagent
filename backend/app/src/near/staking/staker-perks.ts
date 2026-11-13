import type { DbClient, PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import {
  MIN_PERK_STAKE_NEAR,
  MIN_PERK_STAKE_YOCTO,
  nearToYocto,
  PROTOCOL_STAKING_ACCOUNT_ID,
  PROTOCOL_YIELD_SHARE_BP,
  STAKER_NET_YIELD_SHARE_BP,
  yoctoToNear,
} from './yocto.js';

export interface EvaluatedStakerPerks {
  readonly active: boolean;
  readonly minStakeNear: string;
  readonly totalStakedNear: string;
  readonly totalStakedYocto: bigint;
  readonly grossApyBp: number;
  readonly netApyBp: number;
  readonly protocolYieldShareBp: number;
  readonly platformFeeBp: number;
  readonly standardPlatformFeeBp: number;
  readonly managedAutopilotUnlocked: boolean;
  readonly protocolAccountId: string;
}

export function buildStakerPerksFromYocto(
  totalStakedYocto: bigint,
  opts: {
    readonly grossApyBp?: number;
    readonly standardPlatformFeeBp?: number;
    readonly protocolAccountId?: string;
  } = {},
): EvaluatedStakerPerks {
  const grossApyBp = opts.grossApyBp ?? 900;
  const netApyBp = Math.floor((grossApyBp * STAKER_NET_YIELD_SHARE_BP) / 10_000);
  const standardPlatformFeeBp = opts.standardPlatformFeeBp ?? 100;
  const active = totalStakedYocto >= MIN_PERK_STAKE_YOCTO;
  return {
    active,
    minStakeNear: String(MIN_PERK_STAKE_NEAR),
    totalStakedNear: yoctoToNear(totalStakedYocto, 6),
    totalStakedYocto,
    grossApyBp,
    netApyBp,
    protocolYieldShareBp: PROTOCOL_YIELD_SHARE_BP,
    platformFeeBp: active ? Math.floor(standardPlatformFeeBp / 2) : standardPlatformFeeBp,
    standardPlatformFeeBp,
    managedAutopilotUnlocked: active,
    protocolAccountId: opts.protocolAccountId ?? PROTOCOL_STAKING_ACCOUNT_ID,
  };
}

export function sumDtoStakedYocto(positions: ReadonlyArray<{ readonly staked: string }>): bigint {
  let sum = 0n;
  for (const p of positions) {
    try {
      sum += BigInt(nearToYocto(p.staked || '0'));
    } catch {
      // Ignore malformed display amounts
    }
  }
  return sum;
}

/**
 * Resolves total active staked NEAR (excluding unbonding/withdrawable) for a colony or account
 * from `chain.staking_position` (falling back to `chain.mock_chain_staking` if read model is empty).
 * Read-model helper for Backend Market & AI Autopilot layers; never imported by `@terra/sim`.
 */
export async function resolveDbStakerPerks(
  db: DbClient | null | undefined,
  query: {
    readonly colonyId?: string | null;
    readonly accountId?: string | null;
    readonly standardPlatformFeeBp?: number;
  },
): Promise<EvaluatedStakerPerks> {
  const standardPlatformFeeBp = query.standardPlatformFeeBp ?? 100;
  if (!db) return buildStakerPerksFromYocto(0n, { standardPlatformFeeBp });

  const orPreds: Array<{ colonyId?: string; accountId?: string }> = [];
  if (query.colonyId?.trim()) orPreds.push({ colonyId: query.colonyId.trim() });
  if (query.accountId?.trim()) orPreds.push({ accountId: query.accountId.trim() });
  if (orPreds.length === 0) return buildStakerPerksFromYocto(0n, { standardPlatformFeeBp });

  const posRows = await db.stakingPosition.findMany({
    where: { OR: orPreds },
    select: { stakedSnapshot: true },
  });
  let totalYocto = 0n;
  for (const row of posRows) {
    totalYocto += BigInt(row.stakedSnapshot.toFixed(0));
  }

  if (totalYocto === 0n && query.accountId?.trim()) {
    const mockRows = await db.mockChainStaking.findMany({
      where: { accountId: query.accountId.trim() },
      select: { staked: true },
    });
    for (const row of mockRows) {
      totalYocto += BigInt(row.staked.toFixed(0));
    }
  }

  return buildStakerPerksFromYocto(totalYocto, { standardPlatformFeeBp });
}

/** Batch-resolves which colony indices on `planetId` have `>= 10 NEAR` staked for Managed `NEAR.AI` Autopilot. */
export async function resolvePlanetStakedColonies(
  prisma: PrismaClient | undefined,
  env: AppEnv | undefined,
  stateColonies: ReadonlyArray<{ readonly index: number; readonly id?: string } | undefined>,
): Promise<Record<number, boolean>> {
  if (!prisma || !databaseEnabled(env)) return {};
  const ids = stateColonies
    .filter((c): c is { readonly index: number; readonly id: string } => Boolean(c?.id))
    .map((c) => c.id);
  if (ids.length === 0) return {};

  const rows = await prisma.stakingPosition.findMany({
    where: { colonyId: { in: ids } },
    select: { colonyId: true, stakedSnapshot: true },
  });
  const byColony = new Map<string, bigint>();
  for (const r of rows) {
    byColony.set(r.colonyId, (byColony.get(r.colonyId) ?? 0n) + BigInt(r.stakedSnapshot.toFixed(0)));
  }

  const out: Record<number, boolean> = {};
  for (const col of stateColonies) {
    if (!col?.id) continue;
    if ((byColony.get(col.id) ?? 0n) >= MIN_PERK_STAKE_YOCTO) {
      out[col.index] = true;
    }
  }
  return out;
}
