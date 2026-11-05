import { formatAtomic, mockLabel, type MarketSnapshotResponse, type MarketTokenKey, type MyOrderView, type OrderSide, type ResourceKey } from '@terra/contracts';
import type { FeatureContext } from '../../../core/registry/types';
import { makeBtn, makeDiv } from '../../shared/dom';
import { failedText } from '../contracts/ContractsController';
import { myOrderRow } from './myOrders';
import { previewOrder, type OrderPreview } from './orderPreview';

export interface OrderPair { base: ResourceKey; quote: MarketTokenKey }
type EventList = ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>;
const REFRESH_DEBOUNCE_MS = 1000;
const REJECT_WINDOW_MS = 15_000;
const ttlLabel = (s: number): string => (s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);
const title = (text: string): HTMLElement => makeDiv('ta-market__title', undefined, text);
const span = (text: string, cls = 'ta-order__key'): HTMLElement => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };

function field(label: string, control: HTMLElement, testid: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'ta-order__field';
  control.dataset.testid = testid;
  wrap.append(span(label, ''), control);
  return wrap;
}
function textInput(mode: 'numeric' | 'decimal'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.inputMode = mode;
  i.autocomplete = 'off';
  return i;
}

/**
 * Order form + preview + "my orders" of the Market tab (W13-21). The preview uses the server's pure fee functions; Submit sends
 * `market.placeOrder`; the host's reject text is shown under the form. My orders come from the REST snapshot (`myOrders`) and are
 * refreshed after every ack and (debounced) on book pushes.
 */
export class OrderSection {
  readonly root = makeDiv('ta-order', 'order-section');
  private snapshot: MarketSnapshotResponse | null = null;
  private side: OrderSide = 'buy';
  private readonly sideBtns: Record<OrderSide, HTMLButtonElement> = { buy: this.sideButton('buy'), sell: this.sideButton('sell') };
  private readonly amountIn = textInput('numeric');
  private readonly priceIn = textInput('decimal');
  private readonly stallIn = textInput('numeric');
  private readonly ttlSel = document.createElement('select');
  private readonly previewEl = makeDiv('ta-order__preview', 'order-preview');
  private readonly blockedEl = makeDiv('ta-order__blocked', 'order-blocked');
  private readonly resultEl = makeDiv('ta-order__result', 'order-result');
  private readonly submitBtn = makeBtn('btn btn-primary btn-sm plate-sm ta-order__submit', 'order-submit', 'Place order', () => void this.submit());
  private readonly myEl = makeDiv('ta-order__mine', 'order-mine');
  private readonly stallRow = field('Max stall fee (bp)', this.stallIn, 'order-stall');
  private readonly offs: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private awaitingReject = 0;

  constructor(private readonly ctx: FeatureContext, private readonly pair: () => OrderPair) {
    this.ttlSel.className = 'ta-market__select';
    const sides = makeDiv('ta-order__sides');
    sides.append(this.sideBtns.buy, this.sideBtns.sell);
    const grid = makeDiv('ta-order__form');
    grid.append(field('Amount', this.amountIn, 'order-amount'), field('Total price', this.priceIn, 'order-price'), field('Expires in', this.ttlSel, 'order-ttl'), this.stallRow);
    this.root.append(title('ORDER'), sides, grid, this.previewEl, this.blockedEl, this.submitBtn, this.resultEl, title('MY ORDERS'), this.myEl);
    for (const i of [this.amountIn, this.priceIn, this.stallIn]) i.addEventListener('input', () => this.update());
    this.ttlSel.addEventListener('change', () => this.update());
    const store = ctx.services.store as { onServerEvents?: (f: (e: EventList) => void) => () => void } | undefined;
    if (store?.onServerEvents) this.offs.push(store.onServerEvents((list) => this.onEvents(list)));
    if (ctx.services.store?.onMarketBook) this.offs.push(ctx.services.store.onMarketBook(() => this.scheduleRefresh()));
    this.update();
  }

  private sideButton(side: OrderSide): HTMLButtonElement {
    return makeBtn('ta-order__side btn-sm plate-sm', `order-side-${side}`, side.toUpperCase(), () => { this.side = side; this.update(); });
  }

  /** Reloads the snapshot (policy, balances, my orders). */
  refresh(): Promise<void> {
    const id = this.ctx.services.session?.planetId() ?? null;
    const load = this.ctx.services.marketSnapshot;
    if (!id || !load) return Promise.resolve();
    return load(id).then((s) => { this.snapshot = s; this.fillTtl(); this.update(); }, () => undefined);
  }

