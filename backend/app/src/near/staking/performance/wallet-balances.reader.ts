import { STAKING_ASSETS, STAKING_RULES, type StakingAsset, type StakingTxRow } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import type { WalletRef } from '../perks/stake-clock.reader.js';
import { computeSplitRewardDelta, PROTOCOL_YIELD_SHARE_BP, yoctoToNear } from '../yocto.js';
import { readPoolTxAssetNets, splitStakedByAsset } from './asset-split.js';

type Dec = { toFixed(n: number): string } | null | undefined;
const y = (d: Dec): bigint => (d ? BigInt(d.toFixed(0)) : 0n);

/**
 * LST to NEAR rate is read as 1:1 until an exchange-rate read exists (stNEAR / LiNEAR trade slightly above 1, so
 * `nearValue` is a conservative floor). Single place to change.
 */
export const lstNearValue = (_asset: StakingAsset, amountYocto: bigint): bigint => amountYocto;

export interface WalletBalances {
  readonly walletYocto: bigint;
  readonly activeYocto: bigint;
  readonly unbondingYocto: bigint;
  readonly withdrawableYocto: bigint;
  readonly accruedYocto: bigint;
  readonly lst: ReadonlyArray<{ asset: StakingAsset; amountYocto: bigint }>;
  readonly unbondingReadyAtMs: number | null;
}

export const EMPTY_BALANCES: WalletBalances = Object.freeze({
  walletYocto: 0n,
  activeYocto: 0n,
  unbondingYocto: 0n,
  withdrawableYocto: 0n,
  accruedYocto: 0n,
  lst: [],
  unbondingReadyAtMs: null,
});

interface PosRow {
  readonly accountId: string;
  readonly poolId: string;
  readonly asset: string;
  readonly staked: bigint;
  readonly unbonding: bigint;
  readonly withdrawable: bigint;
  readonly rewards: bigint;
  readonly readyAt: Date | null;
}

interface RawPosRecord {
  readonly colonyId?: string | null;
  readonly accountId: string;
  readonly poolId: string;
  readonly asset: string;
  readonly staked: bigint;
  readonly unbonding: bigint;
  readonly withdrawable: bigint;
  readonly rewards: bigint;
  readonly readyAt: Date | null;
  readonly updatedMs: number;
}

async function readPositions(db: DbClient, wallet: WalletRef): Promise<PosRow[]> {
  const or: Array<Record<string, unknown>> = [];
  if (wallet.colonyIds.length) or.push({ colonyId: { in: [...wallet.colonyIds] } });
  if (wallet.accountIds.length) or.push({ accountId: { in: [...wallet.accountIds] } });
  if (or.length === 0) return [];
  const pos =
    typeof db.stakingPosition?.findMany === 'function'
      ? ((await db.stakingPosition.findMany({ where: { OR: or } })) as Array<Record<string, Dec | string | Date | null>>)
      : [];
  const deduped = new Map<string, RawPosRecord>();
  let anonIdx = 0;
  for (const p of pos) {
    const accountId = String(p.accountId ?? '');
    const poolId = String(p.poolId ?? '');
    const colonyId = p.colonyId ? String(p.colonyId) : null;
    const updatedMs = p.updatedAt instanceof Date ? p.updatedAt.getTime() : 0;
    const key = accountId && poolId
      ? `acct:${accountId}::pool:${poolId}`
      : accountId
        ? `acct:${accountId}::row:${anonIdx++}`
        : `col:${colonyId ?? anonIdx++}::pool:${poolId}`;
    const prev = deduped.get(key);
    if (!prev || updatedMs >= prev.updatedMs) {
      deduped.set(key, {
        colonyId,
        accountId,
        poolId,
        asset: String(p.asset ?? 'near'),
        staked: y(p.stakedSnapshot as Dec),
        unbonding: y(p.unbondingSnapshot as Dec),
        withdrawable: y(p.withdrawableSnapshot as Dec),
        rewards: y(p.rewardsSnapshot as Dec),
        readyAt: (p.unbondingReadyAt as Date | null) ?? null,
        updatedMs,
      });
    }
  }
  const rows: PosRow[] = [...deduped.values()];
  const covered = new Set(rows.map((r) => r.accountId));
  const wanted = wallet.accountIds.filter((a) => !covered.has(a));
  if (wanted.length && typeof db.mockChainStaking?.findMany === 'function') {
    const mocks = (await db.mockChainStaking.findMany({ where: { accountId: { in: wanted } } })) as Array<Record<string, Dec | string | Date | null>>;
    for (const m of mocks) {
      rows.push({
        accountId: String(m.accountId),
        poolId: String(m.poolId ?? ''),
        asset: String(m.asset ?? 'near'),
        staked: y(m.staked as Dec),
        unbonding: y(m.unbonding as Dec),
        withdrawable: y(m.withdrawable as Dec),
        rewards: y(m.rewardsAccrued as Dec),
        readyAt: (m.unbondingReadyAt as Date | null) ?? null,
      });
    }
  }
  return rows;
}

