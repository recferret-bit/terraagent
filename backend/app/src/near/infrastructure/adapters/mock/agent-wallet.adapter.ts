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
import type { ChainReceipt } from '../../../domain/types.js';
import { MockChainBase } from '../../mock/mock-chain.base.js';
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
  async createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
    const accountId = composeSubAccountId(input.parent, input.name);
    const done = await this.callWithResult('AgentWallet', 'createSubAccount', input.opId, (tx) =>
      insertSubAccount(tx, input.parent, accountId),
    );
    return { accountId: done.value.accountId, receipt: done.receipt };
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
