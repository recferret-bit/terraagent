import type {
  DeedView,
  StakingActionResponse,
  StakingPoolInfo,
  StakingPositionDto,
  StakingStatusResponse,
} from '@terra/contracts';
import type { Disposable, FeatureContext } from '../../core/registry/types';
import { createDeedTracker } from './deedTracker';
import {
  buildStakingActionsRow,
  buildStakingClaimRow,
  buildStakingFormRow,
  buildStakingHeader,
  buildStakingPositionGrid,
  DEFAULT_STAKING_POOLS,
  formatUnbondingSummary,
  REAL_NEAR_COPY,
  renderStakingPoolOptions,
  upsertStakingPositionList,
} from './parts/stakingPanelParts';
import {
  openMockWalletSignerModal,
  type OpenSignerModalHandle,
  type SignerModalRequest,
} from './signerModal';

export interface StakingPanelOptions {
  readonly fetchFn?: typeof fetch;
  readonly openSigner?: (req: SignerModalRequest) => OpenSignerModalHandle;
}

/**
 * W20-21: Settled Deed Staking Panel (`CLIENT §8a`, `NEAR-93`).
 * Renders explicit non-P2W wallet copy, whitelisted validator pool picker (9% APY),
 * inline colony account claim flow, stake/unstake/withdraw actions with NEP-413
 * mock wallet signer modal, and live reward / unbonding state.
 * Uses `createElement` + `textContent` only (never `innerHTML`).
 */
export class StakingPanel implements Disposable {
  readonly root: HTMLElement;
  readonly copyEl: HTMLParagraphElement;
  readonly lockedBannerEl: HTMLDivElement;
  readonly controlsWrapEl: HTMLDivElement;
  readonly poolSelectEl: HTMLSelectElement;
  readonly amountInputEl: HTMLInputElement;
  readonly stakeBtnEl: HTMLButtonElement;
  readonly unstakeBtnEl: HTMLButtonElement;
  readonly withdrawBtnEl: HTMLButtonElement;
  readonly claimBtnEl: HTMLButtonElement;
  readonly statusMsgEl: HTMLSpanElement;

  private readonly walletBalanceEl: HTMLSpanElement;
  private readonly accountStatusEl: HTMLSpanElement;
  private readonly stakedValEl: HTMLSpanElement;
  private readonly rewardsValEl: HTMLSpanElement;
  private readonly unbondingValEl: HTMLSpanElement;
  private readonly withdrawableValEl: HTMLSpanElement;

  private readonly fetchFn: typeof fetch;
  private readonly openSigner: (req: SignerModalRequest) => OpenSignerModalHandle;
  private currentDeed: DeedView | null = null;
  private accountClaimed = false;
  private claimedByAccountId: string | null = null;
  private walletBalanceNear = '100';
  private pools: readonly StakingPoolInfo[] = DEFAULT_STAKING_POOLS;
  private positions: readonly StakingPositionDto[] = [];
  private lastTxHash: string | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly ctx: FeatureContext,
    opts: StakingPanelOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.openSigner = opts.openSigner ?? openMockWalletSignerModal;

    this.root = document.createElement('section');
    this.root.className = 'ta-staking-panel plate-sm';
    this.root.dataset.testid = 'staking-panel';
    this.root.dataset.settled = 'false';

    const header = buildStakingHeader();
    this.walletBalanceEl = header.walletBalanceEl;

    this.copyEl = document.createElement('p');
    this.copyEl.className = 'ta-staking-panel__copy';
    this.copyEl.dataset.testid = 'staking-real-near-copy';
    this.copyEl.textContent = REAL_NEAR_COPY;

    this.lockedBannerEl = document.createElement('div');
    this.lockedBannerEl.className = 'ta-staking-panel__locked';
    this.lockedBannerEl.dataset.testid = 'staking-locked-banner';
    this.lockedBannerEl.textContent = 'Available after your colony is Settled';

    this.controlsWrapEl = document.createElement('div');
    this.controlsWrapEl.className = 'ta-staking-panel__controls';
    this.controlsWrapEl.dataset.testid = 'staking-controls';
    this.controlsWrapEl.hidden = true;

    const claimRow = buildStakingClaimRow(() => {
      void this.claimAccountFlow();
    });
    this.accountStatusEl = claimRow.accountStatusEl;
    this.claimBtnEl = claimRow.claimBtnEl;

    const formRow = buildStakingFormRow(() => {
      void this.stakeFlow();
    });
    this.poolSelectEl = formRow.poolSelect;
    this.amountInputEl = formRow.amountInput;
    this.stakeBtnEl = formRow.stakeBtn;

    const posGrid = buildStakingPositionGrid();
    this.stakedValEl = posGrid.stakedValEl;
    this.rewardsValEl = posGrid.rewardsValEl;
    this.unbondingValEl = posGrid.unbondingValEl;
    this.withdrawableValEl = posGrid.withdrawableValEl;

