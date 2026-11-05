import { formatUnitPrice, mockLabel, pairId, type BookLevel, type MarketTokenKey, type ResourceKey, type TradeView } from '@terra/contracts';
import type { FeatureContext, TradeHubTabInstance } from '../../../core/registry/types';
import { makeDiv } from '../../shared/dom';
import { MarketState } from './marketState';
import { OrderSection } from '../order/OrderSection';
import { baseGroups, quoteChoices, resourceLabel } from './pairs';

export const DEPTH_ROWS = 10;
const DEFAULT_BASE: ResourceKey = 'bio.water';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function option(value: string, text: string, selected: boolean): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  o.selected = selected;
  return o;
}

/** `price  amount  orders` rows of one book side. */
export function levelRows(levels: readonly BookLevel[], quote: MarketTokenKey, side: 'ask' | 'bid'): HTMLElement[] {
  return levels.slice(0, DEPTH_ROWS).map((l) => {
    const row = makeDiv(`ta-market__row ta-market__row--${side}`, `market-${side}`);
    row.append(el('span', 'ta-market__price', formatUnitPrice(l.num, l.den, quote)), el('span', 'ta-market__amount', String(l.amount)), el('span', 'ta-market__orders', String(l.orders)));
    return row;
  });
}

const tradeRow = (t: TradeView): HTMLElement => {
  const row = makeDiv('ta-market__row ta-market__row--trade', 'market-trade');
  const time = new Date(t.atMs);
  const hhmmss = [time.getHours(), time.getMinutes(), time.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  row.append(el('span', 'ta-market__price', formatUnitPrice(t.notional, t.amount, t.quote)), el('span', 'ta-market__amount', String(t.amount)), el('span', 'ta-market__time', hhmmss));
  return row;
};

/** The MARKET tab of the Trade Hub panel (W13-20): pair picker, depth (top 10 per side) and last trades, live from the pushes. */
export class MarketTab implements TradeHubTabInstance {
  readonly state: MarketState;
  private base: ResourceKey = DEFAULT_BASE;
  private quote: MarketTokenKey = 'USDC';
  private readonly baseSel = el('select', 'ta-market__select');
  private readonly quoteSel = el('select', 'ta-market__select');
  private readonly asksEl = makeDiv('ta-market__side', 'market-asks');
  private readonly bidsEl = makeDiv('ta-market__side', 'market-bids');
  private readonly tradesEl = makeDiv('ta-market__trades', 'market-trades');
  private readonly statusEl = el('div', 'ta-market__status');
  private readonly offs: Array<() => void> = [];
  private loading = false;
  private readonly order: OrderSection;

  constructor(private readonly root: HTMLElement, private readonly ctx: FeatureContext) {
    const planetId = (): string | null => ctx.services.session?.planetId() ?? null;
    this.state = new MarketState(planetId);
    this.baseSel.dataset.testid = 'market-base';
    this.quoteSel.dataset.testid = 'market-quote';
    this.statusEl.dataset.testid = 'market-status';
    this.baseSel.setAttribute('aria-label', 'Base resource');
    this.quoteSel.setAttribute('aria-label', 'Quote token');
    this.baseSel.addEventListener('change', () => { this.base = this.baseSel.value as ResourceKey; this.fillQuotes(); this.render(); });
    this.quoteSel.addEventListener('change', () => { this.quote = this.quoteSel.value as MarketTokenKey; this.render(); });
    this.fillBases();
    this.fillQuotes();
    const picker = makeDiv('ta-market__picker');
    picker.append(this.baseSel, this.quoteSel);
    const head = makeDiv('ta-market__head');
    head.append(el('span', 'ta-market__col', 'PRICE'), el('span', 'ta-market__col', 'AMOUNT'), el('span', 'ta-market__col', 'ORDERS'));
    this.root.classList.add('ta-market');
    this.root.append(picker, this.statusEl, head, this.asksEl, makeDiv('ta-market__mid'), this.bidsEl, el('div', 'ta-market__title', 'LAST TRADES'), this.tradesEl);
    this.order = new OrderSection(ctx, () => ({ base: this.base, quote: this.quote }));
    this.root.append(this.order.root);
    this.offs.push(this.state.onChange(() => this.render()));
    const store = ctx.services.store;
    if (store?.onMarketBook) this.offs.push(store.onMarketBook((p) => this.state.applyBook(p)));
    if (store?.onMarketTrade) this.offs.push(store.onMarketTrade((p) => this.state.applyTrade(p)));
    this.render();
  }

  private fillBases(): void {
    this.baseSel.replaceChildren();
    for (const g of baseGroups()) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const k of g.keys) og.append(option(k, resourceLabel(k), k === this.base));
      this.baseSel.append(og);
    }
  }

  private fillQuotes(): void {
    const { cash, barter } = quoteChoices(this.base);
    if (!cash.includes(this.quote) && !barter.includes(this.quote as ResourceKey)) this.quote = 'USDC';
    if (this.quote === this.base) this.quote = 'USDC';
    this.quoteSel.replaceChildren();
    for (const q of cash) this.quoteSel.append(option(q, mockLabel(q), q === this.quote));
    const og = document.createElement('optgroup');
    og.label = 'Barter';
    for (const k of barter) og.append(option(k, resourceLabel(k), k === this.quote));
    this.quoteSel.append(og);
  }

  /** Loads the REST snapshot (also when the tab is shown again, so a missed push is repaired). */
  onShow(): void {
    const id = this.ctx.services.session?.planetId() ?? null;
    const load = this.ctx.services.marketSnapshot;
    this.order.refresh();
    if (!id || !load || this.loading) { this.render(); return; }
    this.loading = true;
    load(id).then((s) => { this.statusEl.textContent = ''; this.state.applySnapshot(s); }, () => { this.statusEl.textContent = 'Market unavailable.'; })
      .finally(() => { this.loading = false; });
  }

  selected(): string {
    return pairId(this.base, this.quote);
  }

  render(): void {
    this.order.update();
    const book = this.state.book(this.selected());
    this.asksEl.replaceChildren(...levelRows([...(book?.asks ?? [])].slice(0, DEPTH_ROWS).reverse(), this.quote, 'ask'));
    this.bidsEl.replaceChildren(...levelRows(book?.bids ?? [], this.quote, 'bid'));
    if (!book || book.asks.length + book.bids.length === 0) {
      const empty = el('div', 'ta-market__empty', `No open orders. Prices in ${mockLabel(this.quote)}.`);
      empty.dataset.testid = 'market-empty';
      this.asksEl.append(empty);
    }
    const t = this.state.trades(this.selected()).slice(0, 20);
    this.tradesEl.replaceChildren(...(t.length ? t.map(tradeRow) : [el('div', 'ta-market__empty', 'No trades yet.')]));
  }

  dispose(): void {
    for (const o of this.offs.splice(0)) o();
    this.order.dispose();
    this.root.replaceChildren();
  }
}
