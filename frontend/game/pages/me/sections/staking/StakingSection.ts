// `/me.html#staking` tab: thin orchestrator. Parts live in `./parts/` (one per block); W28-10 mounts the logged-in
// Wealth Dashboard into `staking-dashboard-slot` without touching the preview parts.
import type { StakingOverviewResponse } from '@terra/contracts';
import type { MeFetchFn } from '../../api';
import { el } from '../../dom';
import { buildBlockHeaderWithTip, getActiveHelpTipKeyIn, reopenHelpTipIn } from '../../parts/helpTip';
import './staking.css';
import { renderStakingDashboard, type StakingDashboardHandle } from './dashboard/StakingDashboard';
import { renderConnectCta } from './parts/connectCta';
import { renderEcosystem } from './parts/ecosystem';
import { renderProjection } from './parts/projection';
import { renderTierMatrix } from './parts/tierMatrix';
import { fetchStakingOverview } from './stakingApi';
import { fallbackOverview, formatPct, projectionFor } from './stakingMath';
import { MAX_PREVIEW_NEAR, sanitizeStakeAmount, stakingHash } from './stakingRoute';

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
    badge: el('div', { className: 'ta-stk-badges' }),
    matrix: el('div'),
    projection: el('div'),
    ecosystem: el('div'),
    cta: el('div', { className: 'ta-stk-cta-row' }),
  };
  readonly el: HTMLElement;
  dashboard: StakingDashboardHandle | null = null;
  private readonly input: HTMLInputElement;

  constructor(private readonly opts: StakingSectionOptions) {
    this.amount = sanitizeStakeAmount(opts.amount);
    this.ov = fallbackOverview(this.amount);
    this.input = this.buildInput();
    const calcHeader = buildBlockHeaderWithTip(
      {
        id: 'staking-calculator',
        title: 'STAKE CALCULATOR & APY',
        description:
          'Enter any NEAR amount to preview net staking yield and Patronage Tier unlocks. Principal stays 100% yours; 80% of validator yield goes to you and 20% funds gasless meta-transactions and Managed NEAR.AI TEE.',
      },
      el('span', { className: 'label c-orange' }, 'STAKE CALCULATOR & YIELD PREVIEW'),
    );
    const calcBlock = el(
      'div',
      { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-calculator-block' } },
      calcHeader.head,
      calcHeader.panel,
      el('div', { className: 'ta-stk-top' }, this.buildAmountField(), this.hosts.badge),
      this.hosts.cta,
    );
    this.el = el(
      'div',
      { className: 'ta-stk', dataset: { testid: 'staking-preview' } },
      opts.connected ? el('div', { className: 'ta-stk-dash', dataset: { testid: 'staking-dashboard-slot' } }) : null,
      calcBlock,
      this.hosts.projection,
      this.hosts.matrix,
      this.hosts.ecosystem,
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
      onStakingChange: this.opts.onStakingChange,
      onPerformanceChange: (perf) => {
        this.ov = { ...this.ov, ecosystem: perf.ecosystem, price: perf.price, apy: perf.apy };
        this.renderAll();
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
      }
      this.renderAll();
      if (res.off) this.opts.onOff?.();
    });
  }

  private buildInput(): HTMLInputElement {
    const input = el('input', {
      className: 'input ta-stk-input',
      type: 'number',
      id: 'staking-amount',
      dataset: { testid: 'staking-amount-input' },
    });
    input.min = '1';
    input.max = String(MAX_PREVIEW_NEAR);
    input.step = 'any';
    input.inputMode = 'decimal';
    input.value = String(this.amount);
    input.addEventListener('input', () => this.setAmount(sanitizeStakeAmount(input.value)));
    return input;
  }

  private buildAmountField(): HTMLElement {
    const label = el('label', { className: 'label', dataset: { testid: 'staking-amount-label' } }, 'STAKE AMOUNT (NEAR)');
    label.htmlFor = 'staking-amount';
    return el('div', { className: 'ta-stk-field' }, label, this.input);
  }

  private setAmount(next: number): void {
    if (next === this.amount) return;
    this.amount = next;
    try {
      history.replaceState(null, '', stakingHash(next));
    } catch {
      /* non-browser host */
    }
    this.renderAll();
  }

  private swap(host: HTMLElement, child: HTMLElement): void {
    host.replaceChildren(child);
  }

  private renderAll(): void {
    const { ov, amount } = this;
    const openTipKey =
      getActiveHelpTipKeyIn(this.hosts.matrix) ??
      getActiveHelpTipKeyIn(this.hosts.projection) ??
      getActiveHelpTipKeyIn(this.hosts.ecosystem);
    this.hosts.badge.replaceChildren(
      el('span', { className: 'ta-stk-badge', dataset: { testid: 'staking-apy-badge', source: ov.apy.source, live: this.live ? '1' : '0' } }, apyBadgeText(ov)),
      el('span', { className: 'ta-stk-sub' }, `Gross ${formatPct(ov.apy.grossApyBp)} · ${formatPct(ov.apy.protocolYieldShareBp)} to protocol`),
    );
    this.swap(this.hosts.matrix, renderTierMatrix(ov.tiers, amount, ov.rules.feeWarmupMs));
    this.swap(this.hosts.projection, renderProjection(projectionFor(ov, amount), priceBadgeText(ov)));
    this.swap(this.hosts.ecosystem, renderEcosystem(ov.ecosystem));
    reopenHelpTipIn(this.el, openTipKey);
    this.hosts.cta.replaceChildren(...(this.opts.connected ? [] : [renderConnectCta(amount, this.opts.onConnect)]));
  }
}

export function renderStakingSection(opts: StakingSectionOptions): StakingSectionHandle {
  const preview = new StakingPreview(opts);
  const ready = Promise.all([preview.load(), preview.dashboard?.ready]).then(() => undefined);
  return { el: preview.el, ready };
}