export interface WalletBalanceReadOptions {
  readonly readMockWallet: boolean;
  readonly nowMs?: number;
  readonly primaryAccountId?: string;
  readonly readLiveWalletYocto?: (accountId: string) => Promise<bigint>;
  readonly rewardMultiplier?: number;
  readonly grossApyBp?: number;
  readonly protocolYieldShareBp?: number;
}

interface MockStakingRecord {
  readonly accountId: string;
  readonly poolId: string;
  readonly staked: Dec;
  readonly unbonding: Dec;
  readonly unbondingReadyAt: Date | null;
  readonly withdrawable: Dec;
  readonly rewardsAccrued: Dec;
  readonly lastAccruedAt: Date;
}

async function overlayLiveMockRewards(db: DbClient, rows: PosRow[], wallet: WalletRef, cfg: WalletBalanceReadOptions): Promise<PosRow[]> {
  if (!cfg.readMockWallet || cfg.nowMs === undefined || !wallet.accountIds.length || typeof db.mockChainStaking?.findMany !== 'function') {
    return rows;
  }
  const mocks = (await db.mockChainStaking.findMany({
    where: { accountId: { in: [...wallet.accountIds] } },
  })) as MockStakingRecord[];
  if (mocks.length === 0) return rows;
  const apyBp = cfg.grossApyBp ?? STAKING_RULES.simGrossApyBp;
  const shareBp = cfg.protocolYieldShareBp ?? PROTOCOL_YIELD_SHARE_BP;
  const mult = Math.max(1, cfg.rewardMultiplier ?? 1);
  const nowMs = cfg.nowMs;
  const byKey = new Map(mocks.map((m) => {
    const staked = y(m.staked);
    const unbondingRaw = y(m.unbonding);
    const readyMs = m.unbondingReadyAt ? m.unbondingReadyAt.getTime() : null;
    const matured = unbondingRaw > 0n && readyMs !== null && nowMs >= readyMs;
    const elapsedMs = Math.max(0, nowMs - m.lastAccruedAt.getTime()) * mult;
    const split = computeSplitRewardDelta(staked, apyBp, elapsedMs, shareBp);
    return [
      `${m.accountId}::${m.poolId}`,
      {
        rewards: y(m.rewardsAccrued) + split.userReward,
        unbonding: matured ? 0n : unbondingRaw,
        withdrawable: matured ? y(m.withdrawable) + unbondingRaw : y(m.withdrawable),
        readyAt: matured ? null : m.unbondingReadyAt,
      },
    ] as const;
  }));
  return rows.map((r) => {
    const live = byKey.get(`${r.accountId}::${r.poolId}`);
    return live ? { ...r, ...live } : r;
  });
}

