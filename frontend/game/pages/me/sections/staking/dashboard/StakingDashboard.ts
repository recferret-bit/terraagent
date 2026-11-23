// Logged-in Wealth Dashboard (`/me.html#staking`, W28-10): thin orchestrator over `./parts/` (Top-Up hero block, KPI strip,
// AI budget, chart, patron card, action console, tx table). Server numbers are authoritative: every action refetches
// `GET /v1/near/staking/performance`, so KPIs and tier update immediately (unstake = instant downgrade).
import { STAKING_RULES, type PerformanceWindow, type StakingPerformanceResponse } from '@terra/contracts';
import { loadNearActionCreators, type StakingSelectorFactory } from '../../../../../features/deed/parts/stakingWalletTx';
import { detectStakingNetwork } from '../../../../../features/deed/parts/stakingPanelParts';
import { resolveMeBearerToken, type MeFetchFn } from '../../../api';
import { el } from '../../../dom';
import { isBrowserLocalHost } from '../../../localModeSim';
import { buildBlockHeaderWithTip, getActiveHelpTipKeyIn, reopenHelpTipIn } from '../../../parts/helpTip';
import {
  runCompoundAction, runLocalFaucetAction, runNominatePlanetAction, runStakeAction, runStakeProfitsAction,
  runUnstakeAction, runWithdrawAction, type ActionContext, type ActionResult, type StakingNetwork,
} from './dashboardActions';
import { fetchPerformance, fetchWalletPool } from './dashboardApi';
import { formatMicroNear, tickedYieldNear, totalStakedNear, yieldPerSecondNear } from './dashboardMath';
import { renderAiBudget } from './parts/aiBudget';
import { renderChart, type ChartPart } from './parts/chart';
import { renderConsole, type ConsolePart } from './parts/console';
import { renderKpiStrip, type KpiStrip } from './parts/kpiStrip';
import { renderPatronCard } from './parts/patronCard';
import { renderTopUpCard, type TopUpCardHandle } from './parts/topUpCard';
import { renderTxTable } from './parts/txTable';

export interface StakingDashboardOptions {
  readonly accountId: string;
  /** Console amount pre-fill (the `?amount=` of the hash). */
  readonly amount: number;
  readonly defaultPlanetId?: string;
  readonly fetch?: MeFetchFn;
  readonly search?: string;
  /** Test seams. */
  readonly now?: () => number;
  readonly tickMs?: number;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly openWindow?: (url: string) => void;
  readonly origin?: string;
  readonly onStakingChange?: (totalStakedNear: number) => void;
  readonly onPerformanceChange?: (perf: StakingPerformanceResponse) => void;
}

export interface StakingDashboardHandle {
  readonly el: HTMLElement;
  readonly ready: Promise<void>;
  /** The server's chain mode (`GET /v1/near/staking/overview` `network`) replaces the account-suffix guess. */
  setNetwork(network: StakingNetwork): void;
  /** Local dev mode reward multiplier (`10,080` = 1 real min accrues 1 simulated week). */
  setRewardMultiplier(multiplier: number): void;
  dispose(): void;
}

const DEFAULT_WINDOW: PerformanceWindow = '30d';

class StakingDashboard {
  readonly el: HTMLElement;
  private perf: StakingPerformanceResponse | null = null;
  private window: PerformanceWindow = DEFAULT_WINDOW;
  private receivedAtMs = 0;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wasConnected = false;
  private rewardMultiplier = 1;
  private maturedRefetchKey = '';
  private lastPeriodicAttemptAtMs = 0;
  private bgRefetchInFlight = false;
  private inFlight = false;
  private kpi: KpiStrip | null = null;
  private topUp: TopUpCardHandle | null = null;
  private chart: ChartPart | null = null;
  private readonly now: () => number;
  private readonly doFetch: MeFetchFn;
  private network: StakingNetwork;
  private pool: string | undefined;
  private readonly body = el('div', { className: 'ta-stk-dash-body' });
  private readonly hosts = { topup: el('div'), kpi: el('div'), ai: el('div'), patron: el('div'), tx: el('div') };
  private readonly status = el('p', { className: 'ta-stk-status', role: 'status', dataset: { testid: 'staking-dashboard-status' } });
  private readonly consolePart: ConsolePart;

