import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { StakingPositionDto } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import type { JobRegistration } from '../../jobs/recurring.js';
import { StakingPort, type StakingPoolView } from '../application/ports/staking.port.js';
import { refreshNominatedPatronSeats, syncW28ExtraPositions } from './staking-position-sync-extras.js';
import { yoctoToNear } from './yocto.js';

export { yoctoToNear };

/** Periodic sync interval (5 minutes) for `chain.staking_position` read model (W20-20 / DATA_MODEL §4.4.1). */
export const STAKING_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Explicit marker: `chain.staking_position` is a read model only and is never queried by `@terra/sim`. */
export const STAKING_POSITION_READ_MODEL_ONLY = true as const;

/** Derives a fallback `colonyId` from a colony NEAR account ID (`{colony}.{pilot}.terraagent.mock`). */
export function deriveColonyIdFromAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  const dotIdx = trimmed.indexOf('.');
  return dotIdx > 0 ? trimmed.slice(0, dotIdx) : trimmed;
}

const clockFields = (row: {
  stakedSinceAt?: Date | null;
  lastStakedAt?: Date | null;
  asset?: string;
}): Pick<StakingPositionDto, 'stakedSinceMs' | 'lastStakedAtMs' | 'asset'> => ({
  stakedSinceMs: row.stakedSinceAt?.getTime() ?? null,
  lastStakedAtMs: row.lastStakedAt?.getTime() ?? null,
  ...(row.asset === 'near' || row.asset === 'stNEAR' || row.asset === 'LiNEAR' ? { asset: row.asset } : {}),
});

export interface SyncAccountOptions {
  readonly colonyId?: string;
  readonly pool?: string;
  /** W28 wallet-first: the account has no colony, so its read-model rows are keyed by the account id itself. */
  readonly wallet?: boolean;
}

/**
 * Read-model sync service for `chain.staking_position` (W20-20, DATA_MODEL §4.4.1, NEAR §9).
 *
 * Marked **read model only**: `StakingPort.position` (the chain / mock pool ledger) is the sole source of truth,
 * and `@terra/sim` never queries `chain.staking_position`. Syncs every 5 minutes and immediately after each
 * stake / unstake / withdraw operation.
 */
@Injectable()
export class StakingPositionSyncService implements OnModuleInit, OnModuleDestroy {
  readonly readModelOnly = STAKING_POSITION_READ_MODEL_ONLY;
  readonly positions = new Map<string, StakingPositionDto>();

  private readonly knownAccountColonies = new Map<string, string>();
  private job: JobRegistration | null = null;

  constructor(
    @Inject(StakingPort) private readonly staking: StakingPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(FlagsService) private readonly flags?: FlagsService,
    @Optional() @Inject(JobsService) private readonly jobs?: JobsService,
  ) {}

  /** One read-model sync per interval across the cluster (3.8); a failed pass is retried with backoff. */
  onModuleInit(): void {
    if (this.job) return;
    if (!this.isWaveEnabled() || this.env?.NODE_ENV === 'test') return;
    this.job = this.jobs?.recurring({ name: 'near.staking-position-sync', schedule: { everyMs: STAKING_SYNC_INTERVAL_MS }, run: () => this.syncAll() }) ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    const job = this.job;
    this.job = null;
    await job?.stop();
  }

  /** Clears the in-memory read-model cache (used in unit tests to verify re-sync from `StakingPort`). */
  clearCache(): void {
    this.positions.clear();
  }

  /**
   * Syncs all whitelisted pool positions for `accountId` from `StakingPort.position` and `StakingPort.rewards`.
   * Removes stale rows when staked, unbonding, withdrawable, and rewards are all 0.
   */
  async syncAccount(
    accountId: string,
    options?: SyncAccountOptions | string,
  ): Promise<StakingPositionDto | null> {
    if (!this.isWaveEnabled()) return null;
    const explicitColonyId = typeof options === 'string' ? options : options?.colonyId;
    const preferredPool = typeof options === 'object' ? options?.pool : undefined;
    const synced = await this.syncAccountPositions(accountId, explicitColonyId, typeof options === 'object' && options?.wallet === true);
    if (preferredPool) {
      return synced.find((p) => p.pool === preferredPool) ?? synced[0] ?? null;
    }
    return synced[0] ?? null;
  }

