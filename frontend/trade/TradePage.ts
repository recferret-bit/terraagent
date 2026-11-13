import type { OrderSide } from '@terra/contracts';
import { TradeApiFailure, type TradeClient } from './api/client';
import { signOut, mockOauthUrl } from './api/identity';
import { TradeStream } from './api/stream';
import { Loaders } from './loaders';
import { orderPrice } from './model/allOrders';
import { AFTER_ORDER_CHANGE, onTabOpen, overviewDelay, tickRefresh, type LoaderName } from './model/refresh';
import { applyStreamEvent, cancellable, initialState, type OrderFilter, type PanelId, type TradeState } from './model/state';
import { Store } from './Store';
import { renderBalances } from './view/balancesView';
import { renderBoard } from './view/boardView';
import { clear, h, panel, type Panel } from './view/dom';
import { KeysPanel } from './view/keysView';
import { renderLadder } from './view/ladderView';
import { renderMarketOrders, renderOverview } from './view/marketView';
import { renderFills, renderOrders } from './view/ordersView';
import { Pickers } from './view/pickers';
import { StallEditor } from './view/stallView';
import { OrderTicket } from './view/ticketView';

const TABS = [['market', 'All orders'], ['pairs', 'All pairs'], ['orders', 'My orders'], ['fills', 'My fills'], ['keys', 'Bot / API keys']] as const;
type TabId = (typeof TABS)[number][0];
const LAST_PLANET = 'ta_trade_planet';
const DEFAULT_PAIR = 'bio.water/USDC';

export interface PageStart {
  readonly planetId: string;
  readonly pair: string;
  readonly onSignOut?: () => void;
}

