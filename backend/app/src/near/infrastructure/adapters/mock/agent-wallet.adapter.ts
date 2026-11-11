import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  AgentWalletPort,
  type AddLimitedKeyInput,
  type AllowanceOpInput,
  type AllowanceOpResult,
  type CreateSubAccountInput,
  type CreateSubAccountResult,
  type KeyStatus,
  type KeyStatusQuery,
  type RevokeKeyInput,
} from '../../../application/ports/agent-wallet.port.js';
import { AccountId, ChainReceipt, type OpId } from '../../../domain/types.js';
import { MockChainBase } from '../../mock/mock-chain.base.js';
import { mockTxHashFor } from '../../mock/tx-hash.js';
import {
  assertAddLimitedKey,
  assertKeyRef,
  assertTokenId,
  composeSubAccountId,
  parseTokenAmount,
} from './agent-wallet-input.js';
import type { AllowanceMove } from './agent-wallet-ledger.js';
import {
  applyAllowanceMove,
  insertLimitedKey,
  insertSubAccount,
  loadKeyStatus,
  revokeLimitedKey,
} from './agent-wallet-store.js';

/**
 * Mock `AgentWalletPort` (W15-03, NEAR-80, NEAR-81).
 * Principal is one pool per (account, key, token). Gas allowance is stored on the key and is not moved by these methods.
 */
@Injectable()
export class MockAgentWalletAdapter extends MockChainBase implements AgentWalletPort {
  /** Sub-accounts created in this process. W22 mercenary tests read this without a receipt table. */
  private readonly memoryAccounts = new Set<string>();
  private readonly memoryByOp = new Map<string, CreateSubAccountResult>();
  private readonly memoryReceipts = new Map<string, ChainReceipt>();

  /** Account ids inserted in this process, sorted. A repeated id does not grow the set. */
  accountIds(): readonly string[] {
    return [...this.memoryAccounts].sort();
  }

  async createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
    if (typeof this.prisma.mockChainReceipt?.findUnique !== 'function') return this.createSubAccountInMemory(input);
    const accountId = composeSubAccountId(input.parent, input.name);
    const done = await this.callWithResult('AgentWallet', 'createSubAccount', input.opId, (tx) =>
      insertSubAccount(tx, input.parent, accountId),
    );
    this.memoryAccounts.add(done.value.accountId);
    return { accountId: done.value.accountId, receipt: done.receipt };
  }

  /** Unit-test chain: no receipt table, so idempotency is the op id and the account id in this process. */
  private async createSubAccountInMemory(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
    const prior = this.memoryByOp.get(input.opId);
    if (prior) return prior;
    const accountId = AccountId.parse(`${input.name}.${input.parent}`);
    if (!this.memoryAccounts.has(accountId)) {
      await this.prisma.mockChainAccount.upsert({
        where: { accountId },
        create: { accountId, kind: 'npc' },
        update: {},
      });
      this.memoryAccounts.add(accountId);
    }
    const result = { accountId, receipt: this.memoryReceipt(input.opId) };
    this.memoryByOp.set(input.opId, result);
    return result;
  }

  private memoryReceipt(opId: OpId): ChainReceipt {
    const prior = this.memoryReceipts.get(opId);
    if (prior) return prior;
    const receipt = ChainReceipt.parse({ txHash: mockTxHashFor(opId), status: 'success', network: 'mock', at: Date.now() });
    this.memoryReceipts.set(opId, receipt);
    return receipt;
  }

  async addLimitedKey(input: AddLimitedKeyInput): Promise<ChainReceipt> {
    assertAddLimitedKey(input);
    return this.call('AgentWallet', 'addLimitedKey', input.opId, (tx) => insertLimitedKey(tx, input));
  }

  async revokeKey(input: RevokeKeyInput): Promise<ChainReceipt> {
    assertKeyRef(input.accountId, input.publicKey);
    return this.call('AgentWallet', 'revokeKey', input.opId, (tx) =>
      revokeLimitedKey(tx, input.accountId, input.publicKey),
    );
  }

  keyStatus(input: KeyStatusQuery): Promise<KeyStatus> {
    assertKeyRef(input.accountId, input.publicKey);
    return loadKeyStatus(this.prisma, input.accountId, input.publicKey);
  }

  reserveAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.applyMove('reserveAllowance', 'reserve', input);
  }

  consumeAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.applyMove('consumeAllowance', 'consume', input);
  }

  releaseAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.applyMove('releaseAllowance', 'release', input);
  }

  private async applyMove(method: string, move: AllowanceMove, input: AllowanceOpInput): Promise<AllowanceOpResult> {
    assertKeyRef(input.accountId, input.publicKey);
    assertTokenId(input.token);
    const amount = parseTokenAmount(input.amount);
    const done = await this.callWithResult('AgentWallet', method, input.opId, async (tx) => {
      await applyAllowanceMove(tx, input.accountId, input.publicKey, input.token, move, amount);
      return loadKeyStatus(tx, input.accountId, input.publicKey);
    });
    return { status: done.value, receipt: done.receipt };
  }
}

export const adapter = adapterOf({ port: AgentWalletPort, kind: 'mock', useClass: MockAgentWalletAdapter });
