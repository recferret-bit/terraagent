import { parsePairId, type OrderSide, type TradeBookOrderView } from '@terra/contracts';
import { ACTOR_BADGE, actorCounts, visibleOrders } from '../model/allOrders';
import type { TradeState } from '../model/state';
import { bpLabel, fmtAmount, fmtUnit, timeLeft } from '../model/units';
import { badge, fill, gate, h, note, table, td } from './dom';

export interface MarketActions { setSide(side: OrderSide | null): void }

const SIDES: ReadonlyArray<readonly [OrderSide | null, string]> = [[null, 'Both sides'], ['buy', 'Bids'], ['sell', 'Asks']];

/**
 * Every resting order of the selected pair (public `GET /v1/trade/book/:planet/:pair/orders`): actor kind, stall fee, TTL left and
 * the all-or-nothing flag per order. The caller's own orders (`mine`) are highlighted. Colony refs are per-planet pseudonyms.
 */
export function renderMarketOrders(body: HTMLElement, s: TradeState, now: number, side: OrderSide | null, a: MarketActions): void {
  if (!gate(body, s.panels.bookOrders, null)) return;
  const res = s.bookOrders;
  const parsed = parsePairId(s.pair);
  if (!res || !parsed || res.pair !== s.pair) { body.replaceChildren(note('No orders loaded.')); return; }
  const q = parsed.quote;
  const rows = visibleOrders(res.orders, side);
  const chips = h('div', { class: 'tr-chips', role: 'group', 'aria-label': 'Side filter' }, ...SIDES.map(([v, label]) =>
    h('button', { type: 'button', class: `tr-chip${v === side ? ' is-on' : ''}`, 'data-side-filter': v ?? 'all', 'aria-pressed': String(v === side), onclick: () => a.setSide(v) }, label)));
  const mix = actorCounts(res.orders).map(([k, n]) => h('span', { class: 'tr-mix', 'data-actor-count': k }, badge(k, ACTOR_BADGE[k]), ` ${n}`));
  const head = h('div', { class: 'tr-row tr-market-head' }, chips, h('div', { class: 'tr-badges', 'aria-label': 'Actor mix of the listed orders' }, ...mix));
  const trunc = res.truncated ? note(`Showing the best ${res.orders.length} orders only; the book holds more. Use the side filter to see more of one side.`, 'warn') : null;
  if (rows.length === 0) { body.replaceChildren(head, note('No resting orders on this pair.')); return; }
  fill(body, head, trunc,
    table([{ label: 'SIDE' }, { label: 'UNIT PRICE', num: true }, { label: 'AMOUNT', num: true }, { label: 'REMAINING', num: true }, { label: 'ACTOR' }, { label: 'STALL FEE', num: true }, { label: 'TTL LEFT', num: true }, { label: 'FLAGS' }], rows.map((o) => orderRow(o, q, now)), `All resting orders ${s.pair}`, true),
    h('p', { class: 'tr-hint' }, `${rows.length} order${rows.length === 1 ? '' : 's'} shown; refreshes live on book updates. Unit price is ${q} per unit.`));
}

function orderRow(o: TradeBookOrderView, q: Parameters<typeof fmtUnit>[1], now: number): HTMLElement {
  const sideCls = o.side === 'buy' ? 'tr-buy' : 'tr-sell';
  return h('tr', { class: o.mine ? 'tr-own' : '', 'data-book-order': o.orderId, 'data-actor': o.actorKind, 'data-mine': o.mine ? '1' : null },
    td(`${o.side === 'buy' ? 'BID' : 'ASK'}${o.mine ? ' - YOURS' : ''}`, sideCls), td(fmtUnit(o.price, q), 'num'), td(String(o.amount), 'num'), td(String(o.remaining), 'num'),
    td(badge(o.actorKind, ACTOR_BADGE[o.actorKind])), td(bpLabel(o.stallFeeBp), 'num'), td(timeLeft(o.expiresAtMs, now), 'num'),
    td(o.fillPolicy === 'all_or_nothing' ? badge('AON', 'info') : badge('partial ok', 'dim')));
}

/** All pairs of the planet with best bid / ask, last price, 24 h volume. Rows are buttons-by-keyboard: Enter selects the pair. */
export function renderOverview(body: HTMLElement, s: TradeState, select: (pair: string) => void): void {
  if (!gate(body, s.panels.overview, s.pairs.length === 0 ? 'No tradable pairs.' : null)) return;
  const rows = s.pairs.map((p) => {
    const top = s.top[p.pair];
    const row = s.board.find((r) => r.pair === p.pair);
    const cls = row ? row.classification.replace('_', ' ') : 'no trades';
    const last = row?.last ? `${fmtUnit(row.last, p.quote)}` : '-';
    return h('tr', { class: p.pair === s.pair ? 'is-sel' : '', 'data-pair': p.pair },
      td(h('button', { type: 'button', class: 'tr-linkbtn', onclick: () => select(p.pair), 'aria-label': `Open pair ${p.pair}` }, p.pair)),
      td(top?.bid ? fmtUnit(top.bid, p.quote) : '-', 'num'), td(top?.ask ? fmtUnit(top.ask, p.quote) : '-', 'num'),
      td(last, 'num'), td(row ? String(row.volume24h) : '0', 'num'), td(badge(cls.toUpperCase(), row?.classification === 'organic' ? 'ok' : row?.classification === 'fixture' ? 'fixture' : row?.classification === 'mixed' ? 'warn' : 'dim')),
      td(fmtAmount(p.quote, p.minNotionalAtomic), 'num'));
  });
  body.replaceChildren(table([{ label: 'PAIR' }, { label: 'BEST BID', num: true }, { label: 'BEST ASK', num: true }, { label: 'LAST', num: true }, { label: '24H VOLUME', num: true }, { label: 'DATA' }, { label: 'MIN NOTIONAL', num: true }], rows, 'All pairs overview'),
    h('p', { class: 'tr-hint' }, 'Best bid / ask are quote per unit, fetched once per pair and refreshed by live book pushes.'));
}
