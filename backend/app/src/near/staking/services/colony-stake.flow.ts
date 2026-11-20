import {
  StakingActionResponse,
  type EvaluatedStakerPerksV2,
  type Nep413Signature,
  type StakeRequest,
  type StakingPositionDto,
  type UnstakeRequest,
  type WithdrawRequest,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { StakingPort } from '../../application/ports/staking.port.js';
import { DeedTelemetryService } from '../../deed/deed-telemetry.service.js';
import { DeedRepository, type StoredDeedRecord } from '../../deed/deed.repository.js';
import { NearException } from '../../domain/errors.js';
import { AccountClaimService, type AccountClaimStatus } from '../account-claim.service.js';
import { verifyStakingWalletSignature, type FullAccessKeyVerifier, type StakingSignableAction } from '../staking-signature-guard.js';
import { CLAIM_ACCOUNT_PATH, nearToYocto, stakeOpId, unstakeOpId, withdrawOpId } from '../yocto.js';
import type { ActionEffects, EffectRef, UnstakeExtras } from './action-effects.js';
import type { ActionFinisher, OpNonce } from './action-finisher.js';
import type { WalletBalances } from './wallet-balances.js';

type Signed<T> = T & { readonly signature?: Nep413Signature };

const ref = (accountId: string, pool: string, txHash: string, opId: string): EffectRef => ({ accountId, pool, txHash, opId });

export interface ColonyStakeDeps {
  readonly staking: StakingPort;
  readonly deeds: DeedRepository;
  readonly claimService: AccountClaimService;
  readonly balances: WalletBalances;
  readonly finisher: ActionFinisher;
  readonly nonce: OpNonce;
  readonly env: () => Record<string, string | undefined>;
  readonly db: () => PrismaClient | null;
  /** V2 perks of the staking wallet while `W28` is on (undefined with it off, so the W20 response is unchanged). */
  readonly perksAfter?: (accountId: string, position: StakingPositionDto) => Promise<EvaluatedStakerPerksV2 | undefined>;
  /** `W28` history rows and the early-exit fee, shared with the wallet flow; used only while `W28` is on. */
  readonly effects: ActionEffects;
  readonly isW28: () => boolean;
  readonly telemetry?: DeedTelemetryService;
  readonly keyVerifier?: FullAccessKeyVerifier;
}

/**
 * The W20 colony staking path, unchanged (`W20-18`, `NEAR-92`, `D-18`), and the path while `W28` is off:
 * 1. the target Colony Deed must exist (`DEED_NOT_FOUND`, 404; day-1 staking does not wait for `Settled`),
 * 2. the colony NEAR account must be claimed by the player (`ACCOUNT_NOT_CLAIMED`, 409 with `claimUrl`),
 * 3. the pool must be whitelisted and the stake must come from the player's own NEAR balance, never from game funds.
 */
export class ColonyStakeFlow {
  constructor(private readonly d: ColonyStakeDeps) {}

  async stake(input: Signed<StakeRequest>): Promise<StakingActionResponse> {
    const { deed, claimInfo } = await this.requireSettledAndClaimed(input.colonyId);
    const sig = input.walletSignature ?? input.signature;
    await this.verifySignature('stake', deed.colonyId, sig, claimInfo, input.pool, input.amount);
    const amountYocto = nearToYocto(input.amount);
    const opId = input.opId?.trim() || stakeOpId(deed.colonyId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const payerAccountId = await this.d.balances.pickPayer(
      [claimInfo.accountId, deed.accountId, claimInfo.claimedByAccountId],
      BigInt(amountYocto),
    );
    const receipt = await this.d.staking.stake({
      opId,
      accountId: claimInfo.accountId,
      pool: input.pool,
      amount: amountYocto,
      ...(payerAccountId !== claimInfo.accountId ? { walletAccountId: payerAccountId } : {}),
    });
    this.d.telemetry?.recordTx('stake');
    if (this.d.isW28()) {
      await this.d.effects.record('stake', ref(claimInfo.accountId, input.pool, receipt.txHash, opId), 'near', BigInt(amountYocto));
    }
    return this.respond(receipt.txHash, deed, claimInfo, input.pool);
  }

  async unstake(input: Signed<UnstakeRequest>): Promise<StakingActionResponse> {
    const { deed, claimInfo } = await this.requireSettledAndClaimed(input.colonyId);
    const sig = input.walletSignature ?? input.signature;
    await this.verifySignature('unstake', deed.colonyId, sig, claimInfo, input.pool, input.amount);
    const opId = input.opId?.trim() || unstakeOpId(deed.colonyId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const amountYocto = nearToYocto(input.amount);
    const before = this.d.isW28() ? await this.d.staking.position({ accountId: claimInfo.accountId, pool: input.pool }) : null;
    const receipt = await this.d.staking.unstake({ opId, accountId: claimInfo.accountId, pool: input.pool, amount: amountYocto });
    const extras = before
      ? await this.d.effects.unstaked(ref(claimInfo.accountId, input.pool, receipt.txHash, opId), BigInt(amountYocto), before)
      : undefined;
    return this.respond(receipt.txHash, deed, claimInfo, input.pool, extras);
  }

  async withdraw(input: Signed<WithdrawRequest & { readonly amount?: string }>): Promise<StakingActionResponse> {
    const { deed, claimInfo } = await this.requireSettledAndClaimed(input.colonyId);
    const sig = input.walletSignature ?? input.signature;
    await this.verifySignature('withdraw', deed.colonyId, sig, claimInfo, input.pool, input.amount);
    const opId = input.opId?.trim() || withdrawOpId(deed.colonyId, input.pool, sig?.nonce ?? this.d.nonce.next());
    const before = this.d.isW28() ? await this.d.staking.position({ accountId: claimInfo.accountId, pool: input.pool }) : null;
    const receipt = await this.d.staking.withdraw({
      opId,
      accountId: claimInfo.accountId,
      toAccountId: claimInfo.claimedByAccountId ?? claimInfo.accountId,
      pool: input.pool,
    });
    if (before) await this.d.effects.withdrawn(ref(claimInfo.accountId, input.pool, receipt.txHash, opId), before);
    return this.respond(receipt.txHash, deed, claimInfo, input.pool);
  }

  async requireSettledAndClaimed(colonyId?: string): Promise<{ deed: StoredDeedRecord; claimInfo: AccountClaimStatus }> {
    const deed = await this.resolveDeed(colonyId);
    if (!deed) {
      throw new NearException('DEED_NOT_FOUND', {
        status: 404,
        message: 'Colony Deed not found.',
        details: { colonyId: colonyId ?? 'col_0' },
      });
    }
    const claimInfo = await this.d.claimService.isAccountClaimed(deed.colonyId, deed.accountId);
    if (!claimInfo.claimed) {
      throw new NearException('ACCOUNT_NOT_CLAIMED', {
        status: 409,
        message: 'Claim your colony account before staking NEAR.',
        details: { colonyId: deed.colonyId, accountId: deed.accountId, claimUrl: CLAIM_ACCOUNT_PATH },
      });
    }
    return { deed, claimInfo };
  }

  async resolveDeed(colonyId?: string): Promise<StoredDeedRecord | null> {
    const trimmed = colonyId?.trim();
    if (trimmed) {
      const direct = await this.d.deeds.findByColonyId(trimmed);
      if (direct) return direct;
      const byToken = await this.d.deeds.findByTokenId(trimmed);
      if (byToken) return byToken;
      if (trimmed === 'col_0' || trimmed === '0') return (await this.d.deeds.listAll())[0] ?? null;
      return null;
    }
    const defaultColony = await this.d.deeds.findByColonyId('col_0');
    if (defaultColony) return defaultColony;
    return (await this.d.deeds.listAll())[0] ?? null;
  }

  private async respond(
    txHash: string,
    deed: StoredDeedRecord,
    claimInfo: AccountClaimStatus,
    pool: string,
    extras?: UnstakeExtras,
  ): Promise<StakingActionResponse> {
    const position = await this.d.finisher.positionAfter(claimInfo.accountId, pool, deed.colonyId);
    const walletBalanceNear = await this.d.balances.readNear([claimInfo.accountId, deed.accountId, claimInfo.claimedByAccountId]);
    const perks = await this.d.perksAfter?.(claimInfo.accountId, position);
    return StakingActionResponse.parse({ txHash, position, walletBalanceNear, ...(perks ? { perks } : {}), ...extras });
  }

  private verifySignature(
    action: StakingSignableAction,
    colonyId: string,
    sig: Nep413Signature | undefined,
    claimInfo: AccountClaimStatus,
    poolId: string,
    amount?: string | number,
  ): Promise<void> {
    return verifyStakingWalletSignature({
      sig,
      action,
      colonyId,
      claimInfo,
      poolId,
      amount,
      envMap: this.d.env(),
      keyVerifier: this.d.keyVerifier,
      prisma: this.d.db(),
    });
  }
}
