import type { DbClient, PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import { EMPTY_AI_USAGE } from './perks/ai-usage.reader.js';
import { isW28Enabled, resolvePerkLadder } from './perks/legacy-ladder.js';
import { resolveWalletPerks, type PerksQuery } from './perks/perks.resolver.js';
import { evaluatePerks, type EvaluatedPerks } from './perks/tier-engine.js';
import { nearToYocto, PROTOCOL_STAKING_ACCOUNT_ID } from './yocto.js';
import { stakingNowMs } from './perks/perks-deps.js';

/** The W28 perks object (`EvaluatedStakerPerksV2`) plus the exact stake; V1 fields keep their meaning. */
export type EvaluatedStakerPerks = EvaluatedPerks;

/**
 * Pure perks for a known ACTIVE stake. `stakedSinceMs` is the continuous-stake start (24h fee warmup for Tier 2-4;
 * omitted = unknown, so those fees stay at the Tier 1 rate), `lastStakedAtMs` the last deposit (early-exit fee).
 * With `W28` off (`w28: false` or `TA_WAVES=..27`) this is the W20 ladder.
 */
export function buildStakerPerksFromYocto(
  totalStakedYocto: bigint,
  opts: {
    readonly grossApyBp?: number;
    readonly standardPlatformFeeBp?: number;
    readonly protocolAccountId?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly w28?: boolean;
    readonly nowMs?: number;
    readonly stakedSinceMs?: number | null;
    readonly lastStakedAtMs?: number | null;
    readonly unbondingYocto?: bigint;
  } = {},
): EvaluatedStakerPerks {
  const ladder = resolvePerkLadder({
    w28: isW28Enabled(opts.env, opts.w28),
    env: opts.env,
    standardPlatformFeeBp: opts.standardPlatformFeeBp,
    grossApyBp: opts.grossApyBp,
  });
  return evaluatePerks({
    ladder,
    activeStakedYocto: totalStakedYocto,
    unbondingYocto: opts.unbondingYocto ?? 0n,
    stakedSinceMs: opts.stakedSinceMs ?? null,
    lastStakedAtMs: opts.lastStakedAtMs ?? null,
    nowMs: opts.nowMs ?? stakingNowMs(),
    protocolAccountId: opts.protocolAccountId ?? PROTOCOL_STAKING_ACCOUNT_ID,
    nearUsd: 0,
    dailyProtocolTradeFeeUsd: 0,
    usage: EMPTY_AI_USAGE,
    leadPatronPlanetIds: [],
  });
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
 * Resolves the wallet's perks (ACTIVE stake only, never unbonding/withdrawable) for a colony or account from
 * `chain.staking_position` (falling back to `chain.mock_chain_staking`). All colonies of one wallet share one result.
 * Read-model helper for Backend Market & AI Autopilot layers; never imported by `@terra/sim`.
 */
export async function resolveDbStakerPerks(
  db: DbClient | null | undefined,
  query: PerksQuery,
): Promise<EvaluatedStakerPerks> {
  return (await resolveWalletPerks(db, query)).perks;
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
  const minYocto = resolvePerkLadder({ w28: isW28Enabled(envBag), env: envBag }).minStakeYocto;

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
