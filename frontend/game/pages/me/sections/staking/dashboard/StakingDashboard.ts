// Logged-in Wealth Dashboard (`/me.html#staking`, W28-10): thin orchestrator over `./parts/` (KPI strip, AI budget,
// chart, patron card, action console, tx table). Server numbers are authoritative: every action refetches
// `GET /v1/near/staking/performance`, so KPIs and tier update immediately (unstake = instant downgrade).
import type { PerformanceWindow, StakingPerformanceResponse } from '@terra/contracts';
import type { StakingSelectorFactory } from '../../../../../features/deed/parts/stakingWalletTx';
import { detectStakingNetwork } from '../../../../../features/deed/parts/stakingPanelParts';
import { resolveMeBearerToken, type MeFetchFn } from '../../../api';
import { el } from '../../../dom';
import {
  runCompoundAction, runNominatePlanetAction, runStakeAction, runStakeProfitsAction, runUnstakeAction, runWithdrawAction,
  type ActionContext, type ActionResult, type StakingNetwork,
} from './dashboardActions';
import { fetchPerformance, fetchWalletPool } from './dashboardApi';
import { formatMicroNear, tickedYieldNear, totalStakedNear, yieldPerSecondNear } from './dashboardMath';
import { renderAiBudget } from './parts/aiBudget';
import { renderChart, type ChartPart } from './parts/chart';
import { renderConsole, type ConsolePart } from './parts/console';
import { renderKpiStrip, type KpiStrip } from './parts/kpiStrip';
import { renderPatronCard } from './parts/patronCard';
import { renderTxTable } from './parts/txTable';

export interface StakingDashboardOptions {
  readonly accountId: string;
  /** Console amount pre-fill (the `?amount=` of the hash). */
  readonly amount: number;
  readonly fetch?: MeFetchFn;
  readonly search?: string;
  /** Test seams. */
  readonly now?: () => number;
  readonly tickMs?: number;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly openWindow?: (url: string) => void;
  readonly origin?: string;
}

export interface StakingDashboardHandle {
  readonly el: HTMLElement;
  readonly ready: Promise<void>;
  /** The server's chain mode (`GET /v1/near/staking/overview` `network`) replaces the account-suffix guess. */
  setNetwork(network: StakingNetwork): void;
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
  private kpi: KpiStrip | null = null;
  private chart: ChartPart | null = null;
  private readonly now: () => number;
  private readonly doFetch: MeFetchFn;
  private network: StakingNetwork;
  private pool: string | undefined;
  private readonly body = el('div', { className: 'ta-stk-dash-body' });
  private readonly hosts = { kpi: el('div'), ai: el('div'), patron: el('div'), tx: el('div') };
  private readonly status = el('p', { className: 'ta-stk-status', role: 'status', dataset: { testid: 'staking-dashboard-status' } });
  private readonly consolePart: ConsolePart;

  constructor(private readonly opts: StakingDashboardOptions) {
    this.now = opts.now ?? Date.now;
    this.doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.network = detectStakingNetwork([opts.accountId], []);
    this.consolePart = renderConsole(String(opts.amount), {
      onStake: (amount, asset) => void this.act((c) => runStakeAction(c, amount, asset)),
      onCompound: () => void this.compound(),
      onUnstake: (amount, asset) => void this.act((c) => runUnstakeAction(c, amount, asset)),
      onWithdraw: (asset) => void this.act((c) => runWithdrawAction(c, this.perf!, asset)),
      onProfits: (usdc) => void this.profits(usdc),
    }, () => this.effectiveNowMs());
    this.el = el('div', { className: 'ta-stk-block', dataset: { testid: 'staking-dashboard', account: opts.accountId, network: this.network } },
      el('h3', { className: 'label ta-stk-h' }, `WEALTH DASHBOARD · ${opts.accountId}`),
      this.status,
      this.body,
    );
  }

  load(): Promise<void> {
    const pool = fetchWalletPool(this.doFetch, this.auth, this.opts.accountId).then((p) => { if (p) this.pool = p; });
    return Promise.all([this.refetch(), pool]).then(() => this.startTicker());
  }

