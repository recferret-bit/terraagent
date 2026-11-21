import {
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
import { bigOf, type ActionEffects } from './action-effects.js';
import type { ActionFinisher, OpNonce } from './action-finisher.js';
import type { PerksView } from './perks-view.js';
import type { WalletBalances } from './wallet-balances.js';

type Signed<T> = T & { readonly signature?: Nep413Signature };

export interface WalletStakeDeps {
  readonly staking: StakingPort;
  readonly balances: WalletBalances;
  readonly finisher: ActionFinisher;
  readonly nonce: OpNonce;
  readonly perks: PerksView;
  readonly effects: ActionEffects;
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
    await this.d.effects.record('stake', { accountId, pool: input.pool, txHash: receipt.txHash, opId }, asset, BigInt(amount));
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
    const extras = await this.d.effects.unstaked({ accountId, pool: input.pool, txHash: receipt.txHash, opId }, BigInt(amount), before, input.asset);
    return this.respond(receipt.txHash, accountId, input.pool, extras);
  }

  async withdraw(input: Signed<WithdrawRequest & { readonly amount?: string }>): Promise<StakingActionResponse> {
    const accountId = requireWalletAccount(input.accountId);
    const sig = input.walletSignature ?? input.signature;
    await this.verify('withdraw', accountId, sig, input.pool, input.amount);
    const opId = input.opId?.trim() || withdrawOpId(accountId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const before = await this.d.staking.position({ accountId, pool: input.pool });
    // One step: the matured principal (and any accrued yield) lands straight in the wallet. The adapter runs first so a
    // retry of a finished op id replays its stored receipt; only its "nothing to pay" refusal becomes NOTHING_TO_WITHDRAW.
    const receipt = await this.d.staking
      .withdraw({ opId, accountId, toAccountId: accountId, pool: input.pool })
      .catch((err: unknown) => {
        if (err instanceof NearException && err.errorCode === 'STAKE_INSUFFICIENT_BALANCE' && bigOf(before.withdrawable) <= 0n) {
          throw new NearException('NOTHING_TO_WITHDRAW', {
            details: { accountId, pool: input.pool, unbonding: before.unbonding, unbondingReadyAtMs: before.unbondingReadyAtMs },
          });
        }
        throw err;
      });
    await this.d.effects.withdrawn({ accountId, pool: input.pool, txHash: receipt.txHash, opId }, before);
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
    // The adapter refuses an empty position itself (`NOTHING_TO_COMPOUND`), so a retry of a finished op id still replays.
    const receipt = await this.d.staking.compound({ opId, accountId, pool: input.pool });
    const after = await this.d.staking.position({ accountId, pool: input.pool });
    const compounded = bigOf(after.staked) - bigOf(before.staked);
    await this.d.effects.record('compound', { accountId, pool: input.pool, txHash: receipt.txHash, opId }, after.asset ?? 'near', compounded);
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
