import type { DbClient, PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import { resolveProtocolFeeSchedule } from '../infrastructure/network/protocol-fee.config.js';
import {
  nearToYocto,
  PROTOCOL_STAKING_ACCOUNT_ID,
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
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): EvaluatedStakerPerks {
  const sched = resolveProtocolFeeSchedule(opts.env ?? process.env, {
    basePlatformFeeBp: opts.standardPlatformFeeBp,
    validatorGrossApyBp: opts.grossApyBp,
  });
  const grossApyBp = sched.validatorGrossApyBp;
  const netApyBp = sched.stakerNetApyBp;
  const standardPlatformFeeBp = sched.standardPlatformFeeBp;
  const active = totalStakedYocto >= sched.minStakeForPerksYocto;
  return {
    active,
    minStakeNear: sched.minStakeForPerksNear,
    totalStakedNear: yoctoToNear(totalStakedYocto, 6),
    totalStakedYocto,
    grossApyBp,
    netApyBp,
    protocolYieldShareBp: sched.protocolStakingYieldShareBp,
    platformFeeBp: active ? sched.stakerPlatformFeeBp : standardPlatformFeeBp,
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
    readonly env?: Readonly<Record<string, string | undefined>>;
  },
): Promise<EvaluatedStakerPerks> {
  const standardPlatformFeeBp = query.standardPlatformFeeBp;
  if (!db) return buildStakerPerksFromYocto(0n, { standardPlatformFeeBp, env: query.env });

  const colonyId = query.colonyId?.trim() || undefined;
  const accountSet = new Set<string>();
  if (query.accountId?.trim()) accountSet.add(query.accountId.trim());

  if (typeof db.nearColonyAccount?.findMany === 'function' && (colonyId || accountSet.size > 0)) {
    const acctOr: Array<{ colonyId?: string; accountId?: string; ownerAccountId?: string; claimedByAccountId?: string }> = [];
    if (colonyId) acctOr.push({ colonyId });
    for (const acct of accountSet) {
      acctOr.push({ accountId: acct }, { ownerAccountId: acct }, { claimedByAccountId: acct });
    }
    const linked = await db.nearColonyAccount.findMany({
      where: { OR: acctOr },
      select: { accountId: true, ownerAccountId: true, claimedByAccountId: true },
    });
    for (const row of linked) {
      accountSet.add(row.accountId);
      if (row.ownerAccountId) accountSet.add(row.ownerAccountId);
      if (row.claimedByAccountId) accountSet.add(row.claimedByAccountId);
    }
  }

  const accountIds = Array.from(accountSet);
  const orPreds: Array<{ colonyId?: string; accountId?: { in: string[] } }> = [];
  if (colonyId) orPreds.push({ colonyId });
  if (accountIds.length > 0) orPreds.push({ accountId: { in: accountIds } });
  if (orPreds.length === 0) return buildStakerPerksFromYocto(0n, { standardPlatformFeeBp, env: query.env });

  const posRows =
    typeof db.stakingPosition?.findMany === 'function'
      ? await db.stakingPosition.findMany({
          where: { OR: orPreds },
          select: { stakedSnapshot: true },
        })
      : [];
  let totalYocto = 0n;
  for (const row of posRows) {
    totalYocto += BigInt(row.stakedSnapshot.toFixed(0));
  }

  if (
    totalYocto === 0n &&
    accountIds.length > 0 &&
    typeof db.mockChainStaking?.findMany === 'function'
  ) {
    const mockRows = await db.mockChainStaking.findMany({
      where: { accountId: { in: accountIds } },
      select: { staked: true },
    });
    for (const row of mockRows) {
      totalYocto += BigInt(row.staked.toFixed(0));
    }
  }

  return buildStakerPerksFromYocto(totalYocto, { standardPlatformFeeBp, env: query.env });
}

/** Batch-resolves which colony indices on `planetId` have `>= minStakeNear` staked for Managed `NEAR.AI` Autopilot. */
export async function resolvePlanetStakedColonies(
  prisma: PrismaClient | undefined,
  env: AppEnv | undefined,
  stateColonies: ReadonlyArray<{ readonly index: number; readonly id?: string } | undefined>,
): Promise<Record<number, boolean>> {
  if (!prisma || !databaseEnabled(env) || typeof prisma.stakingPosition?.findMany !== 'function') {
    return {};
  }
  const ids = stateColonies
    .filter((c): c is { readonly index: number; readonly id: string } => Boolean(c?.id))
    .map((c) => c.id);
  if (ids.length === 0) return {};

  const envBag = (env ?? process.env) as Record<string, string | undefined>;
  const minYocto = resolveProtocolFeeSchedule(envBag).minStakeForPerksYocto;

  const accountByColony = new Map<string, string[]>();
  if (typeof prisma.nearColonyAccount?.findMany === 'function') {
    const colRows = await prisma.nearColonyAccount.findMany({
      where: { colonyId: { in: ids } },
      select: { colonyId: true, accountId: true, ownerAccountId: true, claimedByAccountId: true },
    });
    for (const row of colRows) {
      if (!row.colonyId) continue;
      const list = accountByColony.get(row.colonyId) ?? [];
      list.push(row.accountId);
      if (row.ownerAccountId) list.push(row.ownerAccountId);
      if (row.claimedByAccountId) list.push(row.claimedByAccountId);
      accountByColony.set(row.colonyId, list);
    }
  }
  const allAccounts = Array.from(new Set(Array.from(accountByColony.values()).flat()));

  const posWhere =
    allAccounts.length > 0
      ? { OR: [{ colonyId: { in: ids } }, { accountId: { in: allAccounts } }] }
      : { colonyId: { in: ids } };
  const rows = await prisma.stakingPosition.findMany({
    where: posWhere,
    select: { colonyId: true, accountId: true, stakedSnapshot: true },
  });

  const byColony = new Map<string, bigint>();
  const byAccount = new Map<string, bigint>();
  const accountsInPositions = new Set<string>();
  for (const r of rows) {
    const amt = BigInt(r.stakedSnapshot.toFixed(0));
    byColony.set(r.colonyId, (byColony.get(r.colonyId) ?? 0n) + amt);
    byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0n) + amt);
    accountsInPositions.add(r.accountId);
  }

  if (allAccounts.length > 0 && typeof prisma.mockChainStaking?.findMany === 'function') {
    const mockRows = await prisma.mockChainStaking.findMany({
      where: { accountId: { in: allAccounts } },
      select: { accountId: true, staked: true },
    });
    for (const r of mockRows) {
      if (!accountsInPositions.has(r.accountId)) {
        byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0n) + BigInt(r.staked.toFixed(0)));
      }
    }
  }

  const out: Record<number, boolean> = {};
  for (const col of stateColonies) {
    if (!col?.id) continue;
    let total = byColony.get(col.id) ?? 0n;
    if (total < minYocto) {
      for (const acct of accountByColony.get(col.id) ?? []) {
        const acctStake = byAccount.get(acct) ?? 0n;
        if (acctStake > total) total = acctStake;
      }
    }
    if (total >= minYocto) out[col.index] = true;
  }
  return out;
}
