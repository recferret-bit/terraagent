import type { PrismaClient } from '@terra/db';
import type { StakingPoolView, StakingPort } from '../../../application/ports/staking.port.js';
import { parseStakingPoolsConfig } from '../../../staking/staking-pools.config.js';
import {
  deriveColonyIdFromAccountId,
  StakingPositionSyncService,
  yoctoToNear,
} from '../../../staking/staking-position-sync.service.js';

export interface ExplorerDeedHistoryItem {
  readonly version: number;
  readonly change: string;
  readonly opId: string;
  readonly txHash: string | null;
  readonly at: number;
}

export interface ExplorerDeedRow {
  readonly tokenId: string;
  readonly colonyId: string;
  readonly planetId: string;
  readonly accountId: string;
  readonly version: number;
  readonly status: string;
  readonly settled: boolean;
  readonly chainState: string;
  readonly lastUpdateTx: string | null;
  readonly metadata: unknown;
  readonly history: ExplorerDeedHistoryItem[];
  readonly updatedAt: number;
}

export interface ExplorerStakingRow {
  readonly kind: 'position' | 'pool';
  readonly pool: string;
  readonly poolId: string;
  readonly name: string;
  readonly accountId: string;
  readonly colonyId: string;
  readonly staked: string;
  readonly unbonding: string;
  readonly withdrawable: string;
  readonly rewards: string;
  readonly apyBp: number;
  readonly updatedAt: number;
}

function expandDeedTokenIds(tokenId: string): string[] {
  const raw = tokenId.replace(/^deed[:-]/, '').trim();
  return Array.from(new Set([tokenId, `deed:${raw}`, `deed-${raw}`, raw].filter(Boolean)));
}

function asMetaRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
}

function formatNearAmount(val: unknown): string {
  if (val === null || val === undefined) return '0';
  const raw =
    typeof val === 'object' && 'toFixed' in val && typeof (val as { toFixed: (n?: number) => string }).toFixed === 'function'
      ? (val as { toFixed: (n?: number) => string }).toFixed(0)
      : String(val).trim();
  if (!raw || raw === '0') return '0';
  if (/^\d{19,}$/.test(raw)) return yoctoToNear(raw, 6);
  return raw;
}

function mapMockNftHistory(
  tokenId: string,
  nftOpId: string,
  mintedAt: Date,
  settled: boolean,
  histRows: Array<{ opId: string; metadata: unknown; at: Date }>,
  receiptByOp: Map<string, string>,
): ExplorerDeedHistoryItem[] {
  if (histRows.length === 0) {
    return [{
      version: 1,
      change: settled ? 'Deed settled' : 'Deed minted',
      opId: nftOpId,
      txHash: receiptByOp.get(nftOpId) ?? null,
      at: mintedAt.getTime(),
    }];
  }
  return histRows.map((h, idx) => {
    const hMeta = asMetaRecord(h.metadata);
    const version = typeof hMeta.version === 'number' ? hMeta.version : idx + 1;
    const change =
      typeof hMeta.change === 'string' && hMeta.change
        ? hMeta.change
        : hMeta.settled === true
          ? 'Deed settled'
          : idx === 0
            ? 'Deed minted'
            : `Metadata updated (v${version}) · ${tokenId}`;
    return {
      version,
      change,
      opId: h.opId,
      txHash: receiptByOp.get(h.opId) ?? null,
      at: h.at.getTime(),
    };
  });
}