  constructor(private readonly opts: StakingDashboardOptions) {
    this.now = opts.now ?? Date.now;
    this.doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.network = detectStakingNetwork([opts.accountId], []);
    this.rewardMultiplier = isBrowserLocalHost(opts.search) ? STAKING_RULES.localRewardMultiplier : 1;
    this.consolePart = renderConsole(String(opts.amount), {
      onStake: (amount, asset) => void this.act((c) => runStakeAction(c, amount, asset)),
      onCompound: () => void this.compound(),
      onUnstake: (amount, asset) => void this.act((c) => runUnstakeAction(c, amount, asset)),
      onWithdraw: (asset) => void this.act((c) => runWithdrawAction(c, this.perf!, asset)),
      onProfits: (usdc) => void this.profits(usdc),
      onFaucet: () => void this.act((c) => runLocalFaucetAction(c)),
    }, () => this.effectiveNowMs());
    this.consolePart.setLocalMode(this.network === 'mock');
    const dashHeader = buildBlockHeaderWithTip(
      {
        id: 'staking-dashboard',
        title: 'WEALTH DASHBOARD',
        description:
          'Authoritative live telemetry for your linked wallet: tracks active NEAR & LST principal, real-time yield accrual, Orbital Patronage Tier, AI compute quota, and wallet-first actions.',
      },
      el('h3', { className: 'label ta-stk-h' }, `WEALTH DASHBOARD · ${opts.accountId}`),
    );
    this.el = el('div', { className: 'ta-stk-block', dataset: { testid: 'staking-dashboard', account: opts.accountId, network: this.network } },
      dashHeader.head,
      dashHeader.panel,
      this.status,
      this.body,
    );
  }

  load(): Promise<void> {
    const pool = fetchWalletPool(this.doFetch, this.auth, this.opts.accountId).then((p) => { if (p) this.pool = p; });
    const warm = this.network !== 'mock' ? loadNearActionCreators().catch(() => undefined) : Promise.resolve();
    return Promise.all([this.refetch(), pool, warm]).then(() => this.startTicker());
  }

  setNetwork(network: StakingNetwork): void {
    if (network === this.network) return;
    this.network = network;
    this.el.dataset.network = network;
    this.consolePart.setLocalMode(network === 'mock');
    if (network !== 'mock') void loadNearActionCreators().catch(() => undefined);
    if (this.perf) this.render(this.perf);
  }