/** Wires the store, the loaders, the SSE stream and the panels. Panels render from state; the ticket owns its inputs. */
export class TradePage {
  private readonly store: Store;
  private readonly loaders: Loaders;
  private readonly pickers: Pickers;
  private readonly ticket: OrderTicket;
  private readonly keys: KeysPanel;
  private readonly stallEditor: StallEditor;
  private readonly p: Record<'ladder' | 'board' | 'ticket' | 'balances' | 'market' | 'pairs' | 'orders' | 'fills' | 'keys', Panel>;
  private stream: TradeStream | null = null;
  private tab: TabId = 'market';
  private filter: OrderFilter = 'open';
  private marketSide: OrderSide | null = null;
  private marketTimer: ReturnType<typeof setTimeout> | null = null;
  private overviewTimer: ReturnType<typeof setTimeout> | null = null;
  private overviewAt = 0;
  private readonly busy = new Set<string>();
  private attempt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly root: HTMLElement, private readonly client: TradeClient, private readonly who: string, start: PageStart) {
    this.store = new Store(initialState(start.planetId, start.pair));
    this.loaders = new Loaders(this.store, client);
    this.pickers = new Pickers(who, {
      pair: (pair) => this.selectPair(pair), planet: (id) => this.selectPlanet(id),
      signOut: () => {
        signOut();
        if (start.onSignOut) start.onSignOut();
        else location.assign(mockOauthUrl(location.pathname));
      },
    });
    this.p = {
      ladder: panel('book', 'Depth ladder', 'click a level to prefill the ticket'), board: panel('board', 'Price board'),
      ticket: panel('ticket', 'Order ticket'), balances: panel('balances', 'Balances (yours only)'),
      market: panel('market', 'All resting orders'), pairs: panel('overview', 'All pairs'), orders: panel('orders', 'My orders'),
      fills: panel('fills', 'My fills'), keys: panel('keys', 'Bot / API keys'),
    };
    this.ticket = new OrderTicket({ client, state: () => this.store.get(), onSent: () => this.afterOrderChange() });
    this.p.ticket.body.append(this.ticket.root);
    this.keys = new KeysPanel(this.p.keys.body, { client, state: () => this.store.get(), reload: () => { void this.loaders.keys(true); } });
    this.stallEditor = new StallEditor({ client, token: client.token, onSaved: (stall) => this.store.update((x) => ({ ...x, stall }), ['stall']) });
    this.store.subscribe((s, changed) => this.render(s, changed));
  }

  async mount(): Promise<void> {
    clear(this.root);
    this.root.append(this.shell());
    this.pickers.setPlanets(await this.client.devPlanets());
    this.openStream();
    setInterval(() => this.tick(), 5000);
    window.addEventListener('hashchange', () => this.applyHash());
    this.applyHash();
    // an untradable `?pair=` is replaced before any book is requested (the book routes answer 400 for it)
    await this.loaders.catalog();
    this.ensureValidPair();
    await Promise.all([this.loaders.all(), this.loaders.bookOrders(this.marketSide)]);
    this.pickers.sync(this.store.get().pairs, this.store.get().planetId, this.store.get().pair);
    this.ensureValidPair();
    this.applyHash();
  }

  /** `#board` scrolls to the price board, `#orders` opens the All orders tab (the in-game hub links to `/trade.html?planet=<id>#board`). */
  private applyHash(): void {
    const target = location.hash.replace(/^#/, '');
    const el = target === 'board' ? this.p.board.root : target === 'orders' || target === 'market' ? document.getElementById('tr-lower') : null;
    if (target === 'orders' || target === 'market') this.setTab('market');
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.classList.add('is-target');
    setTimeout(() => el.classList.remove('is-target'), 2500);
  }

  /** The URL pair may not be tradable on this server: fall back to the first listed one. */
  private ensureValidPair(): void {
    const s = this.store.get();
    if (s.pairs.length && !s.pairs.some((x) => x.pair === s.pair)) this.selectPair(s.pairs.find((x) => x.pair === DEFAULT_PAIR)?.pair ?? s.pairs[0]!.pair);
  }

  private shell(): HTMLElement {
    const tabs = h('div', { class: 'tr-tabs', role: 'tablist', 'aria-label': 'Orders and keys' }, ...TABS.map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'data-testid': `tab-${id}`, class: 'tr-tab', 'aria-selected': String(id === this.tab), 'aria-controls': `tabpanel-${id}`, onclick: () => this.setTab(id), onkeydown: (e) => this.tabKey(e as KeyboardEvent, id) }, label)));
    const panes = TABS.map(([id]) => {
      const pane = id === 'market' ? this.p.market : id === 'pairs' ? this.p.pairs : this.p[id];
      return h('div', { role: 'tabpanel', id: `tabpanel-${id}`, 'aria-labelledby': `tab-${id}`, class: 'tr-pane', hidden: id !== this.tab ? true : null }, pane.root);
    });
    return h('div', { class: 'tr-page' },
      h('header', { class: 'tr-top' },
        h('div', { class: 'tr-brand' }, h('a', { href: '/', class: 'tr-back' }, 'TERRA', h('b', {}, 'AGENT')), h('h1', { class: 'tr-title' }, 'TRADE')),
        h('nav', { class: 'tr-links', 'aria-label': 'Related pages' }, h('a', { href: '/play.html' }, 'Game'), h('a', { href: '/me.html' }, 'Profile'), h('a', { href: '/dev/chain/' }, 'Chain explorer')),
        this.pickers.root),
      h('p', { class: 'tr-banner' }, 'MOCK MARKET (F2): every USDC and NEAR amount here is mock money; resources are your in-orbit cargo only. Prices are the TOTAL for the whole order.'),
      h('main', { class: 'tr-grid', id: 'tr-main' },
        h('div', { class: 'tr-col tr-col-a' }, this.p.ladder.root, this.p.board.root),
        h('div', { class: 'tr-col tr-col-b' }, this.p.ticket.root, this.p.balances.root)),
      h('section', { class: 'tr-lower', id: 'tr-lower', 'aria-label': 'Orders, fills and keys' }, tabs, ...panes));
  }

  private tabKey(e: KeyboardEvent, id: TabId): void {
    const i = TABS.findIndex(([t]) => t === id);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length]![0];
    this.setTab(t);
    document.getElementById(`tab-${t}`)?.focus();
  }

  private setTab(t: TabId): void {
    this.tab = t;
    for (const [id] of TABS) {
      document.getElementById(`tab-${id}`)?.setAttribute('aria-selected', String(id === t));
      const pane = document.getElementById(`tabpanel-${id}`);
      if (pane) pane.hidden = id !== t;
    }
    this.render(this.store.get(), new Set(['all']));
    this.reload(onTabOpen(t));
  }

  /** Quietly refetches the named data (see `model/refresh.ts`). */
  private reload(names: readonly LoaderName[]): void {
    for (const n of names) void (n === 'bookOrders' ? this.loaders.bookOrders(this.marketSide, true) : this.loaders[n](true));
  }

  // --- rendering --------------------------------------------------------------------------------------------------
  private render(s: TradeState, changed: ReadonlySet<PanelId | 'all'>): void {
    const all = changed.has('all');
    const has = (id: PanelId): boolean => all || changed.has(id);
    if (has('book') || has('orders')) {
      const own = new Set(s.orders.filter((o) => (o.state === 'OPEN' || o.state === 'PARTIAL') && o.pair === s.pair).map((o) => { const r = orderPrice(o); return `${o.side}:${r.num}/${r.den}`; }));
      renderLadder(this.p.ladder.body, s, own, (lv, side) => this.ticket.prefillFromLevel(lv, side));
    }
    if (has('board') || has('book')) renderBoard(this.p.board.body, s);
    if (has('stall') || all) this.stallEditor.update(s);
    if (has('balances') || has('stall') || has('policy')) renderBalances(this.p.balances.body, s, this.stallEditor.root);
    if (has('pairs') || has('policy') || has('balances') || has('book') || has('orders') || all) this.ticket.update();
    if (all || changed.has('pairs')) this.pickers.sync(s.pairs, s.planetId, s.pair);
    if (this.tab === 'market' && (has('bookOrders') || has('orders'))) this.renderMarket(s);
    if (this.tab === 'pairs' && (has('overview') || has('board') || has('pairs') || has('book'))) renderOverview(this.p.pairs.body, s, (pair) => this.selectPair(pair));
    if (this.tab === 'orders' && has('orders')) this.renderOrdersTab(s);
    if (this.tab === 'fills' && has('fills')) renderFills(this.p.fills.body, s);
    if (this.tab === 'keys' && (has('keys') || all) && !this.p.keys.body.contains(document.activeElement)) this.keys.render();
    if (all) this.renderLazyTabs(s);
  }

  /** On tab change every pane draws once from current state. */
  private renderLazyTabs(s: TradeState): void {
    if (this.tab === 'market') this.renderMarket(s);
    if (this.tab === 'pairs') renderOverview(this.p.pairs.body, s, (pair) => this.selectPair(pair));
    if (this.tab === 'orders') this.renderOrdersTab(s);
    if (this.tab === 'fills') renderFills(this.p.fills.body, s);
    if (this.tab === 'keys') this.keys.render();
  }

  private renderMarket(s: TradeState): void {
    renderMarketOrders(this.p.market.body, s, Date.now(), this.marketSide, { setSide: (side) => { this.marketSide = side; void this.loaders.bookOrders(side); this.renderMarket(this.store.get()); } });
  }

  /** Book pushes arrive at up to 1 Hz: refetch the full order list at most every 400 ms after the last one. */
  private scheduleMarketRefresh(): void {
    if (this.marketTimer) return;
    this.marketTimer = setTimeout(() => { this.marketTimer = null; void this.loaders.bookOrders(this.marketSide, true); }, 400);
  }

  /** Book pushes refetch the all-pairs overview as ONE request, at most every `OVERVIEW_MIN_GAP_MS`, and only while that tab is open. */
  private scheduleOverviewRefresh(): void {
    if (this.tab !== 'pairs' || this.overviewTimer) return;
    this.overviewTimer = setTimeout(() => { this.overviewTimer = null; this.overviewAt = Date.now(); void this.loaders.overview(true); }, overviewDelay(this.overviewAt, Date.now()));
  }

  private renderOrdersTab(s: TradeState): void {
    renderOrders(this.p.orders.body, s, this.filter, this.busy, {
      cancel: (id) => { void this.cancel(id); }, cancelAll: () => { void this.cancelAll(); },
      setFilter: (f) => { this.filter = f; this.renderOrdersTab(this.store.get()); },
    }, Date.now());
  }

  private tick(): void {
    const s = this.store.get();
    const focused = (el: HTMLElement): boolean => el.contains(document.activeElement);
    if (this.tab === 'orders' && !focused(this.p.orders.body)) this.renderOrdersTab(s);
    if (this.tab === 'market' && !focused(this.p.market.body)) this.renderMarket(s);
    this.reload(tickRefresh(this.tab));
  }

  // --- actions ----------------------------------------------------------------------------------------------------
  private async cancel(orderId: string): Promise<void> {
    this.busy.add(orderId);
    this.renderOrdersTab(this.store.get());
    try { await this.client.cancel(orderId); } catch (err) { this.flash(err); }
    this.busy.delete(orderId);
    this.afterOrderChange();
  }

  private async cancelAll(): Promise<void> {
    for (const o of cancellable(this.store.get().orders)) await this.cancel(o.orderId);
  }

  private flash(err: unknown): void {
    const text = err instanceof TradeApiFailure ? `${err.code}: ${err.message}` : 'Request failed.';
    this.p.orders.actions.replaceChildren(h('span', { class: 'tr-note tr-note-err', role: 'alert' }, text));
    setTimeout(() => this.p.orders.actions.replaceChildren(), 6000);
  }

  /** After a placement / cancel: refresh what the stream might lag on (the stream also pushes). */
  private afterOrderChange(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.reload(AFTER_ORDER_CHANGE), 400);
  }

  selectPair(pair: string): void {
    if (pair === this.store.get().pair) return;
    this.store.update((s) => ({ ...s, pair, book: null, bookOrders: null }), ['all']);
    this.syncUrl();
    void this.loaders.book();
    void this.loaders.bookOrders(this.marketSide);
    void this.loaders.board(true);
  }

  selectPlanet(planetId: string): void {
    try { localStorage.setItem(LAST_PLANET, planetId); } catch { /* storage is optional */ }
    this.store.set({ ...initialState(planetId, this.store.get().pair), pairs: this.store.get().pairs, policy: this.store.get().policy }, ['all']);
    this.syncUrl();
    this.openStream();
    this.marketSide = null;
    void this.loaders.all();
    void this.loaders.bookOrders(null);
  }

  private syncUrl(): void {
    const u = new URL(location.href);
    const s = this.store.get();
    u.searchParams.set('planet', s.planetId);
    u.searchParams.set('pair', s.pair);
    history.replaceState(null, '', u);
  }

  private openStream(): void {
    this.stream?.close();
    const s = this.store.get();
    this.stream = new TradeStream(this.client.streamUrl(s.planetId), this.client.authHeaders(), {
      onEvent: (e) => {
        if (e.type === 'hello') this.pickers.setConn('live', 0);
        this.store.update((x) => applyStreamEvent(x, e), e.type === 'book' ? ['book', 'overview'] : e.type === 'order' ? ['orders', 'book'] : e.type === 'fill' ? ['fills'] : ['all']);
        if (e.type === 'book') { this.scheduleMarketRefresh(); this.scheduleOverviewRefresh(); }
        if (e.type === 'fill' || e.type === 'order') this.afterOrderChange();
      },
      onState: (c, attempt) => { this.attempt = attempt; this.store.update((x) => ({ ...x, conn: c }), []); this.pickers.setConn(c, attempt); },
    }, this.client.fetchFn());
    this.stream.start();
  }

  static startFrom(search: string): PageStart {
    const q = new URLSearchParams(search);
    let planet = q.get('planet')?.trim() ?? '';
    if (!planet) { try { planet = localStorage.getItem(LAST_PLANET) ?? ''; } catch { /* ignore */ } }
    return { planetId: planet, pair: q.get('pair')?.trim() || DEFAULT_PAIR };
  }
}
