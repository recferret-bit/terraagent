import { STAKING_ASSETS, type StakingAsset, type StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { formatNear } from '../../stakingMath';
import { earlyExitFeeNear, formatCountdown } from '../dashboardMath';

export interface ConsoleHandlers {
  readonly onStake: (amount: string, asset: StakingAsset) => void;
  readonly onCompound: () => void;
  readonly onUnstake: (amount: string, asset: StakingAsset) => void;
  readonly onWithdraw: (asset: StakingAsset) => void;
  readonly onProfits: (amountUsdc: string) => void;
}

export interface ConsolePart {
  readonly el: HTMLElement;
  update(p: StakingPerformanceResponse, nowMs: number): void;
  /** Re-renders the early-exit preview and the unbonding countdown (called by the 1 s ticker). */
  tick(nowMs: number): void;
  setAmount(amountNear: string): void;
  setStatus(message: string, tone: 'ok' | 'error' | 'info'): void;
  setQuote(line: string): void;
  setBusy(busy: boolean): void;
}

const ASSET_LABEL: Record<StakingAsset, string> = { near: 'Native NEAR', stNEAR: 'stNEAR', LiNEAR: 'LiNEAR' };
const MAX_AMOUNT = /^\d+(\.\d{1,24})?$/;

export const isValidAmount = (text: string): boolean => MAX_AMOUNT.test(text.trim()) && Number(text) > 0;

function field(label: string, control: HTMLElement, id: string): HTMLElement {
  const l = el('label', { className: 'label' }, label);
  l.htmlFor = id;
  control.id = id;
  return el('div', { className: 'ta-stk-field' }, l, control);
}

/** Action console: asset picker, amount, Stake / Compound / Unstake / Withdraw, trade-profit staking, unbonding countdown. */
export function renderConsole(initialAmount: string, h: ConsoleHandlers, now: () => number = Date.now): ConsolePart {
  const asset = el('select', { className: 'input', dataset: { testid: 'staking-console-asset' } });
  for (const a of STAKING_ASSETS) asset.append(new Option(ASSET_LABEL[a], a));
  const amount = el('input', { className: 'input ta-stk-input', type: 'number', dataset: { testid: 'staking-console-amount' } });
  amount.min = '0';
  amount.step = 'any';
  amount.inputMode = 'decimal';
  amount.value = initialAmount;
  const usdc = el('input', { className: 'input ta-stk-input', type: 'number', dataset: { testid: 'staking-console-usdc' } });
  usdc.min = '0';
  usdc.step = 'any';
  usdc.value = '10.00';
  const notice = el('p', { className: 'ta-stk-notice', dataset: { testid: 'staking-early-exit-notice' } });
  const free = el('p', { className: 'ta-stk-sub', dataset: { testid: 'staking-early-exit-free' } }, '0 % early-exit fee after 7 days.');
  const countdown = el('p', { className: 'ta-stk-sub', dataset: { testid: 'staking-unbonding-countdown' } });
  const status = el('p', { className: 'ta-stk-status', role: 'status', dataset: { testid: 'staking-console-status' } });
  const quote = el('p', { className: 'ta-stk-sub', dataset: { testid: 'staking-profits-quote' } });
  const btn = (testid: string, text: string, cls: string, run: () => void): HTMLButtonElement =>
    el('button', { className: `btn ${cls}`, type: 'button', dataset: { testid }, onClick: run }, text);
  const bad = (): boolean => {
    if (isValidAmount(amount.value)) return false;
    part.setStatus('Enter an amount greater than 0.', 'error');
    return true;
  };
  const stake = btn('staking-console-stake', 'Stake', 'btn-primary', () => !bad() && h.onStake(amount.value.trim(), asset.value as StakingAsset));
  const compound = btn('staking-console-compound', '↻ Compound Yield', '', h.onCompound);
  const unstake = btn('staking-console-unstake', 'Unstake', '', () => !bad() && h.onUnstake(amount.value.trim(), asset.value as StakingAsset));
  const withdraw = btn('staking-console-withdraw', 'Withdraw to Wallet', '', () => h.onWithdraw(asset.value as StakingAsset));
  const profits = btn('staking-stake-profits-btn', '⚡ Stake Trade Profits (USDC → stNEAR)', 'btn-primary', () =>
    isValidAmount(usdc.value) ? h.onProfits(usdc.value.trim()) : part.setStatus('Enter a USDC amount greater than 0.', 'error'));
  const buttons = [stake, compound, unstake, withdraw, profits];

  let perf: StakingPerformanceResponse | null = null;
  const refreshNotice = (nowMs: number): void => {
    const bp = perf?.timers.earlyExitFeeBp ?? 0;
    const staked = Number(perf?.balances.activeStakedNear ?? '0');
    const active = bp > 0 && (perf?.timers.earlyExitFreeAtMs ?? 0) > nowMs && staked > 0;
    notice.hidden = !active;
    free.hidden = active || staked <= 0;
    if (active) {
      const fee = earlyExitFeeNear(Number(amount.value) || 0, bp);
      notice.dataset.feeBp = String(bp);
      notice.textContent = `Early exit: unstaking within 7 days of your last deposit pays ${(bp / 100).toFixed(2)} % to the Protocol${fee > 0 ? ` (about ${fee.toFixed(6)} NEAR on this amount)` : ''}. Free after ${formatCountdown(perf?.timers.earlyExitFreeAtMs ?? null, nowMs)}; compounding never resets the clock.`;
    }
  };
  const refreshCountdown = (nowMs: number): void => {
    const ready = perf?.timers.unbondingReadyAtMs ?? null;
    const unbonding = Number(perf?.balances.unbondingNear ?? '0') > 0 && ready !== null;
    countdown.hidden = !unbonding;
    if (unbonding) countdown.textContent = `Unbonding ${formatNear(Number(perf?.balances.unbondingNear))}: withdrawable in ${formatCountdown(ready, nowMs)}`;
  };
  const part: ConsolePart = {
    el: el('div', { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-console' } },
      el('h3', { className: 'label ta-stk-h' }, 'ACTION CONSOLE'),
      el('div', { className: 'ta-stk-top' }, field('ASSET', asset, 'staking-console-asset-select'), field('AMOUNT (NEAR)', amount, 'staking-console-amount-input')),
      el('div', { className: 'ta-stk-chips' }, stake, compound, unstake, withdraw),
      notice, free, countdown,
      el('div', { className: 'ta-stk-top' }, field('TRADE PROFIT (USDC)', usdc, 'staking-console-usdc-input'), profits),
      quote, status),
    update(p, nowMs) {
      perf = p;
      compound.hidden = !(Number(p.balances.accruedYieldNear) > 0);
      withdraw.disabled = !(Number(p.balances.withdrawableNear) > 0);
      withdraw.title = withdraw.disabled ? 'Nothing withdrawable yet' : `Withdraw ${formatNear(Number(p.balances.withdrawableNear))}`;
      unstake.disabled = !(Number(p.balances.activeStakedNear) > 0 || p.balances.lst.length > 0);
      part.tick(nowMs);
    },
    tick(nowMs) {
      refreshNotice(nowMs);
      refreshCountdown(nowMs);
    },
    setAmount(v) {
      amount.value = v;
      refreshNotice(now());
    },
    setStatus(message, tone) {
      status.textContent = message;
      status.dataset.tone = tone;
    },
    setQuote(line) {
      quote.textContent = line;
    },
    setBusy(busy) {
      for (const b of buttons) if (busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
      for (const b of buttons) b.dataset.busy = busy ? '1' : '0';
    },
  };
  amount.addEventListener('input', () => refreshNotice(now()));
  return part;
}
