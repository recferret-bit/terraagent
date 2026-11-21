import type { StakingPositionDto } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { StakingPoolView, StakingPort, StakingPositionView } from '../application/ports/staking.port.js';
import { NearException } from '../domain/errors.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { isMethodNotFoundRpcError, LST_CONTRACTS, resolveLstPoolView } from './lst-pools.js';
import { PatronSeatService } from './perks/patron-seat.service.js';
import { stakingNowMs } from './perks/perks-deps.js';
import { resolveWallet } from './perks/stake-clock.reader.js';

export interface SyncW28ExtrasContext {
  readonly accountId: string;
  readonly seenPools: Set<string>;
  readonly defaultApyBp: number;
  readonly staking: StakingPort;
  readonly db: PrismaClient | null;
  readonly envBag: Record<string, string | undefined>;
  readonly onDiscovered: (pos: StakingPositionView, defaultApyBp: number) => Promise<StakingPositionDto | null>;
  readonly onFallbackPool: (poolView: StakingPoolView) => Promise<StakingPositionDto | null>;
}

/**
 * Syncs non-validator / LST positions under W28:
 * - V2 contract (`accountPositions` succeeds): syncs every extra pool and allows stale-row pruning (`canPrune: true`).
 * - V1 contract (`MethodNotFound`): probes whitelisted LST pools + existing DB pools via `get_position`.
 * - Transient RPC failure: preserves existing DB rows (`canPrune: false`) instead of wiping LST positions or Patron seats.
 */
export async function syncW28ExtraPositions(ctx: SyncW28ExtrasContext): Promise<{ readonly active: StakingPositionDto[]; readonly canPrune: boolean }> {
  const active: StakingPositionDto[] = [];
  if (typeof ctx.staking.accountPositions !== 'function') return { active, canPrune: true };

  try {
    const extras = await ctx.staking.accountPositions(ctx.accountId);
    for (const pos of extras) {
      if (ctx.seenPools.has(pos.pool)) continue;
      ctx.seenPools.add(pos.pool);
      const dto = await ctx.onDiscovered(pos, ctx.defaultApyBp);
      if (dto) active.push(dto);
    }
    return { active, canPrune: true };
  } catch (err) {
    if (!isMethodNotFoundRpcError(err)) {
      return { active, canPrune: false };
    }
  }

  // Frozen V1 fallback (`get_account_positions` missing): probe known LST pools and any persisted extra pools via `position()`.
  const candidatePools = new Map<string, StakingPoolView>();
  const adapterKind = nearAdapterFor('Staking', ctx.envBag);
  if (adapterKind === 'testnet' || adapterKind === 'mainnet') {
    for (const lstId of [LST_CONTRACTS[adapterKind].stNEAR, LST_CONTRACTS[adapterKind].LiNEAR]) {
      if (ctx.seenPools.has(lstId)) continue;
      const view = resolveLstPoolView(adapterKind, lstId, ctx.defaultApyBp);
      if (view) candidatePools.set(lstId, view.pool);
    }
  }
  if (ctx.db && typeof ctx.db.stakingPosition?.findMany === 'function') {
    const existing = (await ctx.db.stakingPosition.findMany({
      where: { accountId: ctx.accountId },
      select: { poolId: true },
    })) as Array<{ poolId: string }>;
    for (const row of existing) {
      if (!ctx.seenPools.has(row.poolId) && !candidatePools.has(row.poolId)) {
        candidatePools.set(row.poolId, { poolId: row.poolId, name: row.poolId, apyBp: ctx.defaultApyBp });
      }
    }
  }

  let canPrune = true;
  for (const [poolId, poolView] of candidatePools) {
    ctx.seenPools.add(poolId);
    try {
      const dto = await ctx.onFallbackPool(poolView);
      if (dto) active.push(dto);
    } catch (err) {
      if (err instanceof NearException && err.errorCode === 'POOL_NOT_WHITELISTED') continue;
      canPrune = false;
    }
  }
  return { active, canPrune };
}

/** Re-evaluates nominated King-of-the-Hill Lead Patron seats when `syncAll()` / `syncAccountPositions()` updates stakes. */
export async function refreshNominatedPatronSeats(db: PrismaClient, accountId: string): Promise<void> {
  const seats = new PatronSeatService(db);
  if (!seats.available) return;
  const wallet = await resolveWallet(db, { accountId }).catch(() => null);
  if (!wallet || wallet.accountIds.length === 0) return;
  const noms = (await db.stakingPatronNomination.findMany({
    where: { accountId: { in: [...wallet.accountIds] } },
    select: { planetId: true },
  })) as Array<{ planetId: string }>;
  if (noms.length === 0) return;
  await seats.leadPlanetIdsFor(wallet, stakingNowMs());
}
