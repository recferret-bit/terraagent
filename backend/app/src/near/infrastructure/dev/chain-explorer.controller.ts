import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { CoreException, ZodPipe } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { MockChainReadAdapter } from '../adapters/chain-read/mock-chain-read.adapter.js';

/** Page size cap for every explorer list (default 50). */
export const EXPLORER_MAX = 200;
const limit = z.coerce.number().int().min(1).max(EXPLORER_MAX).default(50);
const account = z.string().trim().min(1).max(64).optional();

const ReceiptsQuery = z.object({ account, limit });
const BalancesQuery = z.object({ account, limit });
const NftsQuery = z.object({ account, collection: z.string().trim().min(1).max(64).optional(), limit });
const EscrowQuery = z.object({ account, limit });
const OutboxQuery = z.object({ account, status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD']).optional(), limit });
const DaoQuery = z.object({ limit: z.coerce.number().int().min(1).max(EXPLORER_MAX).default(20) });

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** JSON-text pattern of a whole JSON string value, e.g. `%"alice.test"%`. */
const quoted = (acct: string) => `%${likeEscape(JSON.stringify(acct))}%`;

interface ReceiptRow { tx_hash: string; op_id: string | null; port: string; method: string; status: string; error_code: string | null; payload: unknown; block_height: bigint; created_at: Date }
interface OutboxRowRaw { id: bigint; op_id: string; port: string; method: string; status: string; attempts: number; next_attempt_at: Date; last_error: string | null; payload: unknown; tx_hash: string | null; created_at: Date; updated_at: Date }

/**
 * Read-only dev routes behind the mock chain explorer page (`/dev/chain/`). 404 in production and when ChainRead is not the mock adapter.
 *
 * Account filter rule (`?account=`), applied by receipts and outbox:
 *  - a row matches when its payload JSON contains the account as a whole JSON string value (any key, any depth), or
 *  - (receipts only) its opId is the opId of an NFT currently owned by the account (so mint receipts match their owner).
 * Balances, NFTs and escrow filter by their own account columns (escrow: opener or beneficiary). The DAO list is unfiltered.
 */
@Controller('dev/chain')
export class ChainExplorerController {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly chainRead: ChainReadPort,
  ) {}

  /** 404 first (production / non-mock), then zod validation of the query (400 on failure). */
  private query<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
    this.guard();
    return new ZodPipe(schema).transform(raw);
  }

  private guard(): void {
    if (this.env.NODE_ENV === 'production' || !(this.chainRead instanceof MockChainReadAdapter)) {
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
