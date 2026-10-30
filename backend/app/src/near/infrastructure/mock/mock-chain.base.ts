import { Inject, Optional } from '@nestjs/common';
import type { DbClient, PrismaClient } from '@terra/db';
import { withTransaction } from '@terra/db';
import { PRISMA } from '../../../db/db.module';
import { NearException, type NearErrorCode } from '../../domain/errors';
import type { ChainReceipt } from '../../domain/types';
import { parseMockChainConfig, seededRandom, type MockChainConfig } from './mock-chain.config';
import { mockTxHashFor, randomMockTxHash } from './tx-hash';

export const MOCK_CHAIN_CONFIG = Symbol('MOCK_CHAIN_CONFIG');

/** Thrown for failures the mock injects on purpose (`MOCK_FAIL_RATE`) and for mock-specific states. */
export class NearMockException extends NearException {}

/** Time and sleep seams so tests run without real waits. */
export interface MockChainRuntime {
  sleep(ms: number): Promise<void>;
  now(): number;
}
const realRuntime: MockChainRuntime = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };

export interface MockCallOptions {
  /** Documented code thrown by an injected failure of this method (default `NEAR_MOCK_INJECTED_FAILURE`). */
  readonly failCode?: NearErrorCode;
}

/**
 * Base of every `Mock*Adapter` (NEAR §1a rule 4): latency, failure injection, `mock:` receipts in `chain.mock_chain_receipt`,
 * and the ledger helpers. Subclasses implement port methods as `this.call(port, method, opId, async (tx) => payload)`.
 */
export abstract class MockChainBase {
  protected readonly config: MockChainConfig;
  protected readonly runtime: MockChainRuntime;
  private readonly random: () => number;

  constructor(
    @Inject(PRISMA) protected readonly prisma: PrismaClient,
    @Optional() @Inject(MOCK_CHAIN_CONFIG) config?: MockChainConfig,
    runtime?: Partial<MockChainRuntime>,
  ) {
    this.config = config ?? parseMockChainConfig();
    this.runtime = { ...realRuntime, ...runtime };
    this.random = this.config.seed === undefined ? Math.random : seededRandom(this.config.seed);
  }

  /** Random latency in `[latencyMinMs, latencyMaxMs]`. */
  protected pickLatencyMs(): number {
    const { latencyMinMs: lo, latencyMaxMs: hi } = this.config;
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  /**
   * One mock chain write. Sleeps, maybe injects a failure (no state change, no receipt), then runs `fn` and the receipt insert in
   * one DB transaction. A repeated `opId` returns the stored receipt without running `fn` again (idempotent, never double-spends).
   * `fn`'s return value (JSON-able) is stored as the receipt payload.
   */
  protected async call<T extends object>(port: string, method: string, opId: string | undefined, fn: (tx: DbClient) => Promise<T>, opts: MockCallOptions = {}): Promise<ChainReceipt> {
    return (await this.callWithResult(port, method, opId, fn, opts)).receipt;
  }

  /** Like `call`, but also returns `fn`'s value (on an idempotent replay: the stored payload). */
  protected async callWithResult<T extends object>(port: string, method: string, opId: string | undefined, fn: (tx: DbClient) => Promise<T>, opts: MockCallOptions = {}): Promise<{ value: T; receipt: ChainReceipt }> {
    await this.runtime.sleep(this.pickLatencyMs());
    if (opId !== undefined) {
      const prior = await this.prisma.mockChainReceipt.findUnique({ where: { opId } });
      if (prior) return { value: prior.payload as T, receipt: toReceipt(prior) };
    }
    if (this.random() < this.config.failRate) {
      const code = opts.failCode ?? 'NEAR_MOCK_INJECTED_FAILURE';
      throw new NearMockException(code, { message: `mock ${port}.${method} failed by injection (MOCK_FAIL_RATE=${this.config.failRate})`, details: { port, method, opId } });
    }
    const txHash = opId === undefined ? randomMockTxHash(this.random) : mockTxHashFor(opId);
    return withTransaction(this.prisma, async (tx) => {
      const value = await fn(tx);
      const [{ h }] = await tx.$queryRaw<{ h: bigint }[]>`SELECT nextval('chain.mock_chain_block_height_seq') AS h`;
      const row = await tx.mockChainReceipt.create({
        data: { txHash, opId: opId ?? null, port, method, status: 'success', payload: value as object, blockHeight: h },
      });
      return { value, receipt: toReceipt(row) };
    });
  }

  /** Creates the account row when missing (kind `named` by default). */
  protected async ensureAccount(tx: DbClient, accountId: string, kind = 'named'): Promise<void> {
    await tx.mockChainAccount.upsert({ where: { accountId }, create: { accountId, kind }, update: {} });
  }

  /** Adds `amount` (decimal string, base units) to the balance, creating account and balance rows as needed. */
  protected async credit(tx: DbClient, accountId: string, tokenId: string, amount: string): Promise<void> {
    await this.ensureAccount(tx, accountId);
    await tx.$executeRaw`INSERT INTO chain.mock_chain_balance (account_id, token_id, amount) VALUES (${accountId}, ${tokenId}, ${amount}::numeric)
      ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_balance.amount + EXCLUDED.amount`;
  }

  /** Subtracts `amount`; `NEAR_INSUFFICIENT_BALANCE` (the transaction rolls back) when the balance is too low. */
  protected async debit(tx: DbClient, accountId: string, tokenId: string, amount: string): Promise<void> {
    const rows = await tx.$executeRaw`UPDATE chain.mock_chain_balance SET amount = amount - ${amount}::numeric
      WHERE account_id = ${accountId} AND token_id = ${tokenId} AND amount >= ${amount}::numeric`;
    if (rows === 1) return;
    const row = await tx.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId, tokenId } } });
    throw new NearMockException('NEAR_INSUFFICIENT_BALANCE', {
      message: `${accountId} has ${row?.amount.toFixed() ?? '0'} ${tokenId}, needs ${amount}`,
      details: { accountId, tokenId, needed: amount, available: row?.amount.toFixed() ?? '0' },
    });
  }

  /** Current balance as a decimal string. */
  protected async balanceOf(tx: DbClient, accountId: string, tokenId: string): Promise<string> {
    const row = await tx.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId, tokenId } } });
    return row?.amount.toFixed() ?? '0';
  }
}

function toReceipt(row: { txHash: string; status: string; errorCode: string | null; blockHeight: bigint; createdAt: Date }): ChainReceipt {
  return {
    txHash: row.txHash,
    blockHeight: Number(row.blockHeight),
    status: row.status === 'success' ? 'success' : 'failure',
    network: 'mock',
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    at: row.createdAt.getTime(),
  };
}