  setRewardMultiplier(multiplier: number): void {
    const next = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    if (next === this.rewardMultiplier) return;
    this.rewardMultiplier = next;
    this.tickYield();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private auth = (): string => resolveMeBearerToken(this.opts.search);

  private ctx(): ActionContext {
    return { doFetch: this.doFetch, auth: this.auth, accountId: this.opts.accountId, network: this.network, pool: this.pool, selectorFactory: this.opts.selectorFactory };
  }

  /** Fetches the selected window; `false` = unavailable (404 / schema / network) and the previous data stays. */
  private async refetch(): Promise<boolean> {
    const seq = ++this.seq;
    const res = await fetchPerformance(this.doFetch, this.auth, this.opts.accountId, this.window);
    if (seq !== this.seq) return true;
    if (res.kind === 'unavailable') {
      this.el.dataset.state = this.perf ? 'stale' : 'unavailable';
      this.status.textContent = this.perf
        ? 'Could not refresh your staking performance. Showing the last data.'
        : 'The wealth dashboard is not available on this host yet (staking performance endpoint missing).';
      return false;
    }
    this.perf = res.perf;
    this.window = res.perf.series.window;
    const settledNow = this.now();
    this.receivedAtMs = settledNow;
    this.lastPeriodicAttemptAtMs = settledNow;
    this.el.dataset.state = 'ready';
    this.status.textContent = '';
    this.render(res.perf);
    return true;
  }

  private render(p: StakingPerformanceResponse): void {
    const openTipKey = getActiveHelpTipKeyIn(this.body);
    const prevPlanetInput = this.hosts.patron.querySelector<HTMLInputElement>('[data-testid="staking-nominate-planet"]')?.value;
    const nowMs = this.effectiveNowMs(p);
    this.opts.onStakingChange?.(totalStakedNear(p.balances));
    this.opts.onPerformanceChange?.(p);
    this.topUp = renderTopUpCard(p, nowMs, {
      onTopUp: (amount) => {
        this.consolePart.setAmount(String(amount), true);
        this.consolePart.setStatus(`Top-up amount (${amount} NEAR) pre-filled — click Stake to upgrade.`, 'info');
      },
      onTopUpStake: (amount) => void this.act((c) => runStakeAction(c, String(amount), this.consolePart.selectedAsset())),
    });
    this.kpi = renderKpiStrip(p, nowMs, { onCompound: () => void this.compound() });
    if (this.chart) this.chart.update(p.series);
    else this.chart = renderChart(p.series, (w) => void this.setWindow(w));
    this.consolePart.setLocalMode(this.network === 'mock');
    this.consolePart.update(p, nowMs);
    this.hosts.topup.replaceChildren(this.topUp.el);
    this.hosts.kpi.replaceChildren(this.kpi.el);
    this.hosts.ai.replaceChildren(renderAiBudget(p.aiBudget, p.perks.tier));
    this.hosts.patron.replaceChildren(
      renderPatronCard(p, {
        accountId: this.opts.accountId, network: this.network, origin: this.opts.origin ?? location.origin,
        defaultPlanetId: prevPlanetInput ?? this.opts.defaultPlanetId,
        selectorFactory: this.opts.selectorFactory, openWindow: this.opts.openWindow,
        onNominate: (planetId) => void this.nominate(planetId),
      }),
    );
    this.hosts.tx.replaceChildren(renderTxTable(p.txs));
    if (this.body.childElementCount === 0) {
      this.body.replaceChildren(this.hosts.topup, this.hosts.kpi, this.hosts.ai, this.chart.el, this.hosts.patron, this.consolePart.el, this.hosts.tx);
    }
    this.syncBusyUi();
    reopenHelpTipIn(this.body, openTipKey);
    this.tickYield();
  }

  private syncBusyUi(): void {
    this.consolePart.setBusy(this.inFlight);
    this.topUp?.setBusy(this.inFlight);
    this.kpi?.setBusy(this.inFlight);
    const nomBtn = this.hosts.patron.querySelector<HTMLButtonElement>('[data-testid="staking-nominate-btn"]');
    if (nomBtn) nomBtn.disabled = this.inFlight;
  }

  private setPatronStatus(message: string, tone: 'ok' | 'error' | 'info'): void {
    const node = this.hosts.patron.querySelector<HTMLElement>('[data-testid="staking-patron-status"]');
    if (!node) return;
    node.hidden = !message;
    node.textContent = message;
    node.dataset.tone = tone;
  }

  private async setWindow(w: PerformanceWindow): Promise<void> {
    if (w === this.window && this.perf?.series.window === w) return;
    this.window = w;
    await this.refetch();
  }

  private compound(): Promise<void> {
    if (!this.perf) return Promise.resolve();
    const snap = Number(this.perf.balances.accruedYieldNear);
    const live = this.liveYieldNear(this.perf);
    if (snap <= 0 && live < 0.000001) return Promise.resolve();
    const amount = live > snap ? formatMicroNear(live) : this.perf.balances.accruedYieldNear;
    return this.act((c) => runCompoundAction(c, this.perf!, amount, this.consolePart.selectedAsset())).then(() => undefined);
  }

  private async nominate(planetId: string): Promise<void> {
    if (!planetId.trim()) {
      const msg = 'Enter a public planet ID to nominate.';
      this.consolePart.setStatus(msg, 'error');
      this.setPatronStatus(msg, 'error');
      return;
    }
    const res = await this.act((c) => runNominatePlanetAction(c, planetId));
    if (res) this.setPatronStatus(res.message, res.ok ? 'ok' : res.unavailable ? 'info' : 'error');
  }

  private async profits(usdc: string): Promise<void> {
    this.consolePart.setQuote('');
    await this.act((c) => runStakeProfitsAction(c, usdc));
  }

  private async act(run: (c: ActionContext) => Promise<ActionResult>): Promise<ActionResult | null> {
    if (!this.perf || this.inFlight) return null;
    this.inFlight = true;
    this.syncBusyUi();
    this.consolePart.setStatus('Working…', 'info');
    try {
      const res = await run(this.ctx());
      if (res.quote) this.consolePart.setQuote(res.quote);
      if (res.ok) await this.refetch();
      const tone = res.ok ? 'ok' : res.unavailable ? 'info' : 'error';
      this.consolePart.setStatus(res.message, tone);
      return res;
    } finally {
      this.inFlight = false;
      this.syncBusyUi();
    }
  }

  private checkMaturedTimers(nowMs: number): void {
    const p = this.perf;
    if (!p || this.inFlight || this.bgRefetchInFlight) return;
    const crossed = [p.timers.unbondingReadyAtMs, p.timers.feeWarmupReadyAtMs, p.timers.earlyExitFreeAtMs]
      .filter((t): t is number => t !== null && t > p.asOfMs && nowMs >= t);
    if (crossed.length > 0) {
      const key = `${p.asOfMs}:${crossed.join(',')}`;
      if (key !== this.maturedRefetchKey) {
        this.maturedRefetchKey = key;
        this.triggerBackgroundRefetch();
        return;
      }
    }
    const hasPosition = totalStakedNear(p.balances) > 0 || Number(p.balances.unbondingNear) > 0;
    const rawNow = this.now();
    if (this.rewardMultiplier > 1 && hasPosition && rawNow - this.lastPeriodicAttemptAtMs >= STAKING_RULES.localFeeWarmupMs) {
      this.lastPeriodicAttemptAtMs = rawNow;
      this.triggerBackgroundRefetch();
    }
  }

  private triggerBackgroundRefetch(): void {
    this.bgRefetchInFlight = true;
    void this.refetch().finally(() => {
      this.bgRefetchInFlight = false;
    });
  }

  private startTicker(): void {
    const ms = this.opts.tickMs ?? 250;
    if (ms <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      if (this.el.isConnected) this.wasConnected = true;
      else if (this.wasConnected) return this.dispose();
      const nowMs = this.effectiveNowMs();
      this.tickYield();
      this.kpi?.tick(nowMs);
      this.topUp?.tick(nowMs);
      this.consolePart.tick(nowMs);
      this.checkMaturedTimers(nowMs);
    }, ms);
  }