  /**
   * Mock vs real chain must come from the server: a mock wallet may be named `*.near`, which the account-suffix guess
   * (`detectStakingNetwork`) reads as mainnet and would route actions to a wallet signer instead of the mock REST.
   */
  setNetwork(network: StakingNetwork): void {
    if (network === this.network) return;
    this.network = network;
    this.el.dataset.network = network;
    if (this.perf) this.render(this.perf);
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
    this.receivedAtMs = this.now();
    this.el.dataset.state = 'ready';
    this.status.textContent = '';
    this.render(res.perf);
    return true;
  }

  private render(p: StakingPerformanceResponse): void {
    const nowMs = this.effectiveNowMs(p);
    this.kpi = renderKpiStrip(p, nowMs, {
      onCompound: () => void this.compound(),
      onTopUp: (amount) => this.consolePart.setAmount(String(amount)),
    });
    if (this.chart) this.chart.update(p.series);
    else this.chart = renderChart(p.series, (w) => void this.setWindow(w));
    this.consolePart.update(p, nowMs);
    this.hosts.kpi.replaceChildren(this.kpi.el);
    this.hosts.ai.replaceChildren(renderAiBudget(p.aiBudget, p.perks.tier));
    this.hosts.patron.replaceChildren(
      renderPatronCard(p, {
        accountId: this.opts.accountId, network: this.network, origin: this.opts.origin ?? location.origin,
        selectorFactory: this.opts.selectorFactory, openWindow: this.opts.openWindow,
        onNominate: (planetId) => void this.nominate(planetId),
      }),
    );
    this.hosts.tx.replaceChildren(renderTxTable(p.txs));
    if (this.body.childElementCount === 0) {
      this.body.replaceChildren(this.hosts.kpi, this.hosts.ai, this.chart.el, this.hosts.patron, this.consolePart.el, this.hosts.tx);
    }
    this.tickYield();
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
    const amount = snap > 0 ? this.perf.balances.accruedYieldNear : formatMicroNear(live);
    return this.act((c) => runCompoundAction(c, this.perf!, amount));
  }

  private async nominate(planetId: string): Promise<void> {
    if (!planetId.trim()) {
      this.consolePart.setStatus('Enter a public planet ID to nominate.', 'error');
      return;
    }
    await this.act((c) => runNominatePlanetAction(c, planetId));
  }

  private async profits(usdc: string): Promise<void> {
    this.consolePart.setQuote('');
    await this.act((c) => runStakeProfitsAction(c, usdc));
  }

  private async act(run: (c: ActionContext) => Promise<ActionResult>): Promise<void> {
    if (!this.perf) return;
    this.consolePart.setBusy(true);
    this.consolePart.setStatus('Working…', 'info');
    const res = await run(this.ctx());
    if (res.quote) this.consolePart.setQuote(res.quote);
    if (res.ok) await this.refetch();
    this.consolePart.setBusy(false);
    this.consolePart.setStatus(res.message, res.ok ? 'ok' : res.unavailable ? 'info' : 'error');
  }

  private startTicker(): void {
    const ms = this.opts.tickMs ?? 250;
    if (ms <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      if (this.el.isConnected) this.wasConnected = true;
      else if (this.wasConnected) return this.dispose();
      this.tickYield();
      this.consolePart.tick(this.effectiveNowMs());
    }, ms);
  }

  /** Server clock (`asOfMs`) plus monotonic elapsed time since snapshot arrival (`time.warp`-safe). */
  private effectiveNowMs(p: StakingPerformanceResponse | null = this.perf): number {
    if (!p) return this.now();
    return p.asOfMs + Math.max(0, this.now() - this.receivedAtMs);
  }

  private liveYieldNear(p: StakingPerformanceResponse): number {
    const rate = yieldPerSecondNear(totalStakedNear(p.balances), p.apy.netApyBp);
    return tickedYieldNear(Number(p.balances.accruedYieldNear), rate, Math.max(0, this.now() - this.receivedAtMs));
  }

  /** Client-side live counter: accrued yield plus the net APY per second since the last snapshot. */
  private tickYield(): void {
    const p = this.perf;
    if (!p || !this.kpi) return;
    const rate = yieldPerSecondNear(totalStakedNear(p.balances), p.apy.netApyBp);
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
  return { el: d.el, ready: d.load(), setNetwork: (n) => d.setNetwork(n), dispose: () => d.dispose() };
}
