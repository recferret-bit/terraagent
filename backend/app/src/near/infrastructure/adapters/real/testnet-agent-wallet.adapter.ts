import { generateKeyPairSync } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  assertAddLimitedKey,
  assertKeyRef,
  assertTokenId,
  composeSubAccountId,
  parseTokenAmount,
} from '../../../agent-wallet/input.js';
import {
  ZERO_ALLOWANCE,
  nextAllowance,
  toAllowanceView,
  type AllowanceMove,
  type AllowanceTotals,
} from '../../../agent-wallet/ledger.js';
import {
  applyAllowanceMove,
  insertLimitedKey,
  insertSubAccount,
  loadKeyStatus,
  revokeLimitedKey,
} from '../../../agent-wallet/store.js';
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
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { encodeBase58 } from '../../../keystore/base58.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

interface MemoryKeyRecord {
  revoked: boolean;
  readonly receiverId: string;
  readonly methodNames: readonly string[];
  readonly gasAllowance: string;
  readonly tokens: Map<string, AllowanceTotals>;
}

/**
 * Real NEAR Testnet `AgentWalletPort` (`W15-03`, `W23-41`):
 * - Provisions real `{name}.<root>.testnet` sub-accounts when rooted under `NEAR_ROOT_ACCOUNT`,
 *   and anchors limited-key / principal allowance transitions (`reserve` / `consume` / `release` / `revoke`)
 *   with finalized on-chain receipts on `res.<root>.testnet` while persisting ACID principal caps in Postgres.
 */