    const actionsRow = buildStakingActionsRow({
      onUnstake: () => {
        void this.unstakeFlow();
      },
      onWithdraw: () => {
        void this.withdrawFlow();
      },
    });
    this.unstakeBtnEl = actionsRow.unstakeBtn;
    this.withdrawBtnEl = actionsRow.withdrawBtn;
    this.statusMsgEl = actionsRow.statusMsgEl;

    this.controlsWrapEl.appendChild(claimRow.row);
    this.controlsWrapEl.appendChild(formRow.formRow);
    this.controlsWrapEl.appendChild(posGrid.grid);
    this.controlsWrapEl.appendChild(actionsRow.row);

    this.root.appendChild(header.headerEl);
    this.root.appendChild(this.copyEl);
    this.root.appendChild(this.lockedBannerEl);
    this.root.appendChild(this.controlsWrapEl);

    this.parent.appendChild(this.root);
    this.renderPools(DEFAULT_STAKING_POOLS);
    this.renderState();
  }

  syncDeed(deed: DeedView): void {
    const prevSettled = this.currentDeed?.settled ?? false;
    this.currentDeed = deed;
    if (deed.accountClaimed) {
      this.accountClaimed = true;
      this.claimedByAccountId = deed.claimedByAccountId ?? 'pilot.mock';
    }
    this.renderState();
    if ((deed.settled || deed.status === 'settled') && !prevSettled) {
      void this.refreshFromServer();
    }
  }

  async refreshFromServer(): Promise<StakingStatusResponse | null> {
    const colonyId = this.currentDeed?.colonyId ?? 'col_0';
    try {
      const qs = new URLSearchParams({ colonyId });
      const res = await this.fetchFn(`/v1/near/staking?${qs.toString()}`);
      if (!res.ok) return null;
      const status = (await res.json()) as StakingStatusResponse;
      this.applyStatusResponse(status);
      return status;
    } catch {
      return null;
    }
  }

  applyStatusResponse(status: StakingStatusResponse): void {
    this.accountClaimed = status.accountClaimed;
    if (status.accountClaimed && !this.claimedByAccountId) {
      this.claimedByAccountId = status.accountId || 'pilot.mock';
    }
    this.walletBalanceNear = status.walletBalanceNear;
    if (status.pools?.length) {
      this.renderPools(status.pools);
    }
    this.positions = status.positions ?? [];
    this.renderState();
  }

  async claimAccountFlow(): Promise<boolean> {
    const colonyId = this.currentDeed?.colonyId ?? 'col_0';
    const walletAccountId = this.claimedByAccountId ?? 'pilot.mock';
    const handle = this.openSigner({
      title: 'NEAR WALLET SIGNER (MOCK)',
      subtitle: 'Approve NEP-413 signature to claim your colony account',
      actionSummary: `Claim colony account for ${colonyId} as ${walletAccountId}`,
      accountId: walletAccountId,
      recipient: 'terraagent.mock',
      message: `claim:${colonyId}:${walletAccountId}`,
    });
    const outcome = await handle.promise;
    if (outcome.status !== 'approved') {
      this.statusMsgEl.textContent = outcome.reason;
      return false;
    }

    try {
      const res = await this.fetchFn('/v1/near/claim-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId,
          walletAccountId,
          walletSignature: outcome.signature,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          claimed?: boolean;
          claimedByAccountId?: string;
        };
        this.accountClaimed = body.claimed ?? true;
        this.claimedByAccountId = body.claimedByAccountId ?? walletAccountId;
        this.statusMsgEl.textContent = `Account claimed (${this.claimedByAccountId})`;
        this.renderState();
        await this.refreshFromServer();
        return true;
      }
    } catch {
      this.accountClaimed = true;
      this.claimedByAccountId = walletAccountId;
      this.statusMsgEl.textContent = `Account claimed (${this.claimedByAccountId})`;
      this.renderState();
      return true;
    }
    return false;
  }

  async stakeFlow(): Promise<boolean> {
    const colonyId = this.currentDeed?.colonyId ?? 'col_0';
    const planetId = this.currentDeed?.planetId ?? 'planet_w20';
    const pool = this.poolSelectEl.value || this.pools[0]?.poolId || 'astro-stakers.poolv1.near';
    const rawAmount = this.amountInputEl.value.replace(/[^\d.]/g, '').trim() || '10';

    if (!this.accountClaimed) {
      this.statusMsgEl.textContent = 'Claim your colony account to stake';
      this.claimBtnEl.hidden = false;
      return false;
    }

    const tracker = createDeedTracker(this.ctx.services.track);
    tracker.stakeStarted({ colonyId, planetId, pool, amount: rawAmount });

    const signerAccount = this.claimedByAccountId ?? this.currentDeed?.ownerAccountId ?? 'pilot.mock';
    const handle = this.openSigner({
      title: 'NEAR WALLET SIGNER (MOCK)',
      subtitle: REAL_NEAR_COPY,
      actionSummary: `Stake ${rawAmount} NEAR in ${pool}`,
      accountId: signerAccount,
      recipient: pool,
      message: `stake:${colonyId}:${pool}:${rawAmount}`,
    });
    const outcome = await handle.promise;
    if (outcome.status !== 'approved') {
      tracker.stakeCancelled({ colonyId, planetId, pool, amount: rawAmount });
      this.statusMsgEl.textContent = outcome.reason;
      return false;
    }

    try {
      const res = await this.fetchFn('/v1/near/stake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId,
          pool,
          amount: rawAmount,
          walletSignature: outcome.signature,
        }),
      });
      const body = (await res.json()) as StakingActionResponse & {
        code?: string;
        message?: string;
      };
      if (!res.ok) {
        if (body.code === 'ACCOUNT_NOT_CLAIMED') {
          this.accountClaimed = false;
          this.statusMsgEl.textContent = 'Claim your colony account to stake';
          this.renderState();
          return false;
        }
        this.statusMsgEl.textContent = body.message ?? body.code ?? 'Stake failed';
        return false;
      }
      this.lastTxHash = body.txHash;
      this.walletBalanceNear = body.walletBalanceNear;
      this.positions = upsertStakingPositionList(this.positions, body.position);
      this.statusMsgEl.textContent = `${body.position.staked} NEAR staked (${body.txHash})`;
      tracker.stakeCompleted({
        colonyId,
        planetId,
        pool,
        amount: rawAmount,
        txHash: body.txHash,
      });
      this.renderState();
      return true;
    } catch {
      return false;
    }
  }

  async unstakeFlow(): Promise<boolean> {
    const pos = this.activePosition();
    if (!pos || Number(pos.staked || '0') <= 0) return false;
    const colonyId = this.currentDeed?.colonyId ?? 'col_0';
    const planetId = this.currentDeed?.planetId ?? 'planet_w20';
    const amount = pos.staked;
    createDeedTracker(this.ctx.services.track).unstakeStarted({
      colonyId,
      planetId,
      pool: pos.pool,
      amount,
    });

    try {
      const res = await this.fetchFn('/v1/near/unstake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId,
          pool: pos.pool,
          amount,
        }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as StakingActionResponse;
      this.lastTxHash = body.txHash;
      this.walletBalanceNear = body.walletBalanceNear;
      this.positions = upsertStakingPositionList(this.positions, body.position);
      this.statusMsgEl.textContent = 'Unbonding (4 epochs)';
      this.renderState();
      return true;
    } catch {
      return false;
    }
  }

  async withdrawFlow(): Promise<boolean> {
    const pos = this.activePosition();
    if (!pos) return false;
    const colonyId = this.currentDeed?.colonyId ?? 'col_0';
    const planetId = this.currentDeed?.planetId ?? 'planet_w20';
    const amount = pos.withdrawable || pos.unbonding || '0';

    try {
      const res = await this.fetchFn('/v1/near/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId,
          pool: pos.pool,
        }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as StakingActionResponse;
      this.lastTxHash = body.txHash;
      this.walletBalanceNear = body.walletBalanceNear;
      this.positions = upsertStakingPositionList(this.positions, body.position);
      this.statusMsgEl.textContent = `Withdrawn to wallet (${body.txHash})`;
      createDeedTracker(this.ctx.services.track).withdrawCompleted({
        colonyId,
        planetId,
        pool: pos.pool,
        amount,
        txHash: body.txHash,
      });
      this.renderState();
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private renderPools(pools: readonly StakingPoolInfo[]): void {
    this.pools = pools;
    renderStakingPoolOptions(this.poolSelectEl, pools);
  }

  private renderState(): void {
    const isSettled = Boolean(
      this.currentDeed?.settled || this.currentDeed?.status === 'settled',
    );
    this.root.dataset.settled = isSettled ? 'true' : 'false';
    this.lockedBannerEl.hidden = isSettled;
    this.controlsWrapEl.hidden = !isSettled;

    this.walletBalanceEl.textContent = `Wallet: ${this.walletBalanceNear} NEAR`;
    if (this.accountClaimed) {
      this.accountStatusEl.textContent = `Claimed (${this.claimedByAccountId ?? 'pilot.mock'})`;
      this.claimBtnEl.hidden = true;
    } else {
      this.accountStatusEl.textContent = 'Account not claimed';
      this.claimBtnEl.hidden = false;
    }

    const pos = this.activePosition();
    const stakedNear = pos?.staked ?? '0';
    const rewardsNear = pos?.rewards ?? '0';
    const withdrawableNear = pos?.withdrawable ?? '0';

    this.stakedValEl.textContent = `${stakedNear} NEAR staked${this.lastTxHash && Number(stakedNear) > 0 ? ` (${this.lastTxHash})` : ''}`;
    this.rewardsValEl.textContent = `${rewardsNear} NEAR`;
    this.unbondingValEl.textContent = formatUnbondingSummary(pos);
    this.withdrawableValEl.textContent = `${withdrawableNear} NEAR`;

    this.unstakeBtnEl.disabled = Number(stakedNear) <= 0;
    this.withdrawBtnEl.disabled = Number(withdrawableNear) <= 0;
  }

  private activePosition(): StakingPositionDto | null {
    const selectedPool = this.poolSelectEl.value;
    return (
      this.positions.find((p) => p.pool === selectedPool) ??
      this.positions[0] ??
      null
    );
  }
}
