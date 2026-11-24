import { IntentsTokensResponse, type IntentsQuoteRequest, type IntentsTokenInfo } from '@terra/contracts';
import type { TradeClient } from '../api/client';
import { h, note } from './dom';
import { rampAmountToAtomic } from './rampAmount';

type PresetOption = IntentsTokenInfo;

/** Optional wiring: `isMainnet` is the trade page's NEAR network (`/v1/near/status`); a live quote also needs the confirm box. */
export interface RampViewOptions { readonly isMainnet?: () => boolean }

const DEFAULT_PRESETS: readonly PresetOption[] = [
  { assetId: 'nep141:wrap.near', symbol: 'NEAR', decimals: 24, blockchain: 'near' },
  { assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', symbol: 'USDC', decimals: 6, blockchain: 'near' },
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'base' },
  { assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'arbitrum' },
];

export class RampView {
  readonly root: HTMLElement;
  private readonly fromSelect: HTMLSelectElement;
  private readonly toSelect: HTMLSelectElement;
  private readonly amountInput: HTMLInputElement;
  private readonly output: HTMLElement;
  private readonly confirmBox: HTMLInputElement;
  private readonly confirmRow: HTMLElement;
  private readonly decimals = new Map<string, number>();

  constructor(private readonly client: TradeClient, private readonly opts: RampViewOptions = {}) {
    this.fromSelect = h('select', { class: 'input tr-input', 'data-testid': 'ramp-origin' }) as HTMLSelectElement;
    this.toSelect = h('select', { class: 'input tr-input', 'data-testid': 'ramp-dest' }) as HTMLSelectElement;
    this.amountInput = h('input', {
      class: 'input tr-input',
      type: 'text',
      value: '1',
      inputmode: 'decimal',
      'aria-label': 'Amount in the origin token (human units)',
      'data-testid': 'ramp-amount',
    }) as HTMLInputElement;
    this.output = h('div', { class: 'tr-ramp-out', 'data-testid': 'ramp-quote-result' },
      note('Select cross-chain origin asset and fetch a dry 1Click solver quote (no mainnet broadcast).'));

    this.confirmBox = h('input', { type: 'checkbox', 'data-testid': 'ramp-confirm-mainnet' }) as HTMLInputElement;
    this.confirmRow = h('label', { class: 'tr-note tr-note-warn', 'data-testid': 'ramp-confirm-row' },
      this.confirmBox, ' I understand this is a live Mainnet quote');
    this.confirmRow.hidden = true;

    const quoteBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', 'data-testid': 'ramp-quote-btn' }, 'Quote 1Click Swap') as HTMLButtonElement;
    quoteBtn.onclick = () => { void this.fetchQuote(); };

    const rheaLink = h('a', {
      href: 'https://app.rhea.finance/',
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'btn btn-ghost btn-sm',
    }, 'Rhea Finance Pools ↗');

    this.root = h('div', { class: 'tr-ramp plate-sm', 'data-testid': 'trade-1click-ramp' },
      h('div', { class: 'tr-ramp-row' }, this.fromSelect, h('span', {}, '→'), this.toSelect),
      h('div', { class: 'tr-ramp-row' }, this.amountInput, quoteBtn, rheaLink),
      this.confirmRow, this.output);

    this.root.addEventListener('focusin', () => { this.live(); });
    this.populate(DEFAULT_PRESETS);
    void this.loadTokens();
  }

  private populate(items: readonly PresetOption[]): void {
    for (const item of items) this.decimals.set(item.assetId, item.decimals);
    const prevFrom = this.fromSelect.value;
    const prevTo = this.toSelect.value;
    this.fromSelect.replaceChildren();
    this.toSelect.replaceChildren();
    for (const item of items) {
      const label = `${item.symbol} (${item.blockchain.toUpperCase()})`;
      this.fromSelect.append(new Option(label, item.assetId));
      this.toSelect.append(new Option(label, item.assetId));
    }
    const has = (id: string) => items.some((i) => i.assetId === id);
    this.fromSelect.value = has(prevFrom) ? prevFrom : items[0]?.assetId ?? '';
    this.toSelect.value = has(prevTo) ? prevTo : items[1]?.assetId ?? items[0]?.assetId ?? '';
  }

  private async loadTokens(): Promise<void> {
    try {
      const res = await this.client.fetchFn()('/v1/near/intents/tokens', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const body = IntentsTokensResponse.safeParse(await res.json());
      if (!body.success) return;
      for (const t of body.data.tokens) this.decimals.set(t.assetId, t.decimals);
      if (body.data.presets.length > 0) this.populate(body.data.presets);
    } catch { /* non-blocking */ }
  }

  /** Re-syncs the mainnet confirmation visibility after `/v1/near/status` resolves. */
  syncMode(): void {
    this.live();
  }

  /** Live only on Mainnet and after the explicit confirm; every other case is a dry quote (HACKATHON.md Q-007). */
  private live(): boolean {
    const mainnet = this.opts.isMainnet?.() === true;
    this.confirmRow.hidden = !mainnet;
    return mainnet && this.confirmBox.checked;
  }

  private async fetchQuote(): Promise<void> {
    const origin = this.fromSelect.value;
    const dec = this.decimals.get(origin);
    if (dec === undefined) { this.output.replaceChildren(note('Unknown origin token decimals; pick a token from the list.', 'err')); return; }
    const amount = rampAmountToAtomic(this.amountInput.value, dec);
    if (!amount.ok) { this.output.replaceChildren(note(amount.error, 'err')); return; }
    const live = this.live();
    const req: IntentsQuoteRequest = {
      originAsset: origin,
      destinationAsset: this.toSelect.value,
      amount: amount.atomic,
      dry: !live,
      ...(live ? { confirmMainnet: true } : {}),
    };
    this.output.replaceChildren(note(`Querying 1Click ${live ? 'LIVE Mainnet' : 'dry'} quote for ${amount.atomic} atomic…`));
    try {
      const res = await this.client.fetchFn()('/v1/near/intents/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      const body = (await res.json().catch(() => ({}))) as {
        source?: string;
        amountOutFormatted?: string;
        minAmountOut?: string;
        timeEstimateSec?: number;
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        this.output.replaceChildren(note(body.error?.message || body.message || 'Quote validation failed.', 'err'));
        return;
      }
      this.output.replaceChildren(
        note(`Quote (${body.source ?? '1click'}): ${amount.atomic} atomic in -> ~${body.amountOutFormatted ?? '?'} out · min atomic ${body.minAmountOut ?? '?'} · ~${body.timeEstimateSec ?? 15}s`),
      );
    } catch {
      this.output.replaceChildren(note('Unable to reach /v1/near/intents/quote.', 'err'));
    }
  }
}
