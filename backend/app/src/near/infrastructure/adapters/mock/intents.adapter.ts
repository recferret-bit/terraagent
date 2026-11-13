import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { MARKET_TOKENS, tokenKeyOfVerifierId, type MarketTokenKey } from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  IntentsPort,
  type IntentsDepositInput,
  type IntentsExecuteInput,
  type IntentsSimulation,
  type IntentsWithdrawInput,
  type SignedIntent,
  type SignTokenDiffInput,
} from '../../../application/ports/intents.port.js';
import { NearException, type NearErrorCode } from '../../../domain/errors.js';
import { TokenAmount, type ChainReceipt } from '../../../domain/types.js';
import { PRISMA } from '../../../../db/db.module.js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { kekEnv } from '../../../identity/colony-accounts.js';
import { checkBatchStatic, hasDuplicateNonce, netLegs } from '../../../intents/intent-checks.js';
import { mockChainControls } from '../../mock/mock-controls.js';
import { signTokenDiffPayload } from '../../../intents/nep413-token-diff.js';
import { ed25519PrivateKeyFromSeed, KeyStore } from '../../../keystore/keys.js';

import { loadKekRing } from '../../../keystore/kek.js';
import { MOCK_CHAIN_CONFIG, MOCK_CHAIN_RUNTIME, MockChainBase, type MockChainRuntime } from '../../mock/mock-chain.base.js';
import type { MockChainConfig } from '../../mock/mock-chain.config.js';
import { applyLegs, consumeNonce, creditVerifier, debitVerifier, firstShortfall, nonceUsed, verifierBalance, verifierBalances } from './intents-ledger.js';


/**
 * Mock `intents.near` verifier (W13-04). Verifier balances live in `chain.mock_chain_intents_balance`, keyed by verifier token id,
 * in chain base units. `deposit`/`withdraw` amounts are chain base units too (callers convert market atomic units with `toChainUnits`).
 * `signTokenDiff` signs a NEP-413 payload with the colony's custodial key. The account's own balance is `chain.mock_chain_balance` (resources: the cargo ledger, tokenId = ResourceKey;
 * USDC / NEAR: tokenId `USDC` / `NEAR`).
 */