async function fetchMockDeedNfts(
  prisma: PrismaClient,
  accountFilter: string | undefined,
  tokenCandidates: string[] | null,
  seenTokens: Set<string>,
  take: number,
): Promise<ExplorerDeedRow[]> {
  if (!prisma.mockChainNft?.findMany) return [];
  const nftWhere: Record<string, unknown> = { collection: 'deed' };
  if (accountFilter) nftWhere.ownerAccountId = accountFilter;
  if (tokenCandidates) {
    nftWhere.tokenId = tokenCandidates.length === 1 ? tokenCandidates[0] : { in: tokenCandidates };
  }
  const rawNfts = await prisma.mockChainNft.findMany({
    where: nftWhere,
    orderBy: [{ updatedAt: 'desc' }, { tokenId: 'asc' }],
    take,
  });
  const extraNfts = rawNfts.filter((n) => {
    if (n.collection !== 'deed') return false;
    if (accountFilter && n.ownerAccountId !== accountFilter) return false;
    if (tokenCandidates && !tokenCandidates.includes(n.tokenId)) return false;
    return !seenTokens.has(n.tokenId);
  });
  if (extraNfts.length === 0) return [];

  const tokenIds = extraNfts.map((n) => n.tokenId);
  const histRows = prisma.mockChainNftMetaHistory?.findMany
    ? await prisma.mockChainNftMetaHistory.findMany({
        where: { collection: 'deed', tokenId: { in: tokenIds } },
        orderBy: { id: 'asc' },
      })
    : [];
  const opIds = Array.from(new Set([...extraNfts.map((n) => n.opId), ...histRows.map((h) => h.opId)]));
  const receipts =
    typeof prisma.mockChainReceipt?.findMany === 'function' && opIds.length > 0
    ? await prisma.mockChainReceipt.findMany({
        where: { opId: { in: opIds } },
        select: { opId: true, txHash: true },
      })
    : [];
  const receiptByOp = new Map<string, string>();
  for (const r of receipts) {
    if (r.opId) receiptByOp.set(r.opId, r.txHash);
  }

  return extraNfts.map((nft) => {
    const meta = asMetaRecord(nft.metadata);
    const colonyId =
      typeof meta.colony === 'string' && meta.colony ? meta.colony : nft.tokenId.replace(/^deed[:-]/, '');
    const planetId = typeof meta.planet === 'string' ? meta.planet : '';
    const settled = meta.settled === true || meta.status === 'settled';
    const status = typeof meta.status === 'string' ? meta.status : settled ? 'settled' : 'active';
    const perTokenHist = histRows.filter((h) => h.tokenId === nft.tokenId);
    const history = mapMockNftHistory(nft.tokenId, nft.opId, nft.mintedAt, settled, perTokenHist, receiptByOp);
    const version = typeof meta.version === 'number' ? meta.version : Math.max(1, history.length);
    const lastUpdateTx = history[history.length - 1]?.txHash ?? receiptByOp.get(nft.opId) ?? null;
    return {
      tokenId: nft.tokenId, colonyId, planetId, accountId: nft.ownerAccountId, version, status, settled,
      chainState: 'ACTIVE', lastUpdateTx, metadata: nft.metadata, history, updatedAt: nft.updatedAt.getTime(),
    };
  });
}

export async function listExplorerDeeds(
  prisma: PrismaClient,
  q: { account?: string; tokenId?: string; limit: number },
): Promise<ExplorerDeedRow[]> {
  const tokenCandidates = q.tokenId ? expandDeedTokenIds(q.tokenId) : null;
  const where: Record<string, unknown> = {};
  if (q.account) where.accountId = q.account;
  if (tokenCandidates) {
    where.tokenId = tokenCandidates.length === 1 ? tokenCandidates[0] : { in: tokenCandidates };
  }
  const deedRows = prisma.deed?.findMany
    ? await prisma.deed.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: { history: { orderBy: { version: 'asc' } } },
        take: q.limit,
      })
    : [];
  const mappedDeeds: ExplorerDeedRow[] = deedRows
    .filter((d) => (!q.account || d.accountId === q.account) && (!tokenCandidates || tokenCandidates.includes(d.tokenId) || tokenCandidates.includes(d.colonyId)))
    .map((d) => ({
      tokenId: d.tokenId, colonyId: d.colonyId, planetId: d.planetId, accountId: d.accountId,
      version: d.metadataVersion, status: d.status, settled: d.settled, chainState: d.chainState,
      lastUpdateTx: d.lastUpdateTx, metadata: d.metadata,
      history: (d.history ?? []).map((h) => ({ version: h.version, change: h.change, opId: h.opId, txHash: h.txHash, at: h.createdAt.getTime() })),
      updatedAt: d.updatedAt.getTime(),
    }));
  const seenTokens = new Set<string>();
  for (const d of mappedDeeds) {
    for (const c of expandDeedTokenIds(d.tokenId)) seenTokens.add(c);
    seenTokens.add(d.colonyId);
  }
  const extraNfts = await fetchMockDeedNfts(prisma, q.account, tokenCandidates, seenTokens, q.limit);
  return [...mappedDeeds, ...extraNfts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, q.limit);
}

async function appendMockStakingRows(
  prisma: PrismaClient,
  poolMap: Map<string, StakingPoolView>,
  accountFilter: string | undefined,
  take: number,
  seen: Set<string>,
  rows: ExplorerStakingRow[],
): Promise<void> {
  if (!prisma.mockChainStaking?.findMany) return;
  const rawMock = await prisma.mockChainStaking.findMany({
    where: accountFilter ? { accountId: accountFilter } : {},
    orderBy: [{ accountId: 'asc' }, { poolId: 'asc' }],
    take,
  });
  for (const m of rawMock) {
    if (accountFilter && m.accountId !== accountFilter) continue;
    const key = `${m.accountId}::${m.poolId}`;
    if (seen.has(key)) continue;
    const staked = formatNearAmount(m.staked);
    const unbonding = formatNearAmount(m.unbonding);
    const withdrawable = formatNearAmount(m.withdrawable);
    const rewards = formatNearAmount(m.rewardsAccrued);
    if (staked === '0' && unbonding === '0' && withdrawable === '0' && rewards === '0') continue;
    seen.add(key);
    const poolInfo = poolMap.get(m.poolId);
    rows.push({
      kind: 'position', pool: m.poolId, poolId: m.poolId, name: poolInfo?.name ?? m.poolId,
      accountId: m.accountId, colonyId: deriveColonyIdFromAccountId(m.accountId),
      staked, unbonding, withdrawable, rewards, apyBp: poolInfo?.apyBp ?? 0,
      updatedAt: m.updatedAt instanceof Date ? m.updatedAt.getTime() : Number(m.updatedAt ?? 0),
    });
  }
}