  /** Server clock (`asOfMs`) plus monotonic elapsed time since snapshot arrival (`time.warp`-safe). */
  private effectiveNowMs(p: StakingPerformanceResponse | null = this.perf): number {
    if (!p) return this.now();
    return p.asOfMs + Math.max(0, this.now() - this.receivedAtMs);
  }

  private liveYieldNear(p: StakingPerformanceResponse): number {
    const rate = yieldPerSecondNear(totalStakedNear(p.balances), p.apy.netApyBp) * this.rewardMultiplier;
    return tickedYieldNear(Number(p.balances.accruedYieldNear), rate, Math.max(0, this.now() - this.receivedAtMs));
  }

  /** Client-side live counter: accrued yield plus the net APY per second since the last snapshot. */
  private tickYield(): void {
    const p = this.perf;
    if (!p || !this.kpi) return;
    const rate = yieldPerSecondNear(totalStakedNear(p.balances), p.apy.netApyBp) * this.rewardMultiplier;
    const value = this.liveYieldNear(p);
    const canCompound = Number(p.balances.accruedYieldNear) > 0 || value >= 0.000001;
    this.kpi.yieldValue.textContent = formatMicroNear(value);
    this.kpi.yieldValue.dataset.perSecond = String(rate);
    this.kpi.setCompoundVisible(canCompound);
    this.consolePart.setCanCompound(canCompound);
  }
}

export function renderStakingDashboard(opts: StakingDashboardOptions): StakingDashboardHandle {
  const d = new StakingDashboard(opts);
  return {
    el: d.el,
    ready: d.load(),
    setNetwork: (n) => d.setNetwork(n),
    setRewardMultiplier: (m) => d.setRewardMultiplier(m),
    dispose: () => d.dispose(),
  };
}
