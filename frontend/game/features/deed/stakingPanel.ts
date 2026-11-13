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
  buildStakingPanelLayout,
  DEFAULT_STAKING_POOLS,
  detectStakingNetwork,
  extractStakingApiCode,
  extractStakingApiError,
  formatStakerPerksBanner,
  formatUnbondingSummary,
  REAL_NEAR_COPY,
  renderStakingPoolOptions,
  upsertStakingPositionList,
} from './parts/stakingPanelParts';
import {
  openRealNearSignerModal,
  type RealNearNetwork,
} from './realNearSignerModal';
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
  readonly perksBannerEl: HTMLDivElement;
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
  private serverAccountId: string | null = null;
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
    // The signer modal joins the HUD overlay (above the deed modal) when the HUD provides one; else document.body.
    this.openSigner = (req) => {
      const container = this.ctx.services?.hudOverlay;
      if (opts.openSigner) return opts.openSigner({ container, ...req });
      const net = this.activeNetwork();
      return net === 'mock'
        ? openMockWalletSignerModal({ container, ...req })
        : openRealNearSignerModal({ container, ...req, network: net });
    };

    const dom = buildStakingPanelLayout({
      onClaim: () => {
        void this.claimAccountFlow();
      },
      onStake: () => {
        void this.stakeFlow();
      },
      onUnstake: () => {
        void this.unstakeFlow();
      },
      onWithdraw: () => {
        void this.withdrawFlow();
      },
    });
    this.root = dom.root;
    this.walletBalanceEl = dom.walletBalanceEl;
    this.copyEl = dom.copyEl;
    this.perksBannerEl = dom.perksBannerEl;
    this.lockedBannerEl = dom.lockedBannerEl;
    this.controlsWrapEl = dom.controlsWrapEl;
    this.accountStatusEl = dom.accountStatusEl;
    this.claimBtnEl = dom.claimBtnEl;
    this.poolSelectEl = dom.poolSelectEl;
    this.amountInputEl = dom.amountInputEl;
    this.stakeBtnEl = dom.stakeBtnEl;
    this.stakedValEl = dom.stakedValEl;
    this.rewardsValEl = dom.rewardsValEl;
    this.unbondingValEl = dom.unbondingValEl;
    this.withdrawableValEl = dom.withdrawableValEl;
    this.unstakeBtnEl = dom.unstakeBtnEl;
    this.withdrawBtnEl = dom.withdrawBtnEl;
    this.statusMsgEl = dom.statusMsgEl;

    this.parent.appendChild(this.root);
    this.renderPools(DEFAULT_STAKING_POOLS);
    this.renderState();
  }

  syncDeed(deed: DeedView): void {
    const prevColonyId = this.currentDeed?.colonyId;
    const prevSettled = this.currentDeed?.settled ?? false;
    this.currentDeed = deed;
    if (deed.accountClaimed) {
      this.accountClaimed = true;
      this.claimedByAccountId = deed.claimedByAccountId ?? 'pilot.mock';
    }
    this.renderState();
    if ((prevColonyId !== undefined && prevColonyId !== deed.colonyId) || ((deed.settled || deed.status === 'settled') && !prevSettled)) {
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
    this.serverAccountId = status.accountId || this.serverAccountId;
    this.accountClaimed = status.accountClaimed;
    if (status.claimedByAccountId) {
      this.claimedByAccountId = status.claimedByAccountId;
    } else if (status.accountClaimed && !this.claimedByAccountId) {
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
    const net = this.activeNetwork();
    const fallbackAcct = net === 'mainnet' ? 'pilot.near' : net === 'testnet' ? 'pilot.testnet' : 'pilot.mock';
    const initialAcct = this.claimedByAccountId ?? fallbackAcct;
    const recipient = net === 'mainnet' ? 'terraagent.near' : net === 'testnet' ? 'terraagent.testnet' : 'terraagent.mock';
    const handle = this.openSigner({
      title: `NEAR WALLET SIGNER (${net.toUpperCase()})`,
      subtitle: 'Approve NEP-413 signature to claim your colony account',
      actionSummary: net === 'mock'
        ? `Claim colony account for ${colonyId} as ${initialAcct}`
        : `Claim colony account for ${colonyId} (${net})`,
      accountId: initialAcct,
      recipient,
      message: net === 'mock' ? `claim:${colonyId}:${initialAcct}` : `claim:${colonyId}`,
    });
    const outcome = await handle.promise;
    if (outcome.status !== 'approved') {
      this.statusMsgEl.textContent = outcome.reason;
      return false;
    }

    const walletAccountId =
      net === 'mock' ? initialAcct : outcome.signature.accountId || initialAcct;
    try {
      const res = await this.fetchFn('/v1/near/claim-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId,
          walletAccountId,
          newPublicKey: outcome.signature.publicKey,
          walletSignature: outcome.signature,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        claimed?: boolean;
        claimedByAccountId?: string;
      };
      if (res.ok) {
        this.accountClaimed = body.claimed ?? true;
        this.claimedByAccountId = body.claimedByAccountId ?? walletAccountId;
        this.statusMsgEl.textContent = `Account claimed (${this.claimedByAccountId})`;
        this.renderState();
        await this.refreshFromServer();
        return true;
      }
      this.statusMsgEl.textContent = extractStakingApiError(body, 'Account claim failed');
    } catch {
      if (net === 'mock') {
        this.accountClaimed = true;
        this.claimedByAccountId = walletAccountId;
        this.statusMsgEl.textContent = `Account claimed (${this.claimedByAccountId})`;
        this.renderState();
        return true;
      }
      this.statusMsgEl.textContent = 'Account claim failed';
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

    const net = this.activeNetwork();
    const signerAccount = this.claimedByAccountId ?? this.currentDeed?.ownerAccountId ?? 'pilot.mock';
    const handle = this.openSigner({
      title: `NEAR WALLET SIGNER (${net.toUpperCase()})`,
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
      const body = (await res.json()) as StakingActionResponse;
      if (!res.ok) {
        if (extractStakingApiCode(body) === 'ACCOUNT_NOT_CLAIMED') {
          this.accountClaimed = false;
          this.statusMsgEl.textContent = 'Claim your colony account to stake';
          this.renderState();
          return false;
        }
        this.statusMsgEl.textContent = extractStakingApiError(body, 'Stake failed');
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
    const walletSignature = await this.signRealActionIfNeeded(
      `Unstake ${amount} NEAR from ${pos.pool}`,
      pos.pool,
      `unstake:${colonyId}:${pos.pool}:${amount}`,
    );
    if (walletSignature === null) return false;
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
          ...(walletSignature ? { walletSignature } : {}),
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
    const walletSignature = await this.signRealActionIfNeeded(
      `Withdraw ${amount} NEAR from ${pos.pool}`,
      pos.pool,
      `withdraw:${colonyId}:${pos.pool}`,
    );
    if (walletSignature === null) return false;

    try {
      const res = await this.fetchFn('/v1/near/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId,
          pool: pos.pool,
          ...(walletSignature ? { walletSignature } : {}),
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
    this.lockedBannerEl.hidden = true;
    this.controlsWrapEl.hidden = false;

    const totalStakedNear = this.positions.reduce((sum, p) => sum + Number(p.staked || '0'), 0);
    this.perksBannerEl.textContent = formatStakerPerksBanner(totalStakedNear);
    this.root.dataset.perksActive = totalStakedNear >= 10 ? 'true' : 'false';

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

  private activeNetwork(): 'mock' | RealNearNetwork {
    return detectStakingNetwork(
      [this.currentDeed?.contractId, this.currentDeed?.ownerAccountId, this.serverAccountId, this.claimedByAccountId],
      this.pools.map((p) => p.poolId),
    );
  }

  private async signRealActionIfNeeded(actionSummary: string, recipient: string, message: string) {
    const net = this.activeNetwork();
    if (net === 'mock') return undefined;
    const signerAccount = this.claimedByAccountId ?? this.currentDeed?.ownerAccountId ?? (net === 'mainnet' ? 'pilot.near' : 'pilot.testnet');
    const outcome = await this.openSigner({
      title: `NEAR WALLET SIGNER (${net.toUpperCase()})`,
      subtitle: REAL_NEAR_COPY,
      actionSummary,
      accountId: signerAccount,
      recipient,
      message,
    }).promise;
    if (outcome.status !== 'approved') {
      this.statusMsgEl.textContent = outcome.reason;
      return null;
    }
    return outcome.signature;
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
