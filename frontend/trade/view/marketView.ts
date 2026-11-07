import { parsePairId, type TradeOrderView } from '@terra/contracts';
import { buildMarketLines, orderPrice, type MarketLine } from '../model/allOrders';
import type { TradeState } from '../model/state';
import { bpLabel, fmtAmount, fmtUnit, timeLeft } from '../model/units';
import { badge, gate, h, note, table, td } from './dom';

/**
 * Market-wide table of the selected pair. The public book only exposes aggregated levels (price, amount, order count): per-order
 * rows with actor kind, stall fee, TTL and AON exist only for the caller's own orders, which are highlighted under their level.
 */
export function renderMarketOrders(body: HTMLElement, s: TradeState, now: number): void {
  if (!gate(body, s.panels.book, null)) return;
  const book = s.book;
  const parsed = parsePairId(s.pair);
  if (!book || !parsed) { body.replaceChildren(note('No book loaded.')); return; }
  const q = parsed.quote;
  const lines = buildMarketLines(book.asks, book.bids, s.orders, s.pair);
  if (lines.length === 0) { body.replaceChildren(note('No resting orders on this pair.')); return; }
  const rows = lines.map((l) => lineRow(l, q, now));
  body.replaceChildren(
    note('Every resting order is counted below as a price level. The API does not list other actors\' individual orders, so actor kind, stall fee, TTL and all-or-nothing show only on your own orders (highlighted).'),
    table([{ label: 'SIDE' }, { label: 'UNIT PRICE', num: true }, { label: 'AMOUNT', num: true }, { label: 'REMAINING', num: true }, { label: 'ORDERS', num: true }, { label: 'ACTOR' }, { label: 'STALL FEE', num: true }, { label: 'TTL LEFT', num: true }, { label: 'FLAGS' }], rows, `All resting orders ${s.pair}`));
}

function lineRow(l: MarketLine, q: Parameters<typeof fmtUnit>[1], now: number): HTMLElement {
  const sideCls = l.side === 'buy' ? 'tr-buy' : 'tr-sell';
  if (l.kind === 'level') {
    return h('tr', { class: 'tr-level', 'data-level': l.side }, td(l.side === 'buy' ? 'BID' : 'ASK', sideCls), td(fmtUnit(l.price, q), 'num'), td(String(l.amount), 'num'), td(String(l.amount), 'num'), td(String(l.orders), 'num'),
      td(l.ownAtLevel > 0 ? badge(`${l.ownAtLevel} yours`, 'own') : h('span', { class: 'tr-hint' }, 'all actors')), td('-', 'num'), td('-', 'num'), td(''));
  }
  const o: TradeOrderView = l.order;
  return h('tr', { class: 'tr-own', 'data-own-order': o.orderId },
    td(`${o.side === 'buy' ? 'BID' : 'ASK'} - YOURS`, sideCls), td(fmtUnit(orderPrice(o), q), 'num'), td(String(o.amount), 'num'), td(String(l.remaining), 'num'), td('1', 'num'),
    td(badge(l.actor, 'info')), td(bpLabel(o.stallFeeBp), 'num'), td(timeLeft(o.expiresAtMs, now), 'num'),
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
