import type { TradeClient } from '../api/client';
import { h, note } from './dom';

interface PresetOption {
  readonly assetId: string;
  readonly symbol: string;
  readonly blockchain: string;
}

const DEFAULT_PRESETS: readonly PresetOption[] = [
  { assetId: 'nep141:wrap.near', symbol: 'NEAR', blockchain: 'near' },
  { assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', symbol: 'USDC', blockchain: 'near' },
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', symbol: 'USDC', blockchain: 'base' },
  { assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', symbol: 'USDC', blockchain: 'arbitrum' },
];

export class RampView {
  readonly root: HTMLElement;
  private readonly fromSelect: HTMLSelectElement;
  private readonly toSelect: HTMLSelectElement;
  private readonly amountInput: HTMLInputElement;
  private readonly output: HTMLElement;

  constructor(private readonly client: TradeClient) {
    this.fromSelect = h('select', { class: 'input tr-input', 'data-testid': 'ramp-origin' }) as HTMLSelectElement;
    this.toSelect = h('select', { class: 'input tr-input', 'data-testid': 'ramp-dest' }) as HTMLSelectElement;
    this.amountInput = h('input', {
      class: 'input tr-input',
      type: 'text',
      value: '1000000000000000000000000',
      'data-testid': 'ramp-amount',
    }) as HTMLInputElement;
    this.output = h('div', { class: 'tr-ramp-out', 'data-testid': 'ramp-quote-result' },
      note('Select cross-chain origin asset and fetch a dry 1Click solver quote (no mainnet broadcast).'));

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
      this.output);

    this.populate(DEFAULT_PRESETS);
    void this.loadTokens();
  }

  private populate(items: readonly PresetOption[]): void {
    const prevFrom = this.fromSelect.value;
    const prevTo = this.toSelect.value;
    this.fromSelect.replaceChildren();
    this.toSelect.replaceChildren();
    for (const item of items) {
      const label = `${item.symbol} (${item.blockchain.toUpperCase()})`;
      this.fromSelect.append(new Option(label, item.assetId));
      this.toSelect.append(new Option(label, item.assetId));
    }
    this.fromSelect.value = prevFrom || items[0]?.assetId || '';
    this.toSelect.value = prevTo || items[1]?.assetId || items[0]?.assetId || '';
  }

  private async loadTokens(): Promise<void> {
    try {
      const res = await this.client.fetchFn()('/v1/near/intents/tokens', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const body = (await res.json()) as { presets?: PresetOption[] };
      if (Array.isArray(body.presets) && body.presets.length > 0) this.populate(body.presets);
    } catch { /* non-blocking */ }
  }

  private async fetchQuote(): Promise<void> {
    this.output.replaceChildren(note('Querying 1Click solver quote…'));
    try {
      const res = await this.client.fetchFn()('/v1/near/intents/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          originAsset: this.fromSelect.value,
          destinationAsset: this.toSelect.value,
          amount: this.amountInput.value.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        source?: string;
        amountOutFormatted?: string;
        minAmountOut?: string;
        timeEstimateSec?: number;
        message?: string;
      };
      if (!res.ok) {
        this.output.replaceChildren(note(body.message || 'Quote validation failed.', 'err'));
        return;
      }
      this.output.replaceChildren(
        note(`Quote (${body.source ?? '1click'}): ~${body.amountOutFormatted ?? '?'} out · min atomic ${body.minAmountOut ?? '?'} · ~${body.timeEstimateSec ?? 15}s`),
      );
    } catch {
      this.output.replaceChildren(note('Unable to reach /v1/near/intents/quote.', 'err'));
    }
  }
}
