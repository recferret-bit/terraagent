import {
  earlyExitFeeBp,
  StakingActionResponse,
  STAKING_RULES,
  type Nep413Signature,
  type StakeRequest,
  type StakingPositionDto,
  type UnstakeRequest,
  type WithdrawRequest,
  type CompoundYieldRequest,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { StakingPort, type StakingPositionView } from '../../application/ports/staking.port.js';
import { NearException } from '../../domain/errors.js';
import type { AccountClaimStatus } from '../account-claim.service.js';
import { verifyStakingWalletSignature, type FullAccessKeyVerifier, type StakingSignableAction } from '../staking-signature-guard.js';
import { nearToYocto, stakeOpId, unstakeOpId, withdrawOpId, yoctoToNear } from '../yocto.js';
import type { ActionFinisher, OpNonce } from './action-finisher.js';
import type { PerksView } from './perks-view.js';
import { stakingNowMs } from './port-hooks.js';
import type { StakingTxWriter } from './staking-tx.writer.js';
import type { WalletBalances } from './wallet-balances.js';

type Signed<T> = T & { readonly signature?: Nep413Signature };

export interface WalletStakeDeps {
  readonly staking: StakingPort;
  readonly balances: WalletBalances;
  readonly finisher: ActionFinisher;
  readonly nonce: OpNonce;
  readonly perks: PerksView;
  readonly txs: StakingTxWriter;
  readonly env: () => Record<string, string | undefined>;
  readonly db: () => PrismaClient | null;
  readonly keyVerifier?: FullAccessKeyVerifier;
}

/** The wallet is its own claim: nothing to claim, the NEP-413 signature must come from this very account. */
export const walletClaimOf = (accountId: string): AccountClaimStatus => ({
  claimed: true,
  accountId,
  claimedAt: null,
  claimedByAccountId: accountId,
  claimedPublicKey: null,
});

/** The wallet account a request names; an empty one is `WALLET_REQUIRED` (there is no deed to fall back to). */
export function requireWalletAccount(accountId: string | undefined): string {
  const id = accountId?.trim();
  if (!id) throw new NearException('WALLET_REQUIRED', { details: { field: 'accountId' } });
  return id;
}

const bigOf = (raw: string | undefined | null): bigint => BigInt(raw || '0');

/**
 * `W28` wallet-first staking: stake / unstake / withdraw / compound by wallet `accountId` with zero colonies, so there is
 * no `DEED_NOT_FOUND` and no `ACCOUNT_NOT_CLAIMED` gate. Control of the wallet is proven by the caller before this runs
 * (session link) and, on real networks, by a NEP-413 signature verified here. Every action writes its `StakingTx` rows
 * and answers with the refreshed V2 perks, so a tier change (an unstake drops it at once) shows immediately.
 */
export class WalletStakeFlow {
  constructor(private readonly d: WalletStakeDeps) {}

  async stake(input: Signed<StakeRequest>): Promise<StakingActionResponse> {
    const accountId = requireWalletAccount(input.accountId);
    const sig = input.walletSignature ?? input.signature;
    await this.verify('stake', accountId, sig, input.pool, input.amount);
    const asset = input.asset ?? 'near';
    const amount = nearToYocto(input.amount);
    const opId = input.opId?.trim() || stakeOpId(accountId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const receipt = await this.d.staking.stake({ opId, accountId, pool: input.pool, amount, asset });
    await this.record('stake', accountId, input.pool, asset, BigInt(amount), receipt.txHash, opId);
    return this.respond(receipt.txHash, accountId, input.pool);
  }

  async unstake(input: Signed<UnstakeRequest>): Promise<StakingActionResponse> {
    const accountId = requireWalletAccount(input.accountId);
    const sig = input.walletSignature ?? input.signature;
    await this.verify('unstake', accountId, sig, input.pool, input.amount);
    const amount = nearToYocto(input.amount);
    const opId = input.opId?.trim() || unstakeOpId(accountId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const before = await this.d.staking.position({ accountId, pool: input.pool });
    const receipt = await this.d.staking.unstake({ opId, accountId, pool: input.pool, amount });
    const after = await this.d.staking.position({ accountId, pool: input.pool });
    // `< 7 days` after the last deposit the adapter keeps `earlyExitFeeBp` of the unstaked principal for the protocol.
    const feeBp = earlyExitFeeBp(before.lastStakedAtMs ?? null, stakingNowMs(this.d.staking));
    const fee = (BigInt(amount) * BigInt(feeBp)) / 10_000n;
    await this.record('unstake', accountId, input.pool, after.asset ?? 'near', BigInt(amount), receipt.txHash, opId);
    if (fee > 0n) await this.record('early_exit_fee', accountId, input.pool, after.asset ?? 'near', fee, receipt.txHash, opId);
    return this.respond(receipt.txHash, accountId, input.pool, {
      earlyExitFeeBp: feeBp,
      earlyExitFeeNear: yoctoToNear(fee, 6),
    });
  }

  async withdraw(input: Signed<WithdrawRequest & { readonly amount?: string }>): Promise<StakingActionResponse> {
    const accountId = requireWalletAccount(input.accountId);
    const sig = input.walletSignature ?? input.signature;
    await this.verify('withdraw', accountId, sig, input.pool, input.amount);
    const opId = input.opId?.trim() || withdrawOpId(accountId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const before = await this.d.staking.position({ accountId, pool: input.pool });
    if (bigOf(before.withdrawable) <= 0n) {
      throw new NearException('NOTHING_TO_WITHDRAW', {
        details: { accountId, pool: input.pool, unbonding: before.unbonding, unbondingReadyAtMs: before.unbondingReadyAtMs },
      });
    }
    // One step: the matured principal (and any accrued yield) lands straight in the wallet.
    const receipt = await this.d.staking.withdraw({ opId, accountId, toAccountId: accountId, pool: input.pool });
    const paid = bigOf(before.withdrawable) + bigOf(before.rewards);
    await this.record('withdraw', accountId, input.pool, before.asset ?? 'near', paid, receipt.txHash, opId);
    return this.respond(receipt.txHash, accountId, input.pool);
  }

  async compound(input: Signed<CompoundYieldRequest>): Promise<StakingActionResponse> {
    const accountId = requireWalletAccount(input.accountId);
    const sig = input.walletSignature ?? input.signature;
    await this.verify('compound', accountId, sig, input.pool);
    if (!this.d.staking.compound) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'This staking adapter does not support compounding.' });
    }
    const opId = input.opId?.trim() || `compound:${accountId}:${input.pool}:${sig?.nonce ?? this.d.nonce.next()}`;
    const before = await this.d.staking.position({ accountId, pool: input.pool });
    if (bigOf(before.rewards) <= 0n) {
      throw new NearException('NOTHING_TO_COMPOUND', { details: { accountId, pool: input.pool } });
    }
    const receipt = await this.d.staking.compound({ opId, accountId, pool: input.pool });
    const after = await this.d.staking.position({ accountId, pool: input.pool });
    const compounded = bigOf(after.staked) - bigOf(before.staked);
    await this.record('compound', accountId, input.pool, after.asset ?? 'near', compounded, receipt.txHash, opId);
    return this.respond(receipt.txHash, accountId, input.pool, { compoundedNear: yoctoToNear(compounded, 6) });
  }

  /** Position, wallet balance and refreshed perks of a finished action. */
  async respond(
    txHash: string,
    accountId: string,
    pool: string,
    extras: Partial<Pick<StakingActionResponse, 'earlyExitFeeBp' | 'earlyExitFeeNear' | 'compoundedNear'>> = {},
  ): Promise<StakingActionResponse> {
    const position = await this.d.finisher.positionAfter(accountId, pool);
    const walletBalanceNear = await this.d.balances.readNear(accountId);
    const perks = await this.d.perks.evaluate({
      accountId,
      grossApyBp: position.apyBp ?? STAKING_RULES.simGrossApyBp,
      positions: [position as StakingPositionDto],
    });
    return StakingActionResponse.parse({ txHash, position, walletBalanceNear, perks, ...extras });
  }

  private record(
    kind: Parameters<StakingTxWriter['record']>[0]['kind'],
    accountId: string,
    poolId: string,
    asset: string,
    amountYocto: bigint,
    txHash: string,
    opId: string,
  ): Promise<void> {
    return this.d.txs.record({ kind, accountId, poolId, asset, amountYocto, txHash, opId, atMs: stakingNowMs(this.d.staking) });
  }

  private verify(
    action: StakingSignableAction,
    accountId: string,
    sig: Nep413Signature | undefined,
    poolId: string,
    amount?: string | number,
  ): Promise<void> {
    return verifyStakingWalletSignature({
      sig,
      action,
      colonyId: accountId,
      claimInfo: walletClaimOf(accountId),
      poolId,
      amount,
      envMap: this.d.env(),
      keyVerifier: this.d.keyVerifier,
      prisma: this.d.db(),
    });
  }
}

export type { StakingPositionView };
