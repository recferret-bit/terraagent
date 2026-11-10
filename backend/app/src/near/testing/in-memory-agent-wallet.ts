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
} from '../application/ports/agent-wallet.port';
import { NearException } from '../domain/errors';
import type { ChainReceipt } from '../domain/types';
import {
  assertAddLimitedKey,
  assertKeyRef,
  assertTokenId,
  composeSubAccountId,
  parseTokenAmount,
} from '../agent-wallet/input';
import {
  ZERO_ALLOWANCE,
  nextAllowance,
  toAllowanceView,
  type AllowanceMove,
  type AllowanceTotals,
} from '../agent-wallet/ledger';
import { InMemoryChain } from './in-memory-chain';

interface MemKey {
  accountId: string;
  publicKey: string;
  receiverId: string;
  methodNames: string[];
  gasAllowance: string;
  gasSpent: string;
  revoked: boolean;
  tokens: Map<string, AllowanceTotals>;
}

const keyId = (accountId: string, publicKey: string): string => `${accountId}\0${publicKey}`;

/**
 * In-memory `AgentWalletPort` for unit tests (NEAR §1a rule 8).
 * Principal math and receiver checks are the mock's pure functions. Gas is stored and never moved.
 */
export class InMemoryAgentWallet extends AgentWalletPort {
  private readonly accounts = new Set<string>();
  private readonly keys = new Map<string, MemKey>();

  constructor(private readonly chain: InMemoryChain = new InMemoryChain()) {
    super();
  }

  async createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
    const accountId = composeSubAccountId(input.parent, input.name);
    const done = this.chain.write(input.opId, () => this.insertSub(input.parent, accountId), {
      port: 'AgentWallet',
      method: 'createSubAccount',
    });
    return { accountId: done.value.accountId, receipt: done.receipt };
  }

  async addLimitedKey(input: AddLimitedKeyInput): Promise<ChainReceipt> {
    assertAddLimitedKey(input);
    return this.chain.write(input.opId, () => this.insertKey(input), { port: 'AgentWallet', method: 'addLimitedKey' })
      .receipt;
  }

  async revokeKey(input: RevokeKeyInput): Promise<ChainReceipt> {
    assertKeyRef(input.accountId, input.publicKey);
    return this.chain.write(input.opId, () => this.markRevoked(input.accountId, input.publicKey), {
      port: 'AgentWallet',
      method: 'revokeKey',
    }).receipt;
  }

  async keyStatus(input: KeyStatusQuery): Promise<KeyStatus> {
    assertKeyRef(input.accountId, input.publicKey);
    return this.view(this.requireKey(input.accountId, input.publicKey));
  }

  async reserveAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.move('reserveAllowance', 'reserve', input);
  }

  async consumeAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.move('consumeAllowance', 'consume', input);
  }

  async releaseAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.move('releaseAllowance', 'release', input);
  }

  private move(method: string, move: AllowanceMove, input: AllowanceOpInput): AllowanceOpResult {
    assertKeyRef(input.accountId, input.publicKey);
    assertTokenId(input.token);
    const amount = parseTokenAmount(input.amount);
    const done = this.chain.write(
      input.opId,
      () => this.apply(input.accountId, input.publicKey, input.token, move, amount),
      { port: 'AgentWallet', method },
    );
    return { status: done.value, receipt: done.receipt };
  }

  private insertSub(parent: string, accountId: string): { accountId: string } {
    if (this.accounts.has(accountId)) {
      throw new NearException('NEAR_ACCOUNT_EXISTS', { message: `${accountId} already exists` });
    }
    this.accounts.add(parent);
    this.accounts.add(accountId);
    return { accountId };
  }

  private insertKey(input: AddLimitedKeyInput): { accountId: string; publicKey: string } {
    const id = keyId(input.accountId, input.publicKey);
    if (this.keys.has(id)) {
      throw new NearException('NEAR_ACCOUNT_EXISTS', {
        message: `Key ${input.publicKey} is already on ${input.accountId}`,
      });
    }
    const tokens = new Map<string, AllowanceTotals>();
    for (const row of input.tokens ?? []) {
      tokens.set(row.token, { allowance: BigInt(row.allowance), reserved: 0n, spent: 0n });
    }
    this.accounts.add(input.accountId);
    this.keys.set(id, {
      accountId: input.accountId,
      publicKey: input.publicKey,
      receiverId: input.receiverId,
      methodNames: [...input.methodNames],
      gasAllowance: input.allowance,
      gasSpent: '0',
      revoked: false,
      tokens,
    });
    return { accountId: input.accountId, publicKey: input.publicKey };
  }

  private markRevoked(accountId: string, publicKey: string): { revoked: true } {
    this.requireKey(accountId, publicKey).revoked = true;
    return { revoked: true };
  }

  /** A missing pool is not inserted. A positive move on an empty pool already threw. */
  private apply(accountId: string, publicKey: string, token: string, move: AllowanceMove, amount: bigint): KeyStatus {
    const key = this.requireKey(accountId, publicKey);
    if (key.revoked) throw new NearException('NEAR_KEY_REVOKED');
    const current = key.tokens.get(token);
    const basis = current ?? ZERO_ALLOWANCE;
    const next = nextAllowance(basis, move, amount);
    const unchanged = next.reserved === basis.reserved && next.spent === basis.spent;
    if (current && !unchanged) key.tokens.set(token, next);
    return this.view(key);
  }

  private requireKey(accountId: string, publicKey: string): MemKey {
    const key = this.keys.get(keyId(accountId, publicKey));
    if (!key)
      throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No limited key ${publicKey} on ${accountId}` });
    return key;
  }

  private view(key: MemKey): KeyStatus {
    const tokens = [...key.tokens.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([token, row]) => toAllowanceView(token, row));
    return {
      accountId: key.accountId,
      publicKey: key.publicKey,
      revoked: key.revoked,
      receiverId: key.receiverId,
      methodNames: [...key.methodNames],
      tokens,
      gasAllowance: key.gasAllowance,
      gasSpent: key.gasSpent,
    };
  }
}
