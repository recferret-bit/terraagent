import { parsePairId, type BookLevel, type OrderSide } from '@terra/contracts';
import { buildLadder, spreadRatio, type LadderRow } from '../model/ladder';
import type { TradeState } from '../model/state';
import { fmtUnit } from '../model/units';
import { formatUnitPrice } from '@terra/contracts';
import { gate, h, note, fill } from './dom';

export type PickLevel = (level: BookLevel, takerSide: OrderSide) => void;

function rowEl(r: LadderRow, side: 'ask' | 'bid', quote: ReturnType<typeof quoteOf>, own: boolean, pick: PickLevel): HTMLElement {
  const label = `${side === 'ask' ? 'Ask' : 'Bid'} ${fmtUnit(r.price, quote)} ${quote}, ${r.level.amount} units, ${r.level.orders} orders. ${side === 'ask' ? 'Buy' : 'Sell'} at this price`;
  return h('button', {
    type: 'button', 'data-testid': `ladder-${side}`, class: `tr-lv tr-lv-${side}${own ? ' is-own' : ''}`, 'aria-label': label, title: 'Click to prefill the order ticket',
    onclick: () => pick(r.level, side === 'ask' ? 'buy' : 'sell'),
  },
  h('span', { class: 'tr-lv-bar', style: `width:${Math.round(r.depth * 100)}%`, 'aria-hidden': 'true' }),
  h('span', { class: 'tr-lv-p num' }, fmtUnit(r.price, quote)),
  h('span', { class: 'num' }, String(r.level.amount)),
  h('span', { class: 'num' }, String(r.cumulative)),
  h('span', { class: 'num tr-dim' }, String(r.level.orders)));
}

const quoteOf = (pair: string) => parsePairId(pair)?.quote ?? 'USDC';

/** Depth ladder: asks above (best at the bottom), spread, bids below; cumulative base units per side. */
export function renderLadder(body: HTMLElement, s: TradeState, ownPrices: ReadonlySet<string>, pick: PickLevel): void {
  if (!gate(body, s.panels.book, null)) return;
  const book = s.book;
  if (!book) { body.replaceChildren(note('No book for this pair.')); return; }
  const quote = quoteOf(book.pair);
  const lad = buildLadder(book.bids, book.asks);
  const head = h('div', { class: 'tr-lv-head', 'aria-hidden': 'true' }, h('span', {}, `PRICE (${quote})`), h('span', { class: 'num' }, 'AMOUNT'), h('span', { class: 'num' }, 'CUM.'), h('span', { class: 'num' }, 'ORD'));
  const key = (r: LadderRow): string => `${r.level.num}/${r.level.den}`;
  const asks = [...lad.asks].reverse().map((r) => rowEl(r, 'ask', quote, ownPrices.has(`sell:${key(r)}`), pick));
  const bids = lad.bids.map((r) => rowEl(r, 'bid', quote, ownPrices.has(`buy:${key(r)}`), pick));
  const sr = lad.spread ? spreadRatio(lad.spread) : null;
  const spreadText = lad.crossed ? 'CROSSED BOOK' : sr ? `Spread ${formatUnitPrice(sr.num, sr.den, quote)} ${quote}${lad.spreadBp === null ? '' : ` (${(lad.spreadBp / 100).toFixed(2)} %)`}` : 'Spread: one side is empty';
  const empty = lad.asks.length + lad.bids.length === 0;
  fill(body,
    head,
    asks.length ? h('div', { class: 'tr-lv-side', role: 'list', 'aria-label': 'Asks' }, ...asks) : note('No asks.'),
    h('div', { class: 'tr-spread', role: 'status' }, spreadText, lad.bestBid && lad.bestAsk ? h('span', { class: 'tr-dim' }, ` bid ${fmtUnit(lad.bestBid, quote)} / ask ${fmtUnit(lad.bestAsk, quote)}`) : null),
    bids.length ? h('div', { class: 'tr-lv-side', role: 'list', 'aria-label': 'Bids' }, ...bids) : note('No bids.'),
    empty ? note('The book is empty. Place the first order, or seed it in dev with the market.seed command.') : null,
    book.reference ? h('p', { class: 'tr-hint' }, `Organic reference ${formatUnitPrice(book.reference.num, book.reference.den, quote)} ${quote} (book seq ${book.seq})`) : h('p', { class: 'tr-hint' }, `No organic reference price yet (book seq ${book.seq})`));
}
