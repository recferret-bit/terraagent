// `/me.html#staking` tab: thin orchestrator. Renders the always-visible 4-pillar Staking banner, mounts the logged-in
// Wealth Dashboard (with Portfolio Metrics + Projected Income extension) or the signed-out Projected Income preview,
// followed by Ecosystem TVL and bottom AI Compute Budget.
import type { StakingOverviewResponse } from '@terra/contracts';
import type { MeFetchFn } from '../../api';
import { el } from '../../dom';
import { getActiveHelpTipKeyIn, reopenHelpTipIn } from '../../parts/helpTip';
import './staking.css';
import { renderStakingDashboard, type StakingDashboardHandle } from './dashboard/StakingDashboard';
import { renderEcosystem } from './parts/ecosystem';
import { renderStakingIntroBanner } from './parts/introBanner';
import { renderPublicProjectionPreview } from './parts/projection';
import { fetchStakingOverview } from './stakingApi';
import { fallbackOverview, formatPct } from './stakingMath';
import { sanitizeStakeAmount, stakingHash } from './stakingRoute';

export interface StakingSectionOptions {
  readonly amount: number;
  readonly defaultPlanetId?: string;
  readonly fetch?: MeFetchFn;
  /** `location.search` of the page (dev bearer overrides such as `?as=`). */
  readonly search?: string;
  /** A wallet account is already linked: the connect CTA is replaced by the dashboard slot (W28-10). */
  readonly connected: boolean;
  /** The linked wallet account id; with `connected` it mounts the Wealth Dashboard (W28-10) into the slot. */
  readonly accountId?: string | null;
  /** Starts the existing NEAR wallet sign-in flow. */
  readonly onConnect: () => void;
  /** The server reports W28 off (overview 404): the page hides the tab and plate. */
  readonly onOff?: () => void;
  /** Fired whenever the Wealth Dashboard loads or updates active staked NEAR. */
  readonly onStakingChange?: (totalStakedNear: number) => void;
}

export interface StakingSectionHandle {
  readonly el: HTMLElement;
  /** Resolves once the overview request settled (live or fallback) and the DOM reflects it. */
  readonly ready: Promise<void>;
}

export const apyBadgeText = (ov: StakingOverviewResponse): string =>
  `${formatPct(ov.apy.netApyBp)} ${ov.apy.source === 'live' ? 'Live APY' : 'Sim APY'}`;
export const priceBadgeText = (ov: StakingOverviewResponse): string =>
  `${ov.price.source === 'live' ? 'Live' : 'Est.'} $${ov.price.nearUsd.toFixed(2)}`;

class StakingPreview {
  private amount: number;
  private ov: StakingOverviewResponse;
  private live = false;
  private readonly hosts = {
    projection: el('div'),
    ecosystem: el('div'),
    ai: el('div', { className: 'ta-stk-ai-slot', dataset: { testid: 'staking-ai-slot' } }),
  };
  readonly el: HTMLElement;
  dashboard: StakingDashboardHandle | null = null;

  constructor(private readonly opts: StakingSectionOptions) {
    this.amount = sanitizeStakeAmount(opts.amount);
    this.ov = fallbackOverview(this.amount);
    this.el = el(
      'div',
      { className: 'ta-stk', dataset: { testid: 'staking-preview' } },
      renderStakingIntroBanner(),
      opts.connected ? el('div', { className: 'ta-stk-dash', dataset: { testid: 'staking-dashboard-slot' } }) : null,
      opts.connected ? null : this.hosts.projection,
      this.hosts.ecosystem,
      opts.connected ? this.hosts.ai : null,
    );
    this.renderAll();
    this.mountDashboard();
  }

  private mountDashboard(): void {
    const slot = this.el.querySelector('[data-testid="staking-dashboard-slot"]');
    if (!slot || !this.opts.accountId) return;
    this.dashboard = renderStakingDashboard({
      accountId: this.opts.accountId,
      amount: this.amount,
      defaultPlanetId: this.opts.defaultPlanetId,
      fetch: this.opts.fetch,
      search: this.opts.search,
      aiHost: this.hosts.ai,
      onPreviewAmountChange: (next) => this.syncHashAmount(next),
      onStakingChange: this.opts.onStakingChange,
      onPerformanceChange: (perf) => {
        this.ov = { ...this.ov, ecosystem: perf.ecosystem, price: perf.price, apy: perf.apy };
        this.renderEcosystemOnly();
      },
    });
    slot.appendChild(this.dashboard.el);
  }

  load(): Promise<void> {
    return fetchStakingOverview(this.amount, this.opts.fetch).then((res) => {
      this.ov = res.overview;
      this.live = res.live;
      if (res.live) {
        this.dashboard?.setNetwork(res.overview.network);
        this.dashboard?.setRewardMultiplier(res.overview.rules.rewardRateMultiplier ?? 1);
        this.dashboard?.setFeeWarmupMs(res.overview.rules.feeWarmupMs);
      }
      this.renderAll();
      if (res.off) this.opts.onOff?.();
    });
  }

  private syncHashAmount(next: number): void {
    if (next === this.amount) return;
    this.amount = next;
    try {
      history.replaceState(null, '', stakingHash(next));
    } catch {
      /* non-browser host */
    }
  }

  private setAmount(next: number): void {
    if (next === this.amount) return;
    this.syncHashAmount(next);
    this.renderAll();
  }

  private renderEcosystemOnly(): void {
    const openTipKey = getActiveHelpTipKeyIn(this.hosts.ecosystem);
    this.hosts.ecosystem.replaceChildren(renderEcosystem(this.ov.ecosystem));
    reopenHelpTipIn(this.hosts.ecosystem, openTipKey);
  }

  private renderAll(): void {
    const { ov, amount } = this;
    const openTipKey = getActiveHelpTipKeyIn(this.el);
    if (!this.opts.connected) {
      this.hosts.projection.replaceChildren(
        renderPublicProjectionPreview({
          ov,
          amount,
          live: this.live,
          onAmountChange: (next) => this.setAmount(next),
          onConnect: this.opts.onConnect,
        }),
      );
    }
    this.hosts.ecosystem.replaceChildren(renderEcosystem(ov.ecosystem));
    reopenHelpTipIn(this.el, openTipKey);
  }
}

export function renderStakingSection(opts: StakingSectionOptions): StakingSectionHandle {
  const preview = new StakingPreview(opts);
  const ready = Promise.all([preview.load(), preview.dashboard?.ready]).then(() => undefined);
  return { el: preview.el, ready };
}