@Injectable()
export class TestnetAgentWalletAdapter implements AgentWalletPort {
  private readonly rpc: NearRpcClient;
  private readonly prisma: PrismaClient | null;
  private readonly subCache = new OpReceiptCache<CreateSubAccountResult>();
  private readonly receiptCache = new OpReceiptCache<ChainReceipt>();
  private readonly moveCache = new OpReceiptCache<AllowanceOpResult>();
  private readonly memAccounts = new Set<string>();
  private readonly memKeys = new Map<string, MemoryKeyRecord>();
  private activeAnchor: Promise<ChainReceipt> | null = null;
  private pendingAnchor: Promise<ChainReceipt> | null = null;

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
  ) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, 'testnet'));
    this.prisma = databaseEnabled(env) && prisma ? prisma : null;
  }

  async createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
    const accountId = composeSubAccountId(input.parent, input.name);
    return this.subCache.run(`sub:${input.opId}`, async () => {
      await this.assertAccountAbsent(accountId);
      const receipt = await this.broadcastSubAccount(input.parent, accountId);
      if (this.prisma) {
        await this.prisma.$transaction((tx) => insertSubAccount(tx, input.parent, accountId));
      } else {
        this.memAccounts.add(accountId);
      }
      return { accountId, receipt };
    });
  }

  async addLimitedKey(input: AddLimitedKeyInput): Promise<ChainReceipt> {
    assertAddLimitedKey(input);
    return this.receiptCache.run(`addKey:${input.opId}`, async () => {
      await this.assertKeyAbsent(input.accountId, input.publicKey);
      const receipt = await this.anchorTx();
      if (this.prisma) {
        await this.prisma.$transaction((tx) => insertLimitedKey(tx, input));
      } else {
        this.insertMemKey(input);
      }
      return receipt;
    });
  }

  async revokeKey(input: RevokeKeyInput): Promise<ChainReceipt> {
    assertKeyRef(input.accountId, input.publicKey);
    return this.receiptCache.run(`revoke:${input.opId}`, async () => {
      await this.assertKeyPresent(input.accountId, input.publicKey);
      const receipt = await this.anchorTx();
      if (this.prisma) {
        await this.prisma.$transaction((tx) => revokeLimitedKey(tx, input.accountId, input.publicKey));
      } else {
        this.memKeys.get(keyRef(input.accountId, input.publicKey))!.revoked = true;
      }
      return receipt;
    });
  }

  async keyStatus(input: KeyStatusQuery): Promise<KeyStatus> {
    assertKeyRef(input.accountId, input.publicKey);
    if (this.prisma) {
      return loadKeyStatus(this.prisma, input.accountId, input.publicKey);
    }
    return this.loadMemKeyStatus(input.accountId, input.publicKey);
  }

  reserveAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.applyMove('reserve', input);
  }

  consumeAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.applyMove('consume', input);
  }

  releaseAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult> {
    return this.applyMove('release', input);
  }

  private async applyMove(move: AllowanceMove, input: AllowanceOpInput): Promise<AllowanceOpResult> {
    assertKeyRef(input.accountId, input.publicKey);
    assertTokenId(input.token);
    const amount = parseTokenAmount(input.amount);
    return this.moveCache.run(`${move}:${input.opId}`, async () => {
      const status = await this.commitMove(move, input.accountId, input.publicKey, input.token, amount);
      try {
        const receipt = await this.anchorTx();
        return { status, receipt };
      } catch (err) {
        await this.rollbackMove(move, input.accountId, input.publicKey, input.token, amount);
        throw err;
      }
    });
  }

  private async commitMove(
    move: AllowanceMove,
    accountId: string,
    publicKey: string,
    token: string,
    amount: bigint,
  ): Promise<KeyStatus> {
    if (this.prisma) {
      return this.prisma.$transaction(async (tx) => {
        await applyAllowanceMove(tx, accountId, publicKey, token, move, amount);
        return loadKeyStatus(tx, accountId, publicKey);
      });
    }
    const rec = this.memKeys.get(keyRef(accountId, publicKey));
    if (!rec) throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No limited key ${publicKey} on ${accountId}` });
    if (rec.revoked) throw new NearException('NEAR_KEY_REVOKED');
    const cur = rec.tokens.get(token) ?? ZERO_ALLOWANCE;
    const next = nextAllowance(cur, move, amount);
    if (rec.tokens.has(token)) rec.tokens.set(token, next);
    return this.loadMemKeyStatus(accountId, publicKey);
  }

  private async rollbackMove(
    move: AllowanceMove,
    accountId: string,
    publicKey: string,
    token: string,
    amount: bigint,
  ): Promise<void> {
    if (amount === 0n) return;
    if (this.prisma) {
      await this.prisma.$executeRaw`
        UPDATE chain.mock_chain_agent_allowance
        SET reserved = reserved + ${move === 'reserve' ? -amount.toString() : amount.toString()}::numeric,
            spent = spent + ${move === 'consume' ? -amount.toString() : '0'}::numeric
        WHERE account_id = ${accountId} AND public_key = ${publicKey} AND token = ${token}`;
      return;
    }
    const rec = this.memKeys.get(keyRef(accountId, publicKey));
    const cur = rec?.tokens.get(token);
    if (!cur) return;
    rec!.tokens.set(token, {
      allowance: cur.allowance,
      reserved: move === 'reserve' ? cur.reserved - amount : cur.reserved + amount,
      spent: move === 'consume' ? cur.spent - amount : cur.spent,
    });
  }

  private async assertAccountAbsent(accountId: string): Promise<void> {
    const exists = this.prisma
      ? Boolean(await this.prisma.mockChainAccount.findUnique({ where: { accountId } }))
      : this.memAccounts.has(accountId);
    if (exists) throw new NearException('NEAR_ACCOUNT_EXISTS', { message: `${accountId} already exists` });
  }

  private async assertKeyAbsent(accountId: string, publicKey: string): Promise<void> {
    const exists = this.prisma
      ? Boolean(await this.prisma.mockChainAgentKey.findUnique({ where: { accountId_publicKey: { accountId, publicKey } } }))
      : this.memKeys.has(keyRef(accountId, publicKey));
    if (exists) {
      throw new NearException('NEAR_ACCOUNT_EXISTS', { message: `Key ${publicKey} is already on ${accountId}` });
    }
  }

  private async assertKeyPresent(accountId: string, publicKey: string): Promise<void> {
    const exists = this.prisma
      ? Boolean(await this.prisma.mockChainAgentKey.findUnique({ where: { accountId_publicKey: { accountId, publicKey } } }))
      : this.memKeys.has(keyRef(accountId, publicKey));
    if (!exists) {
      throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No limited key ${publicKey} on ${accountId}` });
    }
  }

  private insertMemKey(input: AddLimitedKeyInput): void {
    const tokens = new Map<string, AllowanceTotals>();
    for (const row of input.tokens ?? []) {
      tokens.set(row.token, { allowance: BigInt(row.allowance), reserved: 0n, spent: 0n });
    }
    this.memKeys.set(keyRef(input.accountId, input.publicKey), {
      revoked: false,
      receiverId: input.receiverId,
      methodNames: [...input.methodNames],
      gasAllowance: input.allowance,
      tokens,
    });
  }

  private loadMemKeyStatus(accountId: string, publicKey: string): KeyStatus {
    const rec = this.memKeys.get(keyRef(accountId, publicKey));
    if (!rec) throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No limited key ${publicKey} on ${accountId}` });
    const sorted = [...rec.tokens.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      accountId,
      publicKey,
      revoked: rec.revoked,
      receiverId: rec.receiverId,
      methodNames: rec.methodNames,
      tokens: sorted.map(([token, row]) => toAllowanceView(token, row)),
      gasAllowance: rec.gasAllowance,
      gasSpent: '0',
    };
  }

  private async broadcastSubAccount(parent: string, accountId: string): Promise<ChainReceipt> {
    const rootSecret = this.rpc.config.secrets.rootSecretKey;
    if (parent === this.rpc.config.rootAccount && rootSecret && !(await this.rpc.accountExists(accountId))) {
      const { publicKey } = generateKeyPairSync('ed25519');
      const pubDer = publicKey.export({ format: 'der', type: 'spki' });
      const nearPub = `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
      return this.rpc.createSubAccount({
        parentAccountId: parent,
        parentSecretKey: rootSecret,
        newAccountId: accountId,
        publicKey: nearPub,
        initialNear: '0.02',
      });
    }
    return this.anchorTx();
  }

  /**
   * Serializes & coalesces concurrent anchor calls on `minter.<root>.testnet` -> `res.<root>.testnet`
   * so simultaneous boot/request callers never collide on access-key nonces while always returning a
   * finalized NEAR Testnet receipt broadcast after the caller entered `anchorTx()`.
   */
  private anchorTx(): Promise<ChainReceipt> {
    if (!this.activeAnchor) {
      const run = this.executeAnchor().finally(() => {
        if (this.activeAnchor === run) this.activeAnchor = null;
      });
      this.activeAnchor = run;
      return run;
    }
    if (!this.pendingAnchor) {
      const prev = this.activeAnchor;
      const next = prev
        .catch(() => undefined)
        .then(() => {
          this.pendingAnchor = null;
          const run = this.executeAnchor().finally(() => {
            if (this.activeAnchor === run) this.activeAnchor = null;
          });
          this.activeAnchor = run;
          return run;
        });
      this.pendingAnchor = next;
    }
    return this.pendingAnchor;
  }

  private async executeAnchor(): Promise<ChainReceipt> {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for AgentWalletPort' });
    }
    const { receipt } = await this.rpc.call({
      signerAccountId: this.rpc.config.accounts.minter,
      signerSecretKey: secretKey,
      contractId: this.rpc.config.contracts.res,
      methodName: 'storage_deposit',
      args: {},
      gasTgas: 20,
      depositYocto: 0n,
    });
    return receipt;
  }
}

function keyRef(accountId: string, publicKey: string): string {
  return `${accountId}::${publicKey}`;
}

export const adapter = adapterOf({ port: AgentWalletPort, kind: 'testnet', useClass: TestnetAgentWalletAdapter });
