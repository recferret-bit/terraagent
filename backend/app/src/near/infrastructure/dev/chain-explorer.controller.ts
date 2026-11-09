import { Controller, Get, Inject, Optional, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { CoreException, ZodPipe } from '../../../core/errors/index.js';
import { DevOnlyGuard } from '../../../core/dev-only.guard.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { StakingPort, type StakingPoolView } from '../../application/ports/staking.port.js';
import { parseStakingPoolsConfig } from '../../staking/staking-pools.config.js';
import {
  deriveColonyIdFromAccountId,
  StakingPositionSyncService,
  yoctoToNear,
} from '../../staking/staking-position-sync.service.js';
import { MockChainReadAdapter } from '../adapters/chain-read/mock-chain-read.adapter.js';
import { listExplorerAccounts } from './explorer-accounts.js';
import { readExplorerTx } from './explorer-tx.js';

/** Page size cap for every explorer list (default 50). */
export const EXPLORER_MAX = 200;
const limit = z.coerce.number().int().min(1).max(EXPLORER_MAX).default(50);
const account = z.string().trim().min(1).max(64).optional();

const ReceiptsQuery = z.object({ account, limit });
const AccountsQuery = z.object({ account, limit });
const TxQuery = z.object({ hash: z.string().trim().min(1).max(64) });
const BalancesQuery = z.object({ account, limit });
const NftsQuery = z.object({ account, collection: z.string().trim().min(1).max(64).optional(), limit });
const DeedsQuery = z.object({ account, tokenId: z.string().trim().min(1).max(128).optional(), limit });
const StakingQuery = z.object({ account, limit });
const EscrowQuery = z.object({ account, limit });
const OutboxQuery = z.object({ account, status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD']).optional(), limit });
const DaoQuery = z.object({ limit: z.coerce.number().int().min(1).max(EXPLORER_MAX).default(20) });

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** JSON-text pattern of a whole JSON string value, e.g. `%"alice.test"%`. */
const quoted = (acct: string) => `%${likeEscape(JSON.stringify(acct))}%`;

interface ReceiptRow { tx_hash: string; op_id: string | null; port: string; method: string; status: string; error_code: string | null; payload: unknown; block_height: bigint; created_at: Date }
interface OutboxRowRaw { id: bigint; op_id: string; port: string; method: string; status: string; attempts: number; next_attempt_at: Date; last_error: string | null; payload: unknown; tx_hash: string | null; created_at: Date; updated_at: Date }

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
  const receipts = prisma.mockChainReceipt?.findMany && opIds.length > 0
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

/**
 * Read-only dev routes behind the mock chain explorer page (`/dev/chain/`). 404 in production and when ChainRead is not the mock adapter.
 *
 * Account filter rule (`?account=`), applied by receipts and outbox:
 *  - a row matches when its payload JSON contains the account as a whole JSON string value (any key, any depth), or
 *  - (receipts only) its opId is the opId of an NFT currently owned by the account (so mint receipts match their owner).
 * Balances, NFTs and escrow filter by their own account columns (escrow: opener or beneficiary). The DAO list is unfiltered.
 * Accounts (`?account=` exact id) merge `mock_chain_account` and `near_colony_account`. `GET tx?hash=` is one receipt.
 */
@Controller('dev/chain')
@UseGuards(DevOnlyGuard)
export class ChainExplorerController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly chainRead: ChainReadPort,
    @Optional() @Inject(FlagsService) private readonly flags?: FlagsService,
    @Optional() @Inject(StakingPort) private readonly stakingPort?: StakingPort,
    @Optional() @Inject(StakingPositionSyncService) private readonly stakingSync?: StakingPositionSyncService,
  ) {}

  /** 404 first (production: `DevOnlyGuard`; ChainRead not the mock), then zod validation of the query (400 on failure). */
  private query<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
    this.guard();
    return new ZodPipe(schema).transform(raw);
  }

  private queryW20<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
    this.guard();
    if (this.flags && !this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    return new ZodPipe(schema).transform(raw);
  }

  private guard(): void {
    if (!(this.chainRead instanceof MockChainReadAdapter)) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
  }

  @Get('receipts')
  async receipts(@Query() raw: unknown) {
    const q = this.query(ReceiptsQuery, raw);
    const a = q.account ?? null;
    const pat = a === null ? null : quoted(a);
    const rows = await this.prisma.$queryRaw<ReceiptRow[]>`
      SELECT tx_hash, op_id, port, method, status, error_code, payload, block_height, created_at FROM chain.mock_chain_receipt r
      WHERE (${pat}::text IS NULL OR r.payload::text LIKE ${pat}::text
             OR r.op_id IN (SELECT n.op_id FROM chain.mock_chain_nft n WHERE n.owner_account_id = ${a}::text))
      ORDER BY block_height DESC LIMIT ${q.limit}`;
    return rows.map((r) => ({
      txHash: r.tx_hash, blockHeight: Number(r.block_height), status: r.status, network: 'mock', ...(r.error_code ? { errorCode: r.error_code } : {}),
      at: r.created_at.getTime(), opId: r.op_id, port: r.port, method: r.method, payload: r.payload,
    }));
  }

  @Get('accounts')
  async accounts(@Query() raw: unknown) {
    const q = this.query(AccountsQuery, raw);
    return listExplorerAccounts(this.prisma, { account: q.account, limit: q.limit });
  }

  /** One receipt. `hash` is a query param because a `mock:` hash contains a colon. 404 when the row is missing. */
  @Get('tx')
  async tx(@Query() raw: unknown) {
    const q = this.query(TxQuery, raw);
    const detail = await readExplorerTx(this.prisma, q.hash);
    if (!detail) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    return detail;
  }

  @Get('balances')
  async balances(@Query() raw: unknown) {
    const q = this.query(BalancesQuery, raw);
    const rows = await this.prisma.mockChainBalance.findMany({ where: q.account ? { accountId: q.account } : {}, orderBy: [{ accountId: 'asc' }, { tokenId: 'asc' }], take: q.limit });
    return rows.map((r) => ({ accountId: r.accountId, tokenId: r.tokenId, amount: r.amount.toFixed(0) }));
  }

  @Get('nfts')
  async nfts(@Query() raw: unknown) {
    const q = this.query(NftsQuery, raw);
    const rows = await this.prisma.mockChainNft.findMany({
      where: { ...(q.account ? { ownerAccountId: q.account } : {}), ...(q.collection ? { collection: q.collection } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { tokenId: 'asc' }], take: q.limit,
    });
    return rows.map((r) => ({ collection: r.collection, tokenId: r.tokenId, ownerAccountId: r.ownerAccountId, metadata: r.metadata, opId: r.opId, mintedAt: r.mintedAt.getTime(), updatedAt: r.updatedAt.getTime() }));
  }

  @Get('deeds')
  async deeds(@Query() raw: unknown): Promise<ExplorerDeedRow[]> {
    const q = this.queryW20(DeedsQuery, raw);
    const tokenCandidates = q.tokenId ? expandDeedTokenIds(q.tokenId) : null;
    const where: Record<string, unknown> = {};
    if (q.account) where.accountId = q.account;
    if (tokenCandidates) where.tokenId = tokenCandidates.length === 1 ? tokenCandidates[0] : { in: tokenCandidates };
    const deedRows = this.prisma.deed?.findMany
      ? await this.prisma.deed.findMany({
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
    const extraNfts = await fetchMockDeedNfts(this.prisma, q.account, tokenCandidates, seenTokens, q.limit);
    return [...mappedDeeds, ...extraNfts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, q.limit);
  }

  @Get('staking')
  async staking(@Query() raw: unknown): Promise<ExplorerStakingRow[]> {
    const q = this.queryW20(StakingQuery, raw);
    const pools: readonly StakingPoolView[] = this.stakingPort?.listPools
      ? await this.stakingPort.listPools()
      : parseStakingPoolsConfig(process.env.NEAR_STAKING_POOLS);
    const poolMap = new Map(pools.map((p) => [p.poolId, p]));
    const positionRows = await collectStakingPositions(this.prisma, poolMap, this.stakingSync, q.account, q.limit);
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

  @Get('dao')
  async dao(@Query() raw: unknown) {
    const q = this.query(DaoQuery, raw);
    const rows = await this.prisma.mockChainDao.findMany({
      orderBy: { createdAt: 'desc' }, take: q.limit,
      include: { proposals: { orderBy: { id: 'desc' }, take: EXPLORER_MAX } },
    });
    return rows.map((d) => ({
      id: d.id, policy: d.policy, createdAt: d.createdAt.getTime(),
      proposals: d.proposals.map((p) => ({ id: p.id, proposer: p.proposer, kind: p.kind, status: p.status, votes: p.votes, submitTime: p.submitTime.getTime() })),
    }));
  }

  @Get('escrow')
  async escrow(@Query() raw: unknown) {
    const q = this.query(EscrowQuery, raw);
    const rows = await this.prisma.mockChainEscrow.findMany({
      where: q.account ? { OR: [{ opener: q.account }, { beneficiary: q.account }] } : {}, orderBy: { createdAt: 'desc' }, take: q.limit,
    });
    return rows.map((e) => ({ id: e.id, opener: e.opener, beneficiary: e.beneficiary, tokenId: e.tokenId, amount: e.amount.toFixed(0), status: e.status, createdAt: e.createdAt.getTime() }));
  }

  @Get('outbox')
  async outbox(@Query() raw: unknown) {
    const q = this.query(OutboxQuery, raw);
    const pat = q.account ? quoted(q.account) : null;
    const st = q.status ?? null;
    const rows = await this.prisma.$queryRaw<OutboxRowRaw[]>`
      SELECT id, op_id, port, method, status::text AS status, attempts, next_attempt_at, last_error, payload, tx_hash, created_at, updated_at
      FROM chain.chain_outbox o
      WHERE (${st}::text IS NULL OR o.status::text = ${st}::text) AND (${pat}::text IS NULL OR o.payload::text LIKE ${pat}::text)
      ORDER BY id DESC LIMIT ${q.limit}`;
    return rows.map((o) => ({
      id: Number(o.id), opId: o.op_id, port: o.port, method: o.method, status: o.status, attempts: o.attempts, nextAttemptAt: o.next_attempt_at.getTime(),
      lastError: o.last_error, payload: o.payload, txHash: o.tx_hash, createdAt: o.created_at.getTime(), updatedAt: o.updated_at.getTime(),
    }));
  }
}
