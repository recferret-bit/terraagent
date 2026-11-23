import type {
  DeedView,
  StakerPerksInfo,
  StakingAsset,
  StakingPoolInfo,
  StakingPositionDto,
  StakingStatusResponse,
} from '@terra/contracts';
import type { Disposable, FeatureContext } from '../../core/registry/types';
import { createDeedTracker } from './deedTracker';
import {
  runClaimAccountFlow,
  runNominatePlanetFlow,
  runWalletDepositFlow,
} from './parts/stakingAccountFlows';
import {
  buildStakingPanelLayout,
  DEFAULT_STAKING_POOLS,
  detectStakingNetwork,
  formatStakerPerksBanner,
  formatUnbondingSummary,
  renderStakingPoolOptions,
  syncStakingRewardsLabel,
  upsertStakingPositionList,
} from './parts/stakingPanelParts';
import {
  runCompound,
  runStake,
  runUnstake,
  runWithdraw,
  type StakingFlowHost,
} from './parts/stakingActionFlows';
import {
  formatEarlyExitNotice,
  formatTierFeeLine,
  pendingEarlyExitBp,
  stakingCopyFor,
} from './parts/stakingCopy';
import type { StakingSelectorFactory } from './parts/stakingWalletTx';
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
  /** Test seam: wallet selector recorder for real-network wallet txs. */
  readonly selectorFactory?: StakingSelectorFactory;
  /** Test seam: clock for the 7-day early-exit notice. */
  readonly nowFn?: () => number;
}

/**
 * W20-21 / W28-07: Colony Deed & Wallet-First Staking Panel (`CLIENT §8a`, `NEAR-93`).
 * Renders explicit non-P2W wallet copy, whitelisted validator pool picker,
 * stake/unstake/withdraw/compound/nominate actions, and live reward / unbonding state.
 * Uses `createElement` + `textContent` only (never `innerHTML`).
 */
export class StakingPanel implements Disposable {
  readonly root: HTMLElement;
  readonly copyEl: HTMLParagraphElement;
  readonly perksBannerEl: HTMLDivElement;
  readonly lockedBannerEl: HTMLDivElement;
  readonly controlsWrapEl: HTMLDivElement;
  readonly poolSelectEl: HTMLSelectElement;
  readonly assetSelectEl: HTMLSelectElement;
  readonly compoundBtnEl: HTMLButtonElement;
  readonly nominateBtnEl: HTMLButtonElement;
  readonly earlyExitEl: HTMLDivElement;
  readonly amountInputEl: HTMLInputElement;
  readonly stakeBtnEl: HTMLButtonElement;
  readonly unstakeBtnEl: HTMLButtonElement;
  readonly withdrawBtnEl: HTMLButtonElement;
  readonly depositWalletBtnEl: HTMLButtonElement;
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
  private readonly w28: boolean;
  private readonly selectorFactory?: StakingSelectorFactory;
  private readonly nowFn: () => number;
  private readonly host: StakingFlowHost;
  private compoundUnavailable = false;
  private currentDeed: DeedView | null = null;
  private serverAccountId: string | null = null;
  private accountClaimed = false;
  private claimedByAccountId: string | null = null;
  private walletBalanceNear = '100';
  private pools: readonly StakingPoolInfo[] = DEFAULT_STAKING_POOLS;
  private positions: readonly StakingPositionDto[] = [];
  private perks: StakerPerksInfo | null = null;
  private lastTxHash: string | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly ctx: FeatureContext,
    opts: StakingPanelOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    this.w28 = ctx.flags.has('W28');
    this.selectorFactory = opts.selectorFactory;
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.openSigner = (req) => {
      const container = this.ctx.services?.hudOverlay;
      if (opts.openSigner) return opts.openSigner({ container, ...req });
      const net = this.activeNetwork();
      return net === 'mock'
        ? openMockWalletSignerModal({ container, ...req })
        : openRealNearSignerModal({ container, ...req, network: net });
    };