async function collectStakingPositions(
  prisma: PrismaClient,
  poolMap: Map<string, StakingPoolView>,
  stakingSync: StakingPositionSyncService | undefined,
  accountFilter: string | undefined,
  take: number,
): Promise<ExplorerStakingRow[]> {
  if (stakingSync?.syncAll) {
    try { await stakingSync.syncAll(accountFilter ? [accountFilter] : []); } catch { /* ignore partial mock */ }
  }
  const rawPos = prisma.stakingPosition?.findMany
    ? await prisma.stakingPosition.findMany({
        where: accountFilter ? { OR: [{ accountId: accountFilter }, { colonyId: accountFilter }] } : {},
        orderBy: [{ colonyId: 'asc' }, { poolId: 'asc' }],
        take,
      })
    : [];

  const rows: ExplorerStakingRow[] = [];
  const seen = new Set<string>();
  for (const r of rawPos) {
    if (accountFilter && r.accountId !== accountFilter && r.colonyId !== accountFilter) continue;
    const poolInfo = poolMap.get(r.poolId);
    seen.add(`${r.accountId}::${r.poolId}`);
    rows.push({
      kind: 'position', pool: r.poolId, poolId: r.poolId, name: poolInfo?.name ?? r.poolId,
      accountId: r.accountId, colonyId: r.colonyId,
      staked: formatNearAmount(r.stakedSnapshot), unbonding: formatNearAmount(r.unbondingSnapshot),
      withdrawable: formatNearAmount(r.withdrawableSnapshot), rewards: formatNearAmount(r.rewardsSnapshot),
      apyBp: poolInfo?.apyBp ?? 0,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt ?? 0),
    });
  }

  if (rows.length === 0 && stakingSync?.getReadModelPositions) {
    const synced = await stakingSync.getReadModelPositions(accountFilter);
    for (const s of synced) {
      if (accountFilter && s.accountId !== accountFilter && s.colonyId !== accountFilter) continue;
      const key = `${s.accountId}::${s.pool}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const poolInfo = poolMap.get(s.pool);
      rows.push({
        kind: 'position', pool: s.pool, poolId: s.pool, name: s.poolName ?? poolInfo?.name ?? s.pool,
        accountId: s.accountId, colonyId: s.colonyId,
        staked: formatNearAmount(s.staked), unbonding: formatNearAmount(s.unbonding),
        withdrawable: formatNearAmount(s.withdrawable), rewards: formatNearAmount(s.rewards),
        apyBp: s.apyBp ?? poolInfo?.apyBp ?? 0, updatedAt: s.updatedAt ?? 0,
      });
    }
  }

  await appendMockStakingRows(prisma, poolMap, accountFilter, take, seen, rows);
  return rows;
}

export async function listExplorerStaking(
  prisma: PrismaClient,
  stakingPort: StakingPort | undefined,
  stakingSync: StakingPositionSyncService | undefined,
  q: { account?: string; limit: number },
): Promise<ExplorerStakingRow[]> {
  const pools: readonly StakingPoolView[] = stakingPort?.listPools
    ? await stakingPort.listPools()
    : parseStakingPoolsConfig(process.env.NEAR_STAKING_POOLS);
  const poolMap = new Map(pools.map((p) => [p.poolId, p]));
  const positionRows = await collectStakingPositions(prisma, poolMap, stakingSync, q.account, q.limit);
  const poolRows: ExplorerStakingRow[] = pools
    .filter((p) => !q.account || p.poolId === q.account)
    .map((p) => {
      const stakedTotal = positionRows.filter((pos) => pos.pool === p.poolId).reduce((acc, pos) => acc + Number(pos.staked || 0), 0);
      return {
        kind: 'pool', pool: p.poolId, poolId: p.poolId, name: p.name, accountId: '-', colonyId: '-',
        staked: String(Number(stakedTotal.toFixed(6))), unbonding: '0', withdrawable: '0', rewards: '-',
        apyBp: p.apyBp, updatedAt: 0,
      };
    });
  return [...positionRows, ...poolRows].slice(0, q.limit);
}
