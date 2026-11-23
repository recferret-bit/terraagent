import { earlyExitFeeBp, type StakingActionResponse } from '@terra/contracts';
import { StakingPort, type StakingPositionView } from '../../application/ports/staking.port.js';
import { resolveStakingTimings } from '../local-staking-timings.js';
import { isW28Enabled } from '../perks/legacy-ladder.js';
import { yoctoToNear } from '../yocto.js';
import { stakingNowMs } from './port-hooks.js';
import type { StakingTxEntry, StakingTxKind, StakingTxWriter } from './staking-tx.writer.js';

export const bigOf = (raw: string | undefined | null): bigint => BigInt(raw || '0');

export interface EffectRef {
  readonly accountId: string;
  readonly pool: string;
  readonly txHash: string;
  readonly opId: string;
}

export type UnstakeExtras = Required<Pick<StakingActionResponse, 'earlyExitFeeBp' | 'earlyExitFeeNear'>>;

/**
 * What a finished `W28` action leaves behind, shared by the wallet flow and the colony-scoped flow while `W28` is on: the
 * `StakingTx` history rows (stake / unstake / early_exit_fee / withdraw / compound) and the early-exit fee of an unstake.
 */
export class ActionEffects {
  constructor(
    private readonly staking: StakingPort,
    private readonly txs: StakingTxWriter,
    private readonly env: () => Record<string, string | undefined> = () => process.env as Record<string, string | undefined>,
  ) {}

  record(kind: StakingTxKind, ref: EffectRef, asset: string, amountYocto: bigint): Promise<void> {
    const entry: StakingTxEntry = {
      kind,
      accountId: ref.accountId,
      poolId: ref.pool,
      asset,
      amountYocto,
      txHash: ref.txHash,
      opId: ref.opId,
      atMs: stakingNowMs(this.staking),
    };
    return this.txs.record(entry);
  }

  /**
   * Records an unstake and, inside the early-exit window (`7d`, or `1m` in local mode) of the last deposit, the
   * `early_exit_fee` the adapter kept for the protocol (`earlyExitFeeBp` of the principal, read BEFORE the call).
   */
  async unstaked(ref: EffectRef, amountYocto: bigint, before: StakingPositionView, requestedAsset?: string): Promise<UnstakeExtras> {
    const envBag = this.env();
    const windowMs = resolveStakingTimings(envBag).earlyExitWindowMs;
    const feeBp = isW28Enabled(envBag) ? earlyExitFeeBp(before.lastStakedAtMs ?? null, stakingNowMs(this.staking), windowMs) : 0;
    const fee = (amountYocto * BigInt(feeBp)) / 10_000n;
    const asset = requestedAsset ?? before.asset ?? 'near';
    await this.record('unstake', ref, asset, amountYocto);
    if (fee > 0n) await this.record('early_exit_fee', ref, asset, fee);
    return { earlyExitFeeBp: feeBp, earlyExitFeeNear: yoctoToNear(fee, 6) };
  }

  /** A withdraw pays the matured principal plus the accrued yield, both read before the call. */
  withdrawn(ref: EffectRef, before: StakingPositionView, requestedAsset?: string): Promise<void> {
    return this.record('withdraw', ref, requestedAsset ?? before.asset ?? 'near', bigOf(before.withdrawable) + bigOf(before.rewards));
  }
}
