import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  AgentWalletPort,
  type AddLimitedKeyInput,
  type CreateSubAccountInput,
  type CreateSubAccountResult,
  type RevokeKeyInput,
} from '../../../application/ports/agent-wallet.port.js';
import { NearException } from '../../../domain/errors.js';
import { AccountId, ChainReceipt, type OpId } from '../../../domain/types.js';
import { mockTxHashFor } from '../../mock/tx-hash.js';

/**
 * Mock `AgentWalletPort` (W22-27). `createSubAccount` is idempotent on `opId` and on the account id.
 * Limited keys are W15-03 (BE-78): those methods reject and do not mint a balance.
 */
@Injectable()
export class MockAgentWalletAdapter extends AgentWalletPort {
  private readonly accounts = new Set<string>();
  private readonly byOp = new Map<string, CreateSubAccountResult>();
  private readonly receipts = new Map<string, ChainReceipt>();

  constructor(@Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient) {
    super();
  }

  async createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
    const prior = this.byOp.get(input.opId);
    if (prior) return prior;
    const accountId = AccountId.parse(`${input.name}.${input.parent}`);
    if (!this.accounts.has(accountId)) {
      await this.persist(accountId);
      this.accounts.add(accountId);
    }
    const result = { accountId, receipt: this.receiptFor(input.opId) };
    this.byOp.set(input.opId, result);
    return result;
  }

  addLimitedKey(_input: AddLimitedKeyInput): Promise<ChainReceipt> {
    return this.unavailable('addLimitedKey');
  }

  revokeKey(_input: RevokeKeyInput): Promise<ChainReceipt> {
    return this.unavailable('revokeKey');
  }

  /** Account ids inserted in this process, sorted. A repeated id does not grow the set. */
  accountIds(): readonly string[] {
    return [...this.accounts].sort();
  }

  private async persist(accountId: string): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.mockChainAccount.upsert({
      where: { accountId },
      create: { accountId, kind: 'npc' },
      update: {},
    });
  }

  private receiptFor(opId: OpId): ChainReceipt {
    const prior = this.receipts.get(opId);
    if (prior) return prior;
    const receipt = ChainReceipt.parse({
      txHash: mockTxHashFor(opId),
      status: 'success',
      network: 'mock',
      at: Date.now(),
    });
    this.receipts.set(opId, receipt);
    return receipt;
  }

  private unavailable(method: string): Promise<ChainReceipt> {
    return Promise.reject(new NearException('NEAR_UNAVAILABLE', { message: `AgentWallet.${method} lands with W15-03` }));
  }
}

export const adapter = adapterOf({ port: AgentWalletPort, kind: 'mock', useClass: MockAgentWalletAdapter });