  /** Syncs and returns all active (non-zero) pool positions for `accountId`. */
  async syncAccountPositions(
    accountId: string,
    explicitColonyId?: string,
    wallet = false,
  ): Promise<StakingPositionDto[]> {
    if (!this.isWaveEnabled()) return [];
    const colonyId = await this.resolveColonyId(accountId, explicitColonyId, wallet);
    const pools = await this.staking.listPools();
    const seenPools = new Set<string>();
    const active: StakingPositionDto[] = [];

    for (const poolView of pools) {
      seenPools.add(poolView.poolId);
      const dto = await this.syncSinglePool(accountId, colonyId, poolView);
      if (dto) active.push(dto);
    }

    let canPrune = true;
    if (this.flags?.has('W28')) {
      const extraRes = await syncW28ExtraPositions({
        accountId,
        seenPools,
        defaultApyBp: pools[0]?.apyBp ?? 900,
        staking: this.staking,
        db: this.useDb(),
        envBag: (this.env ?? process.env) as Record<string, string | undefined>,
        onDiscovered: (pos, apyBp) => this.syncDiscoveredPosition(accountId, colonyId, pos, apyBp),
        onFallbackPool: (poolView) => this.syncSinglePool(accountId, colonyId, poolView),
      });
      active.push(...extraRes.active);
      canPrune = extraRes.canPrune;
    }

    const db = this.useDb();
    if (db) {
      if (canPrune) {
        await db.stakingPosition.deleteMany({
          where: active.length === 0 ? { accountId } : { accountId, poolId: { notIn: active.map((p) => p.pool) } },
        });
      }
      if (this.flags?.has('W28')) {
        await refreshNominatedPatronSeats(db, accountId).catch(() => undefined);
      }
    }

    return active;
  }

  /**
   * Syncs all candidate staking accounts discovered from `extraAccountIds`, `mock_chain_staking`,
   * `deed`, `near_colony_account`, `staking_position`, and in-memory state.
   */
  async syncAll(extraAccountIds: readonly string[] = []): Promise<StakingPositionDto[]> {
    if (!this.isWaveEnabled()) return [];
    const candidates = await this.collectCandidateAccounts(extraAccountIds);
    const results: StakingPositionDto[] = [];
    for (const accountId of candidates) {
      const synced = await this.syncAccountPositions(accountId);
      results.push(...synced);
    }
    return results;
  }

  /**
   * Reads persisted positions from `chain.staking_position` (or the in-memory fallback when DB is disabled).
   * Never queries `StakingPort` directly — strictly reads the read model.
   */
  async getReadModelPositions(accountOrColonyId?: string): Promise<StakingPositionDto[]> {
    if (!this.isWaveEnabled()) return [];
    const db = this.useDb();
    if (!db) {
      const all = Array.from(this.positions.values());
      if (!accountOrColonyId) return all;
      return all.filter(
        (p) => p.accountId === accountOrColonyId || p.colonyId === accountOrColonyId,
      );
    }

    const pools = await this.staking.listPools();
    const poolMap = new Map(pools.map((p) => [p.poolId, p]));
    const rows = await db.stakingPosition.findMany({
      where: accountOrColonyId
        ? { OR: [{ accountId: accountOrColonyId }, { colonyId: accountOrColonyId }] }
        : undefined,
      orderBy: [{ colonyId: 'asc' }, { poolId: 'asc' }],
    });

    return rows.map((row) => {
      const poolInfo = poolMap.get(row.poolId);
      return {
        ...(row.colonyId === row.accountId ? {} : { colonyId: row.colonyId }),
        accountId: row.accountId,
        pool: row.poolId,
        ...(poolInfo ? { poolName: poolInfo.name, apyBp: poolInfo.apyBp } : {}),
        ...clockFields(row),
        staked: yoctoToNear(row.stakedSnapshot.toFixed(0), 6),
        unbonding: yoctoToNear(row.unbondingSnapshot.toFixed(0), 6),
        unbondingReadyAtMs: row.unbondingReadyAt ? row.unbondingReadyAt.getTime() : null,
        withdrawable: yoctoToNear(row.withdrawableSnapshot.toFixed(0), 6),
        rewards: yoctoToNear(row.rewardsSnapshot.toFixed(0), 6),
        updatedAt: row.updatedAt.getTime(),
      };
    });
  }

