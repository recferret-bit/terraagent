import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { ChainReadPort } from '../../../application/ports/chain-read.port.js';
import { ChainHealth, ChainReceipt } from '../../../domain/types.js';
import type { MockChainConfig } from '../../mock/mock-chain.config.js';
import { MOCK_CHAIN_CONFIG, MockChainBase, type MockChainRuntime } from '../../mock/mock-chain.base.js';

export const RECEIPT_LIST_MAX = 200;
/** Optional DI token for the time/sleep seam (never provided in the app; tests pass the runtime directly). */
export const MOCK_CHAIN_RUNTIME = Symbol('MOCK_CHAIN_RUNTIME');

/**
 * Mock `ChainReadPort`: receipts come from the mock ledger (`chain.mock_chain_receipt`).
 * Reads never inject failures and never sleep (tests poll `receipt`); only writes (`ping`) use the mock latency/failure model.
 */
@Injectable()
export class MockChainReadAdapter extends MockChainBase implements ChainReadPort {
  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Optional() @Inject(MOCK_CHAIN_CONFIG) config?: MockChainConfig,
    @Optional() @Inject(MOCK_CHAIN_RUNTIME) runtime?: Partial<MockChainRuntime>,
  ) {
    super(prisma, config, runtime);
  }

  /** Always `null`: `mock:` hashes have no explorer (the dev mock explorer page lists receipts from the API instead). */
  explorerUrl(_txHash: string): string | null {
    return null;
  }

  async receipt(txHash: string): Promise<ChainReceipt | null> {
    const row = await this.prisma.mockChainReceipt.findUnique({ where: { txHash } });
    return row ? ChainReceipt.parse(toReceiptShape(row)) : null;
  }

  async health(): Promise<ChainHealth> {
    const started = this.runtime.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return ChainHealth.parse({ ok: true, network: 'mock', latencyMs: this.runtime.now() - started });
    } catch (e) {
      return ChainHealth.parse({ ok: false, network: 'mock', latencyMs: this.runtime.now() - started, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Dev only (`chain.ping`): writes a ping receipt through the mock chain, after the mock latency. */
  ping(opId?: string): Promise<ChainReceipt> {
    return this.call('ChainRead', 'ping', opId, async () => ({ ping: true }));
  }

  /** Dev only: latest receipts, newest first. */
  async latestReceipts(limit = 50): Promise<ChainReceipt[]> {
    const take = Math.min(Math.max(1, Math.trunc(limit) || 50), RECEIPT_LIST_MAX);
    const rows = await this.prisma.mockChainReceipt.findMany({ orderBy: [{ blockHeight: 'desc' }], take });
    return rows.map((r) => ChainReceipt.parse(toReceiptShape(r)));
  }
}

function toReceiptShape(row: { txHash: string; status: string; errorCode: string | null; blockHeight: bigint; createdAt: Date }) {
  return {
    txHash: row.txHash,
    blockHeight: Number(row.blockHeight),
    status: row.status === 'success' ? 'success' : row.status === 'pending' ? 'pending' : 'failure',
    network: 'mock',
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    at: row.createdAt.getTime(),
  };
}

export const adapter = adapterOf({ port: ChainReadPort, kind: 'mock', useClass: MockChainReadAdapter });