@Injectable()
export class MockIntentsAdapter extends MockChainBase implements IntentsPort {
  private keyStore: KeyStore | null = null;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Optional() @Inject(MOCK_CHAIN_CONFIG) config?: MockChainConfig,
    @Optional() @Inject(MOCK_CHAIN_RUNTIME) runtime?: Partial<MockChainRuntime>,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    super(prisma, config, runtime);
  }

  async deposit(input: IntentsDepositInput): Promise<ChainReceipt> {
    return this.move('mt_transfer_call', input, input.accountId, input.accountId, 'deposit');
  }

  async withdraw(input: IntentsWithdrawInput): Promise<ChainReceipt> {
    return this.move('mt_withdraw', input, input.accountId, input.to, 'withdraw');
  }

  /** Signs with the decrypted custodial colony key (`chain.near_colony_account`). Records nothing: W13-05 consumes the nonce at execute. */
  async signTokenDiff(input: SignTokenDiffInput): Promise<SignedIntent> {
    const row = await this.prisma.nearColonyAccount.findUnique({ where: { accountId: input.accountId } });
    if (!row) throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No custodial key for ${input.accountId}` });
    if (row.encryptedSecret === 'claimed') {
      throw new NearException('NEAR_NOT_OWNER', {
        message: `Account ${input.accountId} is claimed to self-custody; sign intents with your wallet`,
      });
    }
    const seed = this.keys().open(row);
    const nonce = input.nonce ?? randomBytes(32).toString('base64');
    return signTokenDiffPayload(ed25519PrivateKeyFromSeed(seed), row.publicKey, { accountId: input.accountId, deltas: input.deltas }, input.deadlineMs, nonce);
  }

  private keys(): KeyStore {
    this.keyStore ??= new KeyStore(loadKekRing(this.env ? kekEnv(this.env) : { NODE_ENV: 'test' }));
    return this.keyStore;
  }

  /** Read-only: the same checks as `execute` against current state, no writes, no latency. */
  async simulate(intents: readonly SignedIntent[]): Promise<IntentsSimulation> {
    const code = await this.checkAll(this.prisma, intents);
    return { ok: code === null, ...(code === null ? {} : { errorCode: code }), effects: intents.map((i) => i.diff) };
  }

  /**
   * One DB transaction: re-checks everything, consumes every `(signer, nonce)`, records the intents (`mock_chain_intent`, status executed)
   * and applies all legs. Any failure rolls back the whole batch. Idempotent by opId. With `mockChainControls.setOutcomeUnknown('Intents', true)`
   * the batch commits and then `NEAR_UNAVAILABLE` is thrown (test/dev only).
   */
  async execute(input: IntentsExecuteInput): Promise<ChainReceipt> {
    const receipt = await this.call('Intents', 'execute_intents', input.opId, async (tx) => {
      const code = await this.checkAll(tx, input.intents, true);
      if (code !== null) throw new NearException(code, { details: { opId: input.opId } });
      for (const [i, it] of input.intents.entries()) {
        if (!(await consumeNonce(tx, it.diff.accountId, it.nonce, input.opId))) throw new NearException('NEAR_INTENT_NONCE_REUSED', { details: { signer: it.diff.accountId } });
        await tx.mockChainIntent.create({
          data: {
            id: createHash('sha256').update(`${it.diff.accountId}\u0000${it.nonce}`).digest('hex'),
            signer: it.diff.accountId,
            diff: { deltas: it.diff.deltas, nonce: it.nonce, deadlineMs: it.deadlineMs, signature: it.signature },
            status: 'executed',
            opId: i === 0 ? input.opId : null,
          },
        });
      }
      await applyLegs(tx, netLegs(input.intents));
      return { standard: 'intents', event: 'execute_intents', contract_id: 'intents.near', receiverId: 'intents.near', signers: input.intents.map((i) => i.diff.accountId), nonces: input.intents.map((i) => i.nonce) };
    });
    if (mockChainControls.isOutcomeUnknown('Intents')) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'mock outcome-unknown injection: the batch was applied', details: { opId: input.opId } });
    }
    return receipt;
  }

  /** Test/dev only (contract suite, W13-06): registers a custodial signer key for `accountId`. Real adapters have no such method. */
  async testRegisterSigner(accountId: string): Promise<void> {
    const g = this.keys().generate();
    await this.ensureAccount(this.prisma, accountId);
    await this.prisma.nearColonyAccount.upsert({
      where: { accountId },
      create: { accountId, playerId: `contract-${accountId}`, slot: 'contract', ownerAccountId: accountId, publicKey: g.row.publicKey, encryptedSecret: g.row.encryptedSecret, kekVersion: g.row.kekVersion },
      update: {},
    });
  }

  /** Test/dev only: puts `chainAmount` of a verifier token on the account's verifier balance. */
  async testSeedVerifier(accountId: string, verifierId: string, chainAmount: bigint): Promise<void> {
    await this.ensureAccount(this.prisma, accountId);
    await creditVerifier(this.prisma, accountId, verifierId, chainAmount);
  }

  /** Test/dev only: puts `chainAmount` on the account's own balance of a market token key (cargo ledger for resources). */
  async testSeedOwn(accountId: string, tokenKey: string, chainAmount: bigint): Promise<void> {
    await this.credit(this.prisma, accountId, tokenKey, chainAmount.toString());
  }

  /** Static checks, then replayed/duplicate nonces, then balances; first failing code or null. In `execute` the nonce insert itself is the final arbiter. */
  private async checkAll(db: DbClient, intents: readonly SignedIntent[], inTx = false): Promise<NearErrorCode | null> {
    const key = async (accountId: string) => (await db.nearColonyAccount.findUnique({ where: { accountId }, select: { publicKey: true } }))?.publicKey;
    const staticCode = await checkBatchStatic(intents, this.runtime.now(), key);
    if (staticCode === 'NEAR_INTENT_BAD_SIGNATURE' || staticCode === 'NEAR_INTENT_EXPIRED') return staticCode;
    if (hasDuplicateNonce(intents)) return 'NEAR_INTENT_NONCE_REUSED';
    for (const it of intents) if (await nonceUsed(db, it.diff.accountId, it.nonce)) return 'NEAR_INTENT_NONCE_REUSED';
    if (staticCode !== null) return staticCode;
    return !inTx && (await firstShortfall(db, netLegs(intents))) ? 'NEAR_INSUFFICIENT_BALANCE' : null;
  }

  /** Verifier balance in market atomic units (0 when none). */
  verifierBalance(accountId: string, verifierId: string): Promise<bigint> {
    return verifierBalance(this.prisma, accountId, verifierId);
  }

  /** Every non-zero verifier balance of an account by market token key, in market atomic units. */
  verifierBalances(accountId: string): ReturnType<typeof verifierBalances> {
    return verifierBalances(this.prisma, accountId);
  }

  /** deposit: own(`from`) -> verifier(`from`); withdraw: verifier(`from`) -> own(`ownAccount`). One transaction, idempotent by opId. */
  private move(method: string, input: IntentsDepositInput | IntentsWithdrawInput, from: string, ownAccount: string, dir: 'deposit' | 'withdraw'): Promise<ChainReceipt> {
    const key = this.assertInput(input.tokenId, input.amount);
    const chainAmount = BigInt(input.amount);
    const verifierId = MARKET_TOKENS[key].verifierId;
    return this.call('Intents', method, input.opId, async (tx) => {
      if (dir === 'deposit') {
        await this.debit(tx, ownAccount, key, chainAmount.toString());
        await creditVerifier(tx, from, verifierId, chainAmount);
      } else {
        await debitVerifier(tx, from, verifierId, chainAmount);
        await this.credit(tx, ownAccount, key, chainAmount.toString());
      }
      return {
        standard: 'nep245',
        event: method,
        contract_id: 'intents.near',
        receiverId: 'intents.near',
        signerId: input.accountId,
        sender_id: dir === 'deposit' ? input.accountId : 'intents.near',
        receiver_id: dir === 'deposit' ? 'intents.near' : ownAccount,
        token_ids: [verifierId],
        amounts: [chainAmount.toString()],
      };
    });
  }

  private assertInput(tokenId: string, amount: string): MarketTokenKey {
    const key = tokenKeyOfVerifierId(tokenId);
    if (key === null) throw new NearException('NEAR_NFT_INVALID', { message: `Unknown verifier token id "${tokenId}"` });
    if (!TokenAmount.safeParse(amount).success || BigInt(amount) <= 0n) {
      throw new NearException('NEAR_NFT_INVALID', { message: `Invalid intents amount "${amount}"` });
    }
    return key;
  }
}

export const adapter = adapterOf({ port: IntentsPort, kind: 'mock', useClass: MockIntentsAdapter });
