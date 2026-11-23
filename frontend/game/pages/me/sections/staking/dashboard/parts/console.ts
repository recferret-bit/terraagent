import { STAKING_ASSETS, type StakingAsset, type StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip } from '../../../../parts/helpTip';
import { formatNear } from '../../stakingMath';
import { earlyExitFeeNear, formatCountdown, totalStakedNear } from '../dashboardMath';
import './console.css';

export interface ConsoleHandlers {
  readonly onStake: (amount: string, asset: StakingAsset) => void;
  readonly onCompound: () => void;
  readonly onUnstake: (amount: string, asset: StakingAsset) => void;
  readonly onWithdraw: (asset: StakingAsset) => void;
  readonly onProfits: (amountUsdc: string) => void;
  readonly onFaucet?: () => void;
}

export interface ConsolePart {
  readonly el: HTMLElement;
  update(p: StakingPerformanceResponse, nowMs: number): void;
  /** Re-renders the early-exit preview and the unbonding countdown (called by the ticker). */
  tick(nowMs: number): void;
  selectedAsset(): StakingAsset;
  setCanCompound(show: boolean): void;
  setLocalMode(enabled: boolean): void;
  setAmount(amountNear: string, focus?: boolean): void;
  setStatus(message: string, tone: 'ok' | 'error' | 'info'): void;
  setQuote(line: string): void;
  setBusy(busy: boolean): void;
}

const ASSET_LABEL: Record<StakingAsset, string> = { near: 'Native NEAR', stNEAR: 'stNEAR', LiNEAR: 'LiNEAR' };
const MAX_AMOUNT = /^\d+(\.\d{1,24})?$/;
const QUICK_AMOUNTS = [10, 50, 200] as const;

export const isValidAmount = (text: string): boolean => MAX_AMOUNT.test(text.trim()) && Number(text) > 0;

function field(label: string, control: HTMLElement, id: string): HTMLElement {
  const l = el('label', { className: 'label' }, label);
  l.htmlFor = id;
  control.id = id;
  return el('div', { className: 'ta-stk-field ta-stk-console-field' }, l, control);
}

const btn = (testid: string, text: string, cls: string, run: () => void): HTMLButtonElement =>
  el('button', { className: `btn ${cls}`, type: 'button', dataset: { testid }, onClick: run }, text);

function buildInputs(initialAmount: string) {
  const asset = el('select', { className: 'input ta-stk-console-control', dataset: { testid: 'staking-console-asset' } });
  for (const a of STAKING_ASSETS) asset.append(new Option(ASSET_LABEL[a], a));
  const amount = el('input', { className: 'input ta-stk-console-control', type: 'number', dataset: { testid: 'staking-console-amount' } });
  amount.min = '0';
  amount.step = 'any';
  amount.inputMode = 'decimal';
  amount.value = initialAmount;
  const usdc = el('input', { className: 'input ta-stk-console-control', type: 'number', dataset: { testid: 'staking-console-usdc' } });
  usdc.min = '0';
  usdc.step = 'any';
  usdc.value = '10.00';
  return { asset, amount, usdc };
}

function updateEarlyExitNotice(
  perf: StakingPerformanceResponse | null,
  amountText: string,
  nowMs: number,
  notice: HTMLElement,
  free: HTMLElement,
): void {
  const bp = perf?.timers.earlyExitFeeBp ?? 0;
  const staked = perf ? totalStakedNear(perf.balances) : 0;
  const freeAt = perf?.timers.earlyExitFreeAtMs ?? null;
  const active = bp > 0 && (freeAt ?? 0) > nowMs && staked > 0;
  notice.hidden = !active;
  free.hidden = active || staked <= 0;
  if (active) {
    const fee = earlyExitFeeNear(Number(amountText) || 0, bp);
    const shortWindow = freeAt !== null && freeAt - nowMs <= 3_600_000;
    const windowPhrase = shortWindow ? 'before your 1-minute local maturity window' : 'within 7 days of your last deposit';
    notice.dataset.feeBp = String(bp);
    notice.textContent = `Early exit: unstaking ${windowPhrase} pays ${(bp / 100).toFixed(2)} % to the Protocol${fee > 0 ? ` (about ${fee.toFixed(6)} NEAR on this amount)` : ''}. Free after ${formatCountdown(freeAt, nowMs)}; compounding never resets the clock.`;
  }
}

