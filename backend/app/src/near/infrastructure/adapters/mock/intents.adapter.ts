import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { MARKET_TOKENS, tokenKeyOfVerifierId, type MarketTokenKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
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
import { NearException } from '../../../domain/errors.js';
import { TokenAmount, type ChainReceipt } from '../../../domain/types.js';
import { PRISMA } from '../../../../db/db.module.js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { kekEnv } from '../../../identity/colony-accounts.js';
import { signTokenDiffPayload } from '../../../intents/nep413-token-diff.js';
import { ed25519PrivateKeyFromSeed, KeyStore } from '../../../keystore/keys.js';

import { loadKekRing } from '../../../keystore/kek.js';
import { MOCK_CHAIN_CONFIG, MOCK_CHAIN_RUNTIME, MockChainBase, type MockChainRuntime } from '../../mock/mock-chain.base.js';
import type { MockChainConfig } from '../../mock/mock-chain.config.js';
import { creditVerifier, debitVerifier, verifierBalance, verifierBalances } from './intents-ledger.js';

const NOT_YET = 'not implemented until W13-05';

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
    const seed = this.keys().open(row);
    const nonce = input.nonce ?? randomBytes(32).toString('base64');
    return signTokenDiffPayload(ed25519PrivateKeyFromSeed(seed), row.publicKey, { accountId: input.accountId, deltas: input.deltas }, input.deadlineMs, nonce);
  }

  private keys(): KeyStore {
    this.keyStore ??= new KeyStore(loadKekRing(this.env ? kekEnv(this.env) : { NODE_ENV: 'test' }));
    return this.keyStore;
  }

  simulate(_intents: readonly SignedIntent[]): Promise<IntentsSimulation> {
    return Promise.reject(new NearException('NEAR_UNAVAILABLE', { message: NOT_YET }));
  }

  execute(_input: IntentsExecuteInput): Promise<ChainReceipt> {
    return Promise.reject(new NearException('NEAR_UNAVAILABLE', { message: NOT_YET }));
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
