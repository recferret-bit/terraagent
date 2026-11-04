import { Injectable } from '@nestjs/common';
import { MARKET_TOKENS, tokenKeyOfVerifierId, toChainUnits, type MarketTokenKey } from '@terra/contracts';
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
import { MockChainBase } from '../../mock/mock-chain.base.js';
import { creditVerifier, debitVerifier, verifierBalance, verifierBalances } from './intents-ledger.js';

const NOT_YET = 'not implemented until W13-05/W13-07';

/**
 * Mock `intents.near` verifier (W13-04). Verifier balances live in `chain.mock_chain_intents_balance`, keyed by verifier token id,
 * in chain base units. `deposit`/`withdraw` take amounts in **market atomic units** (whole units for resources, micro-USDC, yocto-NEAR),
 * converted with `toChainUnits`. The account's own balance is `chain.mock_chain_balance` (resources: the cargo ledger, tokenId = ResourceKey;
 * USDC / NEAR: tokenId `USDC` / `NEAR`).
 */
@Injectable()
export class MockIntentsAdapter extends MockChainBase implements IntentsPort {
  async deposit(input: IntentsDepositInput): Promise<ChainReceipt> {
    return this.move('mt_transfer_call', input, input.accountId, input.accountId, 'deposit');
  }

  async withdraw(input: IntentsWithdrawInput): Promise<ChainReceipt> {
    return this.move('mt_withdraw', input, input.accountId, input.to, 'withdraw');
  }

  signTokenDiff(_input: SignTokenDiffInput): Promise<SignedIntent> {
    return Promise.reject(new NearException('NEAR_UNAVAILABLE', { message: NOT_YET }));
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
    const chainAmount = toChainUnits(key, input.amount);
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