function updateUnbondingCountdown(perf: StakingPerformanceResponse | null, nowMs: number, countdown: HTMLElement): void {
  const ready = perf?.timers.unbondingReadyAtMs ?? null;
  const unbonding = Number(perf?.balances.unbondingNear ?? '0') > 0 && ready !== null && ready > nowMs;
  countdown.hidden = !unbonding;
  if (unbonding) countdown.textContent = `Unbonding ${formatNear(Number(perf?.balances.unbondingNear))}: withdrawable in ${formatCountdown(ready, nowMs)}`;
}

interface ConsoleControls {
  readonly stake: HTMLButtonElement;
  readonly compound: HTMLButtonElement;
  readonly unstake: HTMLButtonElement;
  readonly withdraw: HTMLButtonElement;
  readonly profits: HTMLButtonElement;
  readonly faucet: HTMLButtonElement;
}

function buildActionButtons(
  amount: HTMLInputElement,
  asset: HTMLSelectElement,
  usdc: HTMLInputElement,
  h: ConsoleHandlers,
  setError: (msg: string) => void,
): ConsoleControls {
  const requireValidAmount = (): boolean => {
    if (isValidAmount(amount.value)) return true;
    setError('Enter an amount greater than 0.');
    return false;
  };
  return {
    stake: btn('staking-console-stake', 'Stake', 'btn-primary btn-sm', () => requireValidAmount() && h.onStake(amount.value.trim(), asset.value as StakingAsset)),
    compound: btn('staking-console-compound', '↻ Compound Yield', 'btn-ghost btn-sm', h.onCompound),
    unstake: btn('staking-console-unstake', 'Unstake', 'btn-ghost btn-sm', () => requireValidAmount() && h.onUnstake(amount.value.trim(), asset.value as StakingAsset)),
    withdraw: btn('staking-console-withdraw', 'Withdraw to Wallet', 'btn-ghost btn-sm', () => h.onWithdraw(asset.value as StakingAsset)),
    profits: btn('staking-stake-profits-btn', '⚡ Stake Profits (USDC → stNEAR)', 'btn-primary btn-sm', () =>
      isValidAmount(usdc.value) ? h.onProfits(usdc.value.trim()) : setError('Enter a USDC amount greater than 0.')),
    faucet: btn('staking-local-faucet-btn', '+ Local Faucet (500 NEAR · 100 USDC)', 'btn-ghost btn-sm', () => h.onFaucet?.()),
  };
}

