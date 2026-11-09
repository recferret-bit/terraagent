import {
  Inject,
  Injectable,
  Logger,
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
import { StakingPort, type StakingPoolView } from '../application/ports/staking.port.js';

/** Periodic sync interval (5 minutes) for `chain.staking_position` read model (W20-20 / DATA_MODEL §4.4.1). */
export const STAKING_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Explicit marker: `chain.staking_position` is a read model only and is never queried by `@terra/sim`. */
export const STAKING_POSITION_READ_MODEL_ONLY = true as const;

const ONE_NEAR_YOCTO = 10n ** 24n;

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

/** Derives a fallback `colonyId` from a colony NEAR account ID (`{colony}.{pilot}.terraagent.mock`). */
export function deriveColonyIdFromAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  const dotIdx = trimmed.indexOf('.');
  return dotIdx > 0 ? trimmed.slice(0, dotIdx) : trimmed;
}

export interface SyncAccountOptions {
  readonly colonyId?: string;
  readonly pool?: string;
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

  private readonly log = new Logger(StakingPositionSyncService.name);
  private readonly knownAccountColonies = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(StakingPort) private readonly staking: StakingPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(FlagsService) private readonly flags?: FlagsService,
  ) {}

  onModuleInit(): void {
    if (this.timer) return;
    if (!this.isWaveEnabled() || this.env?.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.syncAll().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`staking_position read-model sync failed: ${msg}`);
      });
    }, STAKING_SYNC_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
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
    const synced = await this.syncAccountPositions(accountId, explicitColonyId);
    if (preferredPool) {
      return synced.find((p) => p.pool === preferredPool) ?? synced[0] ?? null;
    }
    return synced[0] ?? null;
  }

  /** Syncs and returns all active (non-zero) pool positions for `accountId`. */
  async syncAccountPositions(
    accountId: string,
    explicitColonyId?: string,
  ): Promise<StakingPositionDto[]> {
    if (!this.isWaveEnabled()) return [];
    const colonyId = await this.resolveColonyId(accountId, explicitColonyId);
    const pools = await this.staking.listPools();
    const active: StakingPositionDto[] = [];

    for (const poolView of pools) {
      const dto = await this.syncSinglePool(accountId, colonyId, poolView);
      if (dto) active.push(dto);
    }

    if (active.length === 0) {
      const db = this.useDb();
      if (db) {
        await db.stakingPosition.deleteMany({ where: { accountId } });
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
        colonyId: row.colonyId,
        accountId: row.accountId,
        pool: row.poolId,
        ...(poolInfo ? { poolName: poolInfo.name, apyBp: poolInfo.apyBp } : {}),
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
    const readyDate = pos.unbondingReadyAtMs !== null ? new Date(pos.unbondingReadyAtMs) : null;

    if (db) {
      await db.stakingPosition.upsert({
        where: { colonyId_poolId: { colonyId, poolId: poolView.poolId } },
        create: {
          colonyId,
          poolId: poolView.poolId,
          accountId,
          stakedSnapshot: pos.staked,
          unbondingSnapshot: pos.unbonding,
          unbondingReadyAt: readyDate,
          withdrawableSnapshot: pos.withdrawable,
          rewardsSnapshot: rewardsYocto,
          updatedAt: now,
        },
        update: {
          accountId,
          stakedSnapshot: pos.staked,
          unbondingSnapshot: pos.unbonding,
          unbondingReadyAt: readyDate,
          withdrawableSnapshot: pos.withdrawable,
          rewardsSnapshot: rewardsYocto,
          updatedAt: now,
        },
      });
    }

    const dto: StakingPositionDto = {
      colonyId,
      accountId,
      pool: poolView.poolId,
      poolName: poolView.name,
      apyBp: poolView.apyBp,
      staked: yoctoToNear(pos.staked, 6),
      unbonding: yoctoToNear(pos.unbonding, 6),
      unbondingReadyAtMs: pos.unbondingReadyAtMs,
      withdrawable: yoctoToNear(pos.withdrawable, 6),
      rewards: yoctoToNear(rewardsYocto, 6),
      updatedAt: now.getTime(),
    };
    this.positions.set(mapKey, dto);
    return dto;
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

  private async resolveColonyId(accountId: string, explicitColonyId?: string): Promise<string> {
    if (explicitColonyId) {
      this.knownAccountColonies.set(accountId, explicitColonyId);
      return explicitColonyId;
    }
    const cached = this.knownAccountColonies.get(accountId);
    if (cached) return cached;

    const db = this.useDb();
    if (db) {
      const deed = await db.deed.findFirst({ where: { accountId }, select: { colonyId: true } });
      if (deed?.colonyId) {
        this.knownAccountColonies.set(accountId, deed.colonyId);
        return deed.colonyId;
      }
      const colAcct = await db.nearColonyAccount.findUnique({
        where: { accountId },
        select: { colonyId: true, slot: true },
      });
      const fromAcct = colAcct?.colonyId ?? (colAcct?.slot && colAcct.slot !== 'player' ? colAcct.slot : null);
      if (fromAcct) {
        this.knownAccountColonies.set(accountId, fromAcct);
        return fromAcct;
      }
      const existingPos = await db.stakingPosition.findFirst({
        where: { accountId },
        select: { colonyId: true },
      });
      if (existingPos?.colonyId) {
        this.knownAccountColonies.set(accountId, existingPos.colonyId);
        return existingPos.colonyId;
      }
    }

    const derived = deriveColonyIdFromAccountId(accountId);
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