  private scheduleRefresh(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, REFRESH_DEBOUNCE_MS);
  }

  private fillTtl(): void {
    const opts = this.snapshot?.policy?.ttlOptionsS ?? [];
    const keep = this.ttlSel.value;
    this.ttlSel.replaceChildren(...opts.map((s) => { const o = document.createElement('option'); o.value = String(s); o.textContent = ttlLabel(s); return o; }));
    if (keep && opts.includes(Number(keep))) this.ttlSel.value = keep;
    if (!this.stallIn.value && this.snapshot?.policy) this.stallIn.value = String(this.snapshot.policy.stallFeeDefaultBp);
  }

  private stallBp(): number {
    return this.stallIn.value.trim() === '' ? (this.snapshot?.policy?.stallFeeDefaultBp ?? 0) : Number(this.stallIn.value);
  }

  private preview(): OrderPreview {
    const { base, quote } = this.pair();
    return previewOrder({
      side: this.side, base, quote, amountText: this.amountIn.value, priceText: this.priceIn.value,
      maxStallFeeBp: Number.isInteger(this.stallBp()) ? this.stallBp() : -1, policy: this.snapshot?.policy, balances: this.snapshot?.balances,
    });
  }

  private previewRows(p: OrderPreview): Array<[string, string, string]> {
    const { base, quote } = this.pair();
    const q = (v: bigint): string => `${formatAtomic(quote, v)} ${mockLabel(quote)}`;
    const buy = this.side === 'buy';
    const rows: Array<[string, string, string]> = [];
    if (p.terms) {
      rows.push(['base', buy ? 'You receive' : 'You give', `${p.terms.amount} ${base}`], ['notional', buy ? 'Notional' : 'You receive', q(p.terms.priceAtomic)]);
      if (buy) rows.push(['platform', 'Platform fee', q(p.platformFee)], ['stall', 'Max stall fee', q(p.stallFee)], ['network', 'Network cost', `0 (mock, no gas)`], ['total', 'Total maximum spend', q(p.totalMax)]);
    }
    if (this.snapshot?.policy) rows.push(['policy', 'Policy version', this.snapshot.policy.policyVersion]);
    return rows;
  }

  /** Re-renders the preview and the submit state (also called when the picked pair changes). */
  update(): void {
    const p = this.preview();
    for (const s of ['buy', 'sell'] as const) this.sideBtns[s].setAttribute('data-active', String(this.side === s));
    this.stallRow.hidden = this.side !== 'buy';
    this.previewEl.replaceChildren(...this.previewRows(p).map(([id, k, v]) => { const r = makeDiv('ta-order__line', `order-preview-${id}`); r.append(span(k), span(v, 'ta-order__val')); return r; }));
    this.blockedEl.textContent = p.blocked ?? '';
    this.submitBtn.disabled = p.blocked !== undefined;
    const orders = this.snapshot?.myOrders ?? [];
    this.myEl.replaceChildren(...(orders.length ? orders.map((o) => myOrderRow(o, (x) => void this.cancel(x))) : [makeDiv('ta-market__empty', undefined, 'No orders yet.')]));
  }

  async submit(): Promise<void> {
    const p = this.preview();
    const send = this.ctx.services.sendCommand;
    if (p.blocked || !p.terms || !send) return;
    const { base, quote } = this.pair();
    const args = {
      side: this.side, resource: base, amount: p.terms.amount, price: { token: quote, amount: p.terms.priceAtomic.toString() }, ttlS: Number(this.ttlSel.value),
      ...(this.side === 'buy' ? { maxStallFeeBp: this.stallBp() } : {}),
    };
    this.submitBtn.disabled = true;
    this.awaitingReject = Date.now();
    const r = await send('market.placeOrder', args);
    this.resultEl.textContent = r.ok ? 'Order sent.' : `Order refused: ${r.detail ?? r.code}`;
    if (r.ok) { this.amountIn.value = ''; this.priceIn.value = ''; }
    await this.refresh();
    this.update();
  }

  async cancel(o: MyOrderView): Promise<void> {
    const r = await this.ctx.services.sendCommand?.('market.cancelOrder', { orderId: o.orderId });
    this.resultEl.textContent = r && !r.ok ? `Cancel refused: ${r.detail ?? r.code}` : '';
    await this.refresh();
  }

  private onEvents(list: EventList): void {
    for (const e of list) {
      if (e.kind === 'marketOrderRejected' && Date.now() - this.awaitingReject < REJECT_WINDOW_MS) {
        this.resultEl.textContent = failedText(e.data?.detail as string | undefined, e.data?.code as string | undefined);
        this.awaitingReject = 0;
      }
      if (e.kind === 'tradeSettled' || e.kind === 'marketOrderRejected') this.scheduleRefresh();
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const o of this.offs.splice(0)) o();
    this.root.remove();
  }
}