    const dom = buildStakingPanelLayout({
      onClaim: () => void this.claimAccountFlow(),
      onStake: () => void this.stakeFlow(),
      onUnstake: () => void this.unstakeFlow(),
      onWithdraw: () => void this.withdrawFlow(),
      onWalletDeposit: () => void this.walletDepositFlow(),
      onCompound: () => void this.compoundFlow(),
      onNominate: () => void this.nominatePlanetFlow(),
      w28: this.w28,
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
    this.assetSelectEl = dom.assetSelectEl;
    this.compoundBtnEl = dom.compoundBtnEl;
    this.nominateBtnEl = dom.nominateBtnEl;
    this.earlyExitEl = dom.earlyExitEl;
    this.amountInputEl = dom.amountInputEl;
    this.stakeBtnEl = dom.stakeBtnEl;
    this.stakedValEl = dom.stakedValEl;
    this.rewardsValEl = dom.rewardsValEl;
    this.unbondingValEl = dom.unbondingValEl;
    this.withdrawableValEl = dom.withdrawableValEl;
    this.unstakeBtnEl = dom.unstakeBtnEl;
    this.withdrawBtnEl = dom.withdrawBtnEl;
    this.depositWalletBtnEl = dom.depositWalletBtnEl;
    this.statusMsgEl = dom.statusMsgEl;

    this.host = this.buildHost();
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
    const colonyId = this.currentDeed?.colonyId ?? (this.w28 ? undefined : 'col_0');
    try {
      const qs = new URLSearchParams(colonyId ? { colonyId } : {});
      if (!colonyId) {
        const acct = this.serverAccountId ?? this.claimedByAccountId;
        if (acct) qs.set('accountId', acct);
      }
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
    this.positions = status.positions ?? [];
    this.perks = status.perks ?? this.perks;
    if (status.pools?.length) this.renderPools(status.pools);
    else if (status.perks) this.renderPools(this.pools);
    this.renderState();
  }

  claimAccountFlow(): Promise<boolean> {
    return runClaimAccountFlow({
      colonyId: this.currentDeed?.colonyId ?? 'col_0',
      net: this.activeNetwork(),
      initialAccountId: this.claimedByAccountId,
      fetchFn: this.fetchFn,
      openSigner: this.openSigner,
      statusMsgEl: this.statusMsgEl,
      onClaimed: async (claimedBy, claimed) => {
        this.accountClaimed = claimed;
        this.claimedByAccountId = claimedBy;
        this.statusMsgEl.textContent = `Account claimed (${claimedBy})`;
        this.renderState();
        await this.refreshFromServer();
      },
    });
  }

  stakeFlow(): Promise<boolean> { return runStake(this.host); }
  unstakeFlow(): Promise<boolean> { return runUnstake(this.host); }
  withdrawFlow(): Promise<boolean> { return runWithdraw(this.host); }
  compoundFlow(): Promise<boolean> { return runCompound(this.host); }

  nominatePlanetFlow(): Promise<boolean> {
    return runNominatePlanetFlow({
      w28: this.w28,
      fetchFn: this.fetchFn,
      accountId: this.serverAccountId ?? this.claimedByAccountId ?? this.currentDeed?.ownerAccountId,
      planetId: this.currentDeed?.planetId ?? this.ctx.services?.session?.planetId?.(),
      statusMsgEl: this.statusMsgEl,
      onNominated: () => this.refreshFromServer(),
    });
  }

  dispose(): void {
    this.root.remove();
  }

  private renderPools(pools: readonly StakingPoolInfo[]): void {
    this.pools = pools;
    renderStakingPoolOptions(this.poolSelectEl, pools, this.perks?.protocolYieldShareBp);
  }

  private renderState(): void {
    const isSettled = Boolean(this.currentDeed?.settled || this.currentDeed?.status === 'settled');
    this.root.dataset.settled = isSettled ? 'true' : 'false';
    this.lockedBannerEl.hidden = true;
    this.controlsWrapEl.hidden = false;

    const totalStakedNear = this.positions.reduce((sum, p) => sum + Number(p.staked || '0'), 0);
    const minNear = Number(this.perks?.minStakeNear || '10') || 10;
    const tierLine = this.w28 ? formatTierFeeLine(this.perks, this.nowFn()) : '';
    this.perksBannerEl.textContent = formatStakerPerksBanner(totalStakedNear, this.perks) + (tierLine ? ` · ${tierLine}` : '');
    syncStakingRewardsLabel(this.rewardsValEl, this.perks);
    this.root.dataset.perksActive = totalStakedNear >= minNear ? 'true' : 'false';

    this.walletBalanceEl.textContent = `Wallet: ${this.walletBalanceNear} NEAR`;
    if (this.w28) {
      this.accountStatusEl.textContent = `Wallet-first staking${this.claimedByAccountId ? ` (${this.claimedByAccountId})` : ''}: no colony deed required`;
      this.claimBtnEl.hidden = true;
    } else if (this.accountClaimed) {
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
    this.depositWalletBtnEl.hidden = this.w28 || this.activeNetwork() === 'mock';
    this.renderW28Actions(pos, totalStakedNear);
  }

  /** W28 only: compound button (rewards > 0), Tier 4 planet nomination, and `<7d` early-exit notice on Unstake. */
  private renderW28Actions(pos: StakingPositionDto | null, totalStakedNear: number): void {
    const showCompound = this.w28 && Number(pos?.rewards ?? '0') > 0;
    this.compoundBtnEl.hidden = !showCompound;
    this.compoundBtnEl.disabled = this.compoundUnavailable;
    this.compoundBtnEl.title = this.compoundUnavailable
      ? 'Compound is not available on this server yet'
      : 'Roll accrued yield into principal. 0 % fee, keeps your 7-day maturity clock.';
    const perksTier = this.perks && 'tier' in this.perks ? Number(this.perks.tier) : 0;
    const tier4Eligible = this.w28 && (perksTier >= 4 || totalStakedNear >= 500);
    this.nominateBtnEl.hidden = !tier4Eligible;
    const now = this.nowFn();
    const feeBp = this.w28 ? pendingEarlyExitBp(pos, this.perks, now) : 0;
    const notice = formatEarlyExitNotice(feeBp, pos?.lastStakedAtMs, now);
    this.earlyExitEl.textContent = notice;
    this.earlyExitEl.hidden = notice === '';
    this.assetSelectEl.parentElement!.hidden = !this.w28;
  }

  private walletDepositFlow(): Promise<void> {
    return runWalletDepositFlow({
      net: this.activeNetwork(),
      fetchFn: this.fetchFn,
      selectorFactory: this.selectorFactory,
      poolId: this.poolSelectEl.value,
      amountNear: this.amountInputEl.value,
      accountId: this.serverAccountId ?? this.currentDeed?.ownerAccountId ?? this.claimedByAccountId,
      statusMsgEl: this.statusMsgEl,
      onSuccess: () => this.refreshFromServer(),
    });
  }

  private activeNetwork(): 'mock' | RealNearNetwork {
    return detectStakingNetwork(
      [this.currentDeed?.contractId, this.currentDeed?.ownerAccountId, this.serverAccountId, this.claimedByAccountId],
      this.pools.map((p) => p.poolId),
    );
  }

  private async signAction(summary: string, recipient: string, message: string, force: boolean) {
    const net = this.activeNetwork();
    if (net === 'mock' && !force) return undefined;
    const signerAccount =
      this.claimedByAccountId ?? this.currentDeed?.ownerAccountId ?? (net === 'mainnet' ? 'pilot.near' : net === 'testnet' ? 'pilot.testnet' : 'pilot.mock');
    const outcome = await this.openSigner({
      title: `NEAR WALLET SIGNER (${net.toUpperCase()})`,
      subtitle: stakingCopyFor(this.w28),
      ...(this.w28 ? { notice: stakingCopyFor(true) } : {}),
      actionSummary: summary,
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

  private buildHost(): StakingFlowHost {
    return {
      fetchFn: this.fetchFn,
      w28: this.w28,
      selectorFactory: this.selectorFactory,
      statusEl: this.statusMsgEl,
      tracker: () => createDeedTracker(this.ctx.services.track),
      network: () => this.activeNetwork(),
      ids: () => ({
        colonyId: this.currentDeed?.colonyId ?? (this.w28 ? undefined : 'col_0'),
        planetId: this.currentDeed?.planetId ?? 'planet_w20',
        accountId: this.serverAccountId ?? this.claimedByAccountId ?? this.currentDeed?.ownerAccountId ?? undefined,
      }),
      input: () => ({
        pool: this.poolSelectEl.value || this.pools[0]?.poolId || 'astro-stakers.poolv1.near',
        asset: (this.assetSelectEl.value || 'near') as StakingAsset,
        amount: this.amountInputEl.value.replace(/[^\d.]/g, '').trim() || '10',
      }),
      activePosition: () => this.activePosition(),
      say: (m) => { this.statusMsgEl.textContent = m; },
      applyAction: (body) => {
        this.lastTxHash = body.txHash;
        this.walletBalanceNear = body.walletBalanceNear;
        this.positions = upsertStakingPositionList(this.positions, body.position);
        this.perks = body.perks ?? this.perks;
        this.renderState();
      },
      refresh: () => this.refreshFromServer(),
      sign: (summary, recipient, message, force) => this.signAction(summary, recipient, message, force),
      accountClaimed: () => this.accountClaimed,
      promptClaim: () => {
        this.statusMsgEl.textContent = 'Claim your colony account to stake';
        this.claimBtnEl.hidden = false;
      },
      staleClaim: () => {
        this.accountClaimed = false;
        this.statusMsgEl.textContent = 'Claim your colony account to stake';
        this.renderState();
      },
      markCompoundUnavailable: () => {
        this.compoundUnavailable = true;
        this.statusMsgEl.textContent = 'Compound is not available on this server yet';
        this.renderState();
      },
    };
  }

  private activePosition(): StakingPositionDto | null {
    const selectedPool = this.poolSelectEl.value;
    return this.positions.find((p) => p.pool === selectedPool) ?? this.positions[0] ?? null;
  }
}
