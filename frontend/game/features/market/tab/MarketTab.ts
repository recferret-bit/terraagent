import { formatUnitPrice, mockLabel, pairId, type BookLevel, type MarketTokenKey, type ResourceKey, type TradeView } from '@terra/contracts';
import type { FeatureContext, TradeHubTabInstance } from '../../../core/registry/types';
import { makeDiv } from '../../shared/dom';
import { MarketState } from './marketState';
import { MarketTracker } from '../analytics/marketTracker';
import { OrderSection } from '../order/OrderSection';
import { StallSection } from '../stall/StallSection';
import { resourceLabel } from './pairs';
import { FILLS_SHOWN, MINI_DEPTH_LEVELS, QUICK_BASES, QUICK_QUOTES, pairStats, tradePageUrl } from './quickModel';

export const DEPTH_ROWS = MINI_DEPTH_LEVELS;
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

/**
 * The MARKET tab of the Trade Hub panel: a compact quick-trade panel (short pair list, best bid / ask / last + 24 h change, 5-level
 * depth, simple ticket, my open orders, last fills). The full order book, analytics and every power feature live on /trade.html.
 */
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
  private readonly statsEl = makeDiv('ta-market__stats', 'market-stats');
  private readonly fullLink = el('a', 'btn btn-primary plate-sm ta-market__full', 'OPEN FULL TRADING PAGE');
  private readonly offs: Array<() => void> = [];
  private readonly stall: StallSection;
  private loading = false;
  private readonly order: OrderSection;
  private readonly tracker: MarketTracker;

  constructor(private readonly root: HTMLElement, private readonly ctx: FeatureContext) {
    const planetId = (): string | null => ctx.services.session?.planetId() ?? null;
    this.state = new MarketState(planetId);
    this.stall = new StallSection(ctx);
    this.baseSel.dataset.testid = 'market-base';
    this.quoteSel.dataset.testid = 'market-quote';
    this.statusEl.dataset.testid = 'market-status';
    this.baseSel.setAttribute('aria-label', 'Base resource');
    this.quoteSel.setAttribute('aria-label', 'Quote token');
    this.baseSel.addEventListener('change', () => { this.base = this.baseSel.value as ResourceKey; this.fillQuotes(); this.render(); });
    this.quoteSel.addEventListener('change', () => { this.quote = this.quoteSel.value as MarketTokenKey; this.render(); });
    this.fullLink.dataset.testid = 'market-open-full';
    this.fullLink.target = '_blank';
    this.fullLink.rel = 'noopener';
    this.fillBases();
    this.fillQuotes();
    const picker = makeDiv('ta-market__picker');
    picker.append(this.baseSel, this.quoteSel);
    const head = makeDiv('ta-market__head');
    head.append(el('span', 'ta-market__col', 'PRICE'), el('span', 'ta-market__col', 'AMOUNT'), el('span', 'ta-market__col', 'ORDERS'));
    this.root.classList.add('ta-market');
    this.root.append(this.fullLink, picker, this.statusEl, this.statsEl, head, this.asksEl, makeDiv('ta-market__mid'), this.bidsEl);
    this.tracker = new MarketTracker(ctx.services.track);
    this.order = new OrderSection(ctx, () => ({ base: this.base, quote: this.quote }));
    this.root.append(this.order.root, el('div', 'ta-market__title', 'LAST FILLS'), this.tradesEl, this.stall.el);
    this.offs.push(this.state.onChange(() => this.render()));
    const store = ctx.services.store;
    if (store?.onMarketBook) this.offs.push(store.onMarketBook((p) => this.state.applyBook(p)));
    if (store?.onMarketTrade) this.offs.push(store.onMarketTrade((p) => this.state.applyTrade(p)));
    this.render();
  }

  private fillBases(): void {
    const keys = QUICK_BASES.includes(this.base) ? [...QUICK_BASES] : [...QUICK_BASES, this.base];
    this.baseSel.replaceChildren(...keys.map((k) => option(k, resourceLabel(k), k === this.base)));
  }

  private fillQuotes(): void {
    if (this.quote === this.base) this.quote = 'USDC';
    const keys: Array<MarketTokenKey | ResourceKey> = QUICK_QUOTES.includes(this.quote) ? [...QUICK_QUOTES] : [...QUICK_QUOTES, this.quote as ResourceKey];
    this.quoteSel.replaceChildren(...keys.map((q) => option(q, QUICK_QUOTES.includes(q as MarketTokenKey) ? mockLabel(q as MarketTokenKey) : resourceLabel(q as ResourceKey), q === this.quote)));
  }

  /** Loads the REST snapshot (also when the tab is shown again, so a missed push is repaired). */
  onShow(): void {
    const id = this.ctx.services.session?.planetId() ?? null;
    const load = this.ctx.services.marketSnapshot;
    this.fullLink.href = tradePageUrl(id);
    this.order.refresh();
    this.tracker.tabOpened();
    if (!id || !load || this.loading) { this.render(); return; }
    this.loading = true;
    load(id).then((s) => { this.statusEl.textContent = ''; this.state.applySnapshot(s); this.stall.apply(s); }, () => { this.statusEl.textContent = 'Market unavailable.'; })
      .finally(() => { this.loading = false; });
  }

  /** Selects a pair (the Supply & trade panel's buy / sell buttons land here; nothing is ever submitted). */
  setPair(base: ResourceKey, quote: MarketTokenKey): void {
    this.base = base;
    this.quote = quote;
    this.fillBases();
    this.fillQuotes();
    this.render();
  }

  /** Pair, side and amount of a suggestion; the order is only prefilled. */
  prefill(base: ResourceKey, quote: MarketTokenKey, side: 'buy' | 'sell', amount: number): void {
    this.setPair(base, quote);
    this.order.prefill(side, amount);
  }

  selected(): string {
    return pairId(this.base, this.quote);
  }

  render(): void {
    this.fullLink.href = tradePageUrl(this.ctx.services.session?.planetId() ?? null);
    this.order.update();
    const book = this.state.book(this.selected());
    this.asksEl.replaceChildren(...levelRows([...(book?.asks ?? [])].slice(0, DEPTH_ROWS).reverse(), this.quote, 'ask'));
    this.bidsEl.replaceChildren(...levelRows(book?.bids ?? [], this.quote, 'bid'));
    if (!book || book.asks.length + book.bids.length === 0) {
      const empty = el('div', 'ta-market__empty', `No open orders. Prices in ${mockLabel(this.quote)}.`);
      empty.dataset.testid = 'market-empty';
      this.asksEl.append(empty);
    }
    const all = this.state.trades(this.selected());
    const st = pairStats(book, all, this.quote, Date.now());
    this.statsEl.replaceChildren(...([['BEST BID', st.bid, 'bid'], ['BEST ASK', st.ask, 'ask'], ['LAST', st.last, 'last'], ['24H', st.change24h, 'change']] as const).map(([k, v, id]) => {
      const cell = makeDiv('ta-market__stat', `market-stat-${id}`);
      cell.append(el('span', 'ta-market__stat-k', k), el('span', 'ta-market__stat-v', v));
      return cell;
    }));
    const t = all.slice(0, FILLS_SHOWN);
    this.tradesEl.replaceChildren(...(t.length ? t.map(tradeRow) : [el('div', 'ta-market__empty', 'No fills yet.')]));
  }

  dispose(): void {
    for (const o of this.offs.splice(0)) o();
    this.order.dispose();
    this.stall.dispose();
    this.root.replaceChildren();
  }
}