  private async syncSinglePool(
    accountId: string,
    colonyId: string,
    poolView: StakingPoolView,
  ): Promise<StakingPositionDto | null> {
    const pos = await this.staking.position({ accountId, pool: poolView.poolId });
    const rew = await this.staking.rewards({ accountId, pool: poolView.poolId });
    const rewardsYocto = rew?.accrued ?? pos.rewards ?? '0';
    const isZero =
      BigInt(pos.staked || '0') <= 0n &&
      BigInt(pos.unbonding || '0') <= 0n &&
      BigInt(pos.withdrawable || '0') <= 0n &&
      BigInt(rewardsYocto || '0') <= 0n;

    const mapKey = `${accountId}:${poolView.poolId}`;
    const db = this.useDb();

    if (isZero) {
      this.positions.delete(mapKey);
      if (db) {
        await db.stakingPosition.deleteMany({
          where: {
            OR: [
              { colonyId, poolId: poolView.poolId },
              { accountId, poolId: poolView.poolId },
            ],
          },
        });
      }
      return null;
    }

    const now = new Date();
    if (db) await this.persistSyncedPosition(db, colonyId, accountId, poolView.poolId, pos, rewardsYocto, now);
    const dto = this.buildSyncedDto(colonyId, accountId, poolView, pos, rewardsYocto, now.getTime());
    this.positions.set(mapKey, dto);
    return dto;
  }

  private async syncDiscoveredPosition(
    accountId: string,
    colonyId: string,
    pos: Awaited<ReturnType<StakingPort['position']>>,
    defaultApyBp: number,
  ): Promise<StakingPositionDto | null> {
    const rewardsYocto = pos.rewards ?? '0';
    const isZero =
      BigInt(pos.staked || '0') <= 0n &&
      BigInt(pos.unbonding || '0') <= 0n &&
      BigInt(pos.withdrawable || '0') <= 0n &&
      BigInt(rewardsYocto || '0') <= 0n;
    const mapKey = `${accountId}:${pos.pool}`;
    if (isZero) {
      this.positions.delete(mapKey);
      return null;
    }
    const now = new Date();
    const db = this.useDb();
    if (db) await this.persistSyncedPosition(db, colonyId, accountId, pos.pool, pos, rewardsYocto, now);
    const poolView: StakingPoolView = { poolId: pos.pool, name: pos.pool, apyBp: defaultApyBp };
    const dto = this.buildSyncedDto(colonyId, accountId, poolView, pos, rewardsYocto, now.getTime());
    this.positions.set(mapKey, dto);
    return dto;
  }

  private async persistSyncedPosition(
    db: PrismaClient,
    colonyId: string,
    accountId: string,
    poolId: string,
    pos: Awaited<ReturnType<StakingPort['position']>>,
    rewardsYocto: string,
    now: Date,
  ): Promise<void> {
    const readyDate = pos.unbondingReadyAtMs !== null ? new Date(pos.unbondingReadyAtMs) : null;
    const clocks = {
      ...(pos.stakedSinceMs !== undefined ? { stakedSinceAt: pos.stakedSinceMs === null ? null : new Date(pos.stakedSinceMs) } : {}),
      ...(pos.lastStakedAtMs !== undefined ? { lastStakedAt: pos.lastStakedAtMs === null ? null : new Date(pos.lastStakedAtMs) } : {}),
      ...(pos.asset ? { asset: pos.asset } : {}),
    };
    const fields = {
      accountId,
      stakedSnapshot: pos.staked,
      unbondingSnapshot: pos.unbonding,
      unbondingReadyAt: readyDate,
      withdrawableSnapshot: pos.withdrawable,
      rewardsSnapshot: rewardsYocto,
      ...clocks,
      updatedAt: now,
    };
    await db.stakingPosition.upsert({
      where: { colonyId_poolId: { colonyId, poolId } },
      create: { colonyId, poolId, ...fields },
      update: fields,
    });
  }

  private buildSyncedDto(
    colonyId: string,
    accountId: string,
    poolView: StakingPoolView,
    pos: Awaited<ReturnType<StakingPort['position']>>,
    rewardsYocto: string,
    updatedAt: number,
  ): StakingPositionDto {
    return {
      ...(colonyId === accountId ? {} : { colonyId }),
      accountId,
      pool: poolView.poolId,
      poolName: poolView.name,
      apyBp: poolView.apyBp,
      staked: yoctoToNear(pos.staked, 6),
      unbonding: yoctoToNear(pos.unbonding, 6),
      unbondingReadyAtMs: pos.unbondingReadyAtMs,
      withdrawable: yoctoToNear(pos.withdrawable, 6),
      rewards: yoctoToNear(rewardsYocto, 6),
      ...(pos.stakedSinceMs !== undefined ? { stakedSinceMs: pos.stakedSinceMs } : {}),
      ...(pos.lastStakedAtMs !== undefined ? { lastStakedAtMs: pos.lastStakedAtMs } : {}),
      ...(pos.asset ? { asset: pos.asset } : {}),
      updatedAt,
    };
  }