/** Wallet NEAR (mock ledger or live StakingPort RPC), active / unbonding / withdrawable / accrued, LSTs. */
export async function readWalletBalances(
  db: DbClient,
  wallet: WalletRef,
  opts: boolean | WalletBalanceReadOptions,
): Promise<WalletBalances> {
  const cfg: WalletBalanceReadOptions = typeof opts === 'boolean' ? { readMockWallet: opts } : opts;
  const rows = await overlayLiveMockRewards(db, await readPositions(db, wallet), wallet, cfg);
  const txNets = rows.length > 0 ? await readPoolTxAssetNets(db, [...new Set(rows.map((r) => r.accountId))]) : new Map();
  let active = 0n, unbonding = 0n, withdrawable = 0n, accrued = 0n;
  let ready: number | null = null;
  const lst = new Map<StakingAsset, bigint>();
  for (const r of rows) {
    const split = splitStakedByAsset(r.staked, r.asset, txNets.get(`${r.accountId}::${r.poolId}`));
    active += split.near;
    if (split.stNEAR > 0n) lst.set('stNEAR', (lst.get('stNEAR') ?? 0n) + split.stNEAR);
    if (split.LiNEAR > 0n) lst.set('LiNEAR', (lst.get('LiNEAR') ?? 0n) + split.LiNEAR);
    const matured = cfg.nowMs !== undefined && r.unbonding > 0n && r.readyAt !== null && cfg.nowMs >= r.readyAt.getTime();
    const rowUnbonding = matured ? 0n : r.unbonding;
    const rowWithdrawable = matured ? r.withdrawable + r.unbonding : r.withdrawable;
    const rowReadyAt = matured ? null : r.readyAt;
    unbonding += rowUnbonding;
    withdrawable += rowWithdrawable;
    accrued += r.rewards;
    if (rowUnbonding > 0n && rowReadyAt && (ready === null || rowReadyAt.getTime() < ready)) ready = rowReadyAt.getTime();
  }
  let walletYocto = 0n;
  if (cfg.readMockWallet && wallet.accountIds.length && typeof db.mockChainBalance?.findMany === 'function') {
    const bal = (await db.mockChainBalance.findMany({ where: { accountId: { in: [...wallet.accountIds] }, tokenId: 'NEAR' } })) as Array<{ amount: Dec }>;
    walletYocto = bal.reduce((s, b) => s + y(b.amount), 0n);
  } else if (!cfg.readMockWallet && cfg.readLiveWalletYocto) {
    const acct = cfg.primaryAccountId ?? wallet.accountIds[0];
    if (acct) {
      try {
        const live = await cfg.readLiveWalletYocto(acct);
        walletYocto = live > 0n ? live : 0n;
      } catch {
        walletYocto = 0n;
      }
    }
  }
  return {
    walletYocto,
    activeYocto: active,
    unbondingYocto: unbonding,
    withdrawableYocto: withdrawable,
    accruedYocto: accrued,
    lst: [...lst].map(([asset, amountYocto]) => ({ asset, amountYocto })),
    unbondingReadyAtMs: ready,
  };
}

export interface TxRecord {
  readonly txHash: string;
  readonly kind: StakingTxRow['kind'];
  readonly asset: StakingAsset;
  readonly amountYocto: bigint;
  readonly atMs: number;
}

/** `chain.staking_tx` rows of the wallet since `sinceMs`, newest first (bounded). */
export async function readStakingTxs(db: DbClient, wallet: WalletRef, sinceMs: number): Promise<TxRecord[]> {
  if (typeof db.stakingTx?.findMany !== 'function' || wallet.accountIds.length === 0) return [];
  const rows = (await db.stakingTx.findMany({
    where: { accountId: { in: [...wallet.accountIds] }, createdAt: { gte: new Date(sinceMs) } },
    orderBy: { createdAt: 'desc' },
    take: 1_000,
  })) as Array<{ txHash: string; kind: string; asset: string; amountYocto: Dec; createdAt: Date }>;
  return rows.map((r) => ({
    txHash: r.txHash,
    kind: r.kind as TxRecord['kind'],
    asset: (STAKING_ASSETS.find((a) => a === r.asset) ?? 'near') as StakingAsset,
    amountYocto: y(r.amountYocto),
    atMs: r.createdAt.getTime(),
  }));
}

export const yoctoToNearNumber = (v: bigint): number => Number(v / 10n ** 12n) / 1e12;
export const nearText = (v: bigint): string => yoctoToNear(v, 6);
