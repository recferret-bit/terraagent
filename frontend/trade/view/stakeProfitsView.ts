import { formatAtomic, parseDecimalToAtomic, StakeProfitsResponse, type StakeProfitsRequest } from '@terra/contracts';
import { h } from './dom';

export type NearMode = 'mock' | 'testnet' | 'mainnet';

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
const USDC_DECIMALS = 6;

export interface StakeProfitsDeps {
  doFetch(input: string, init?: RequestInit): Promise<Response>;
  token: string;
  accountId: () => string | null;
  /** `mock` stakes for real in the mock chain; testnet / mainnet only ask for the quote (`dry: true`). */
  mode: () => NearMode;
  /** After a real stake: the page refreshes perks and balances. */
  onStaked(): void;
}

/** Why the amount cannot be sent, or `null` when it is a positive USDC amount within `freeMicro`. */
export function validateUsdcAmount(text: string, freeMicro: bigint): string | null {
  const t = text.trim();
  if (!AMOUNT_RE.test(t)) return 'Enter a USDC amount with at most 6 decimals (e.g. 12.50).';
  const micro = parseDecimalToAtomic(t, USDC_DECIMALS);
  if (micro <= 0n) return 'Amount must be greater than 0.';
  if (micro > freeMicro) return `Only ${formatAtomic('USDC', freeMicro)} USDC is free in your wallet.`;
  return null;
}

/** `[⚡ Stake Trade Profits]` button + inline confirm: USDC input -> `POST /v1/near/stake/profits` (W28-11). */
export class StakeProfitsControl {
  readonly button: HTMLButtonElement;
  readonly dialog: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly submitBtn: HTMLButtonElement;
  private readonly msg: HTMLElement;
  private freeMicro = 0n;
  private unavailable = false;
  private busy = false;

  constructor(private readonly d: StakeProfitsDeps) {
    this.button = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-testid': 'stake-profits-btn', onclick: () => this.toggle() }, '⚡ Stake Trade Profits');
    this.button.hidden = true;
    this.input = h('input', { class: 'input', 'data-testid': 'stake-profits-amount', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'USDC amount to stake' });
    this.submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-testid': 'stake-profits-submit', onclick: () => { void this.submit(); } });
    this.msg = h('p', { class: 'tr-note', 'data-testid': 'stake-profits-msg', role: 'status' });
    const max = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-testid': 'stake-profits-max', onclick: () => { this.input.value = formatAtomic('USDC', this.freeMicro); } }, 'MAX');
    const close = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-testid': 'stake-profits-cancel', onclick: () => { this.dialog.hidden = true; } }, 'CANCEL');
    this.dialog = h('div', { class: 'tr-stake-profits plate-sm', 'data-testid': 'stake-profits-confirm', role: 'dialog', 'aria-label': 'Stake trade profits' },
      h('p', { class: 'tr-hint' }, 'Swap USDC trade profits to stNEAR and stake them (NEAR Intents 1Click).'),
      h('div', { class: 'tr-row' }, this.input, max),
      h('div', { class: 'tr-row' }, this.submitBtn, close),
      this.msg);
    this.dialog.hidden = true;
    this.renderSubmitLabel();
  }

  /** Called on every balances change: the button shows while the wallet holds free USDC. */
  update(freeUsdcMicro: bigint): void {
    this.freeMicro = freeUsdcMicro;
    this.button.hidden = freeUsdcMicro <= 0n;
    if (this.button.hidden) this.dialog.hidden = true;
    this.renderSubmitLabel();
  }

  private renderSubmitLabel(): void {
    this.submitBtn.textContent = this.d.mode() === 'mock' ? 'STAKE' : 'GET QUOTE';
    this.submitBtn.disabled = this.busy || this.unavailable;
  }

  private toggle(): void {
    if (this.unavailable) return;
    this.dialog.hidden = !this.dialog.hidden;
    if (!this.dialog.hidden && !this.input.value) this.input.value = formatAtomic('USDC', this.freeMicro);
    this.msg.textContent = '';
  }

  private say(text: string, kind: 'info' | 'err' = 'info'): void {
    this.msg.className = `tr-note tr-note-${kind}`;
    this.msg.textContent = text;
  }

  private markUnavailable(): void {
    this.unavailable = true;
    this.button.disabled = true;
    this.button.title = 'Profit staking is not available on this server yet (W28).';
    this.dialog.hidden = true;
    this.renderSubmitLabel();
  }

  private async submit(): Promise<void> {
    const bad = validateUsdcAmount(this.input.value, this.freeMicro);
    if (bad) { this.say(bad, 'err'); return; }
    const dry = this.d.mode() !== 'mock';
    const accountId = this.d.accountId();
    const body: StakeProfitsRequest = { amountUsdc: this.input.value.trim(), dry, ...(accountId ? { accountId } : {}) };
    this.busy = true;
    this.renderSubmitLabel();
    try {
      const res = await this.d.doFetch('/v1/near/stake/profits', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(this.d.token ? { authorization: `Bearer ${this.d.token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (res.status === 404) { this.markUnavailable(); return; }
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) { this.say(errorText(json, res.status), 'err'); return; }
      const parsed = StakeProfitsResponse.safeParse(json);
      if (!parsed.success) { this.say('Unexpected response from the staking service.', 'err'); return; }
      this.showResult(parsed.data);
    } catch {
      this.say('Could not reach the staking service.', 'err');
    } finally {
      this.busy = false;
      this.renderSubmitLabel();
    }
  }

  private showResult(r: StakeProfitsResponse): void {
    const q = r.quote;
    if (q.dry || r.txHash === null) {
      this.say(`Quote: ${q.amountInUsdc} USDC -> ${q.amountOutNear} NEAR at $${q.nearUsd.toFixed(2)} (${q.source}). Dry run, nothing staked.`);
      return;
    }
    this.say(`Staked ${q.amountOutNear} NEAR from ${q.amountInUsdc} USDC${r.perks ? ` - ${r.perks.tierName}` : ''}.`);
    this.input.value = '';
    this.d.onStaked();
  }
}

function errorText(json: unknown, status: number): string {
  const e = (json as { error?: { message?: unknown } } | null)?.error;
  return typeof e?.message === 'string' && e.message ? e.message : `Request failed (${status}).`;
}