function applyConsoleBusyState(
  allButtons: readonly HTMLButtonElement[],
  btns: ConsoleControls,
  isBusy: boolean,
  withdrawEmpty: boolean,
  unstakeEmpty: boolean,
): void {
  for (const b of allButtons) {
    if (isBusy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.dataset.busy = isBusy ? '1' : '0';
  }
  btns.stake.disabled = isBusy;
  btns.compound.disabled = isBusy;
  btns.profits.disabled = isBusy;
  btns.faucet.disabled = isBusy;
  btns.withdraw.disabled = isBusy || withdrawEmpty;
  btns.unstake.disabled = isBusy || unstakeEmpty;
}

function buildQuickChips(setPreset: (val: string) => void, getMax: () => string): HTMLElement {
  const chips = QUICK_AMOUNTS.map((v) =>
    el('button', { className: 'ta-stk-preset-btn', type: 'button', dataset: { testid: `staking-console-preset-${v}` }, onClick: () => setPreset(String(v)) }, `+${v}`),
  );
  chips.push(
    el('button', { className: 'ta-stk-preset-btn', type: 'button', dataset: { testid: 'staking-console-preset-max' }, onClick: () => setPreset(getMax()) }, 'MAX'),
  );
  return el('div', { className: 'ta-stk-presets', aria: { label: 'Quick amount presets' } }, ...chips);
}

interface ConsoleLayoutNodes {
  readonly asset: HTMLSelectElement;
  readonly amount: HTMLInputElement;
  readonly usdc: HTMLInputElement;
  readonly btns: ConsoleControls;
  readonly free: HTMLElement;
  readonly notice: HTMLElement;
  readonly yieldSummary: HTMLElement;
  readonly countdown: HTMLElement;
  readonly quote: HTMLElement;
  readonly quickChips: HTMLElement;
}

function buildWorkbenchGrid(n: ConsoleLayoutNodes): HTMLElement {
  const positionPane = el(
    'div',
    { className: 'ta-stk-console-pane plate-sm' },
    el('div', { className: 'ta-stk-console-pane-head' }, el('span', { className: 'label c-orange-hi' }, 'POSITION · STAKE OR UNSTAKE'), n.free),
    el('div', { className: 'ta-stk-console-fields' }, field('ASSET', n.asset, 'staking-console-asset-select'), field('AMOUNT (NEAR)', n.amount, 'staking-console-amount-input')),
    n.quickChips,
    n.notice,
    el('div', { className: 'ta-stk-chips' }, n.btns.stake, n.btns.unstake),
  );
  const secondaryStack = el(
    'div',
    { className: 'ta-stk-console-stack' },
    el(
      'div',
      { className: 'ta-stk-console-pane plate-sm' },
      el('div', { className: 'ta-stk-console-pane-head' }, el('span', { className: 'label' }, 'YIELD & UNBONDING')),
      n.yieldSummary,
      n.countdown,
      el('div', { className: 'ta-stk-chips' }, n.btns.compound, n.btns.withdraw),
    ),
    el(
      'div',
      { className: 'ta-stk-console-pane plate-sm' },
      el('div', { className: 'ta-stk-console-pane-head' }, el('span', { className: 'label' }, 'REINVEST EXCHANGE PROFITS')),
      el('div', { className: 'ta-stk-console-profit-row' }, field('TRADE PROFIT (USDC)', n.usdc, 'staking-console-usdc-input'), n.btns.profits),
      n.quote,
    ),
  );
  return el('div', { className: 'ta-stk-console-grid' }, positionPane, secondaryStack);
}

/** 2-column Action Console workbench: Position (Stake/Unstake + quick chips), Yield/Unbonding, and USDC Profits. */
export function renderConsole(initialAmount: string, h: ConsoleHandlers, now: () => number = Date.now): ConsolePart {
  const { asset, amount, usdc } = buildInputs(initialAmount);
  const walletBadge = el('span', { className: 'ta-stk-badge ta-stk-wallet-chip', dataset: { testid: 'staking-console-wallet' } }, 'Wallet: —');
  const stakedBadge = el('span', { className: 'ta-stk-badge ta-stk-wallet-chip', dataset: { testid: 'staking-console-staked' } }, 'Staked: —');
  const notice = el('p', { className: 'ta-stk-notice', dataset: { testid: 'staking-early-exit-notice' } });
  const free = el('span', { className: 'ta-stk-badge ta-stk-console-free', dataset: { testid: 'staking-early-exit-free' } }, '0% early-exit unlocked');
  const countdown = el('p', { className: 'ta-stk-sub', dataset: { testid: 'staking-unbonding-countdown' } });
  const yieldSummary = el('p', { className: 'ta-stk-sub ta-stk-console-meta' }, 'Compound accrued rewards or withdraw matured principal.');
  const status = el('p', { className: 'ta-stk-status ta-stk-console-status', role: 'status', dataset: { testid: 'staking-console-status' } });
  const quote = el('p', { className: 'ta-stk-sub ta-stk-console-quote', dataset: { testid: 'staking-profits-quote' } });

  const setError = (msg: string): void => { status.textContent = msg; status.dataset.tone = 'error'; };
  const btns = buildActionButtons(amount, asset, usdc, h, setError);
  btns.faucet.hidden = !h.onFaucet;
  const allButtons = [btns.stake, btns.compound, btns.unstake, btns.withdraw, btns.profits, btns.faucet];
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-console',
      title: 'ACTION CONSOLE',
      description:
        'Execute wallet-first staking actions: stake NEAR / stNEAR / LiNEAR, compound accrued yield at 0% fee, unstake, withdraw matured principal, or swap USDC trade profits into stNEAR. In local mode, unbonding & warmup take 1 minute.',
    },
    el('h3', { className: 'label ta-stk-h' }, 'ACTION CONSOLE'),
    el('div', { className: 'ta-stk-chips' }, walletBadge, stakedBadge, btns.faucet),
  );

  let perf: StakingPerformanceResponse | null = null;
  let withdrawEmpty = true;
  let unstakeEmpty = true;
  let isBusy = false;
  const syncDisabled = (): void => applyConsoleBusyState(allButtons, btns, isBusy, withdrawEmpty, unstakeEmpty);
  const refresh = (nowMs: number): void => { updateEarlyExitNotice(perf, amount.value, nowMs, notice, free); updateUnbondingCountdown(perf, nowMs, countdown); };
  amount.addEventListener('input', () => refresh(now()));
  const quickChips = buildQuickChips(
    (v) => { amount.value = v; refresh(now()); },
    () => {
      const walletVal = Number(perf?.balances.walletNear ?? '0');
      const stakedVal = perf ? totalStakedNear(perf.balances) : 0;
      const chosen = walletVal > 0 ? walletVal : stakedVal;
      return chosen > 0 ? String(Math.floor(chosen * 1000) / 1000) : amount.value;
    },
  );
  const grid = buildWorkbenchGrid({ asset, amount, usdc, btns, free, notice, yieldSummary, countdown, quote, quickChips });

  return {
    el: el('div', { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-console' } }, header.head, header.panel, grid, status),
    update(p, nowMs) {
      perf = p;
      const total = totalStakedNear(p.balances);
      walletBadge.textContent = `Wallet: ${formatNear(Number(p.balances.walletNear))}`;
      stakedBadge.textContent = `Staked: ${formatNear(total)}`;
      btns.compound.hidden = !(Number(p.balances.accruedYieldNear) > 0);
      const withdrawable = Number(p.balances.withdrawableNear);
      const hasWithdrawable = withdrawable > 0;
      withdrawEmpty = !hasWithdrawable;
      unstakeEmpty = !(Number(p.balances.activeStakedNear) > 0 || p.balances.lst.length > 0);
      yieldSummary.textContent = hasWithdrawable ? `Ready to withdraw: ${formatNear(withdrawable)}` : 'Compound accrued rewards or withdraw matured principal.';
      btns.withdraw.classList.toggle('btn-primary', hasWithdrawable);
      btns.withdraw.classList.toggle('btn-ghost', !hasWithdrawable);
      btns.withdraw.title = withdrawEmpty ? 'Nothing withdrawable yet' : `Withdraw ${formatNear(withdrawable)}`;
      syncDisabled();
      refresh(nowMs);
    },
    tick: refresh,
    selectedAsset: () => asset.value as StakingAsset,
    setCanCompound(show) { btns.compound.hidden = !show; },
    setLocalMode(enabled) { btns.faucet.hidden = !enabled || !h.onFaucet; },
    setAmount(v, focus = false) {
      amount.value = v;
      refresh(now());
      if (focus) amount.focus();
    },
    setStatus(message, tone) { status.textContent = message; status.dataset.tone = tone; },
    setQuote(line) { quote.textContent = line; },
    setBusy(busy) { isBusy = busy; syncDisabled(); },
  };
}