  private async collectCandidateAccounts(extraAccountIds: readonly string[]): Promise<string[]> {
    const candidates = new Set<string>();
    for (const id of extraAccountIds) {
      if (id) candidates.add(id);
    }
    for (const id of this.knownAccountColonies.keys()) {
      candidates.add(id);
    }
    for (const key of this.positions.keys()) {
      const sep = key.indexOf(':');
      if (sep > 0) candidates.add(key.slice(0, sep));
    }
    for (const id of this.inspectInMemoryPortAccounts()) {
      candidates.add(id);
    }

    const db = this.useDb();
    if (db) {
      const [mockRows, deedRows, colAcctRows, posRows] = await Promise.all([
        db.mockChainStaking.findMany({ select: { accountId: true }, distinct: ['accountId'] }),
        db.deed.findMany({ select: { accountId: true, colonyId: true }, distinct: ['accountId'] }),
        db.nearColonyAccount.findMany({
          select: { accountId: true, colonyId: true, slot: true },
          distinct: ['accountId'],
        }),
        db.stakingPosition.findMany({
          select: { accountId: true, colonyId: true },
          distinct: ['accountId'],
        }),
      ]);

      for (const r of mockRows) candidates.add(r.accountId);
      for (const r of deedRows) {
        candidates.add(r.accountId);
        if (r.colonyId) this.knownAccountColonies.set(r.accountId, r.colonyId);
      }
      for (const r of colAcctRows) {
        if (r.colonyId) {
          candidates.add(r.accountId);
          this.knownAccountColonies.set(r.accountId, r.colonyId);
        } else if (r.slot && r.slot !== 'player') {
          candidates.add(r.accountId);
          this.knownAccountColonies.set(r.accountId, r.slot);
        }
      }
      for (const r of posRows) {
        candidates.add(r.accountId);
        if (r.colonyId) this.knownAccountColonies.set(r.accountId, r.colonyId);
      }
    }

    return Array.from(candidates);
  }

  private inspectInMemoryPortAccounts(): string[] {
    const raw = (this.staking as unknown as { positions?: unknown }).positions;
    if (!(raw instanceof Map)) return [];
    const out: string[] = [];
    for (const key of raw.keys()) {
      if (typeof key === 'string') {
        const sep = key.indexOf('::');
        if (sep > 0) out.push(key.slice(0, sep));
      }
    }
    return out;
  }

  private async resolveColonyId(accountId: string, explicitColonyId?: string, wallet = false): Promise<string> {
    if (explicitColonyId) {
      this.knownAccountColonies.set(accountId, explicitColonyId);
      return explicitColonyId;
    }
    const cached = this.knownAccountColonies.get(accountId);
    if (cached) return cached;

    const db = this.useDb();
    if (db) {
      const deed = typeof db.deed?.findFirst === 'function'
        ? await db.deed.findFirst({ where: { accountId }, select: { colonyId: true } })
        : null;
      if (deed?.colonyId) {
        this.knownAccountColonies.set(accountId, deed.colonyId);
        return deed.colonyId;
      }
      const colAcct = typeof db.nearColonyAccount?.findUnique === 'function'
        ? await db.nearColonyAccount.findUnique({
            where: { accountId },
            select: { colonyId: true, slot: true },
          })
        : null;
      const fromAcct = colAcct?.colonyId ?? (colAcct?.slot && colAcct.slot !== 'player' ? colAcct.slot : null);
      if (fromAcct) {
        this.knownAccountColonies.set(accountId, fromAcct);
        return fromAcct;
      }
      const existingPos = typeof db.stakingPosition?.findFirst === 'function'
        ? await db.stakingPosition.findFirst({
            where: { accountId },
            select: { colonyId: true },
          })
        : null;
      if (existingPos?.colonyId) {
        this.knownAccountColonies.set(accountId, existingPos.colonyId);
        return existingPos.colonyId;
      }
    }

    // W28 wallet-first: an account no colony claims is keyed by its full account id (the W20 derived id would make two
    // wallets with the same first label collide) and the DTO omits `colonyId`.
    const derived = wallet ? accountId : deriveColonyIdFromAccountId(accountId);
    this.knownAccountColonies.set(accountId, derived);
    return derived;
  }

  private isWaveEnabled(): boolean {
    return this.flags ? this.flags.has('W20') : true;
  }

  private useDb(): PrismaClient | null {
    return this.prisma && databaseEnabled(this.env) ? this.prisma : null;
  }
}
