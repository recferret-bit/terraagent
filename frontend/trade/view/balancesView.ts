import { formatAtomic, mockLabel, type MarketTokenKey } from '@terra/contracts';
import type { TradeState } from '../model/state';
import { gate, h, note, table, td } from './dom';

/** Quote tokens plus ONLY the caller's own in-orbit cargo (free vs reserved). Nothing of any other player is requested or shown. */
export function renderBalances(body: HTMLElement, s: TradeState): void {
  if (!gate(body, s.panels.balances, null)) return;
  const b = s.balances;
  if (!b) { body.replaceChildren(note('No colony of yours on this planet. Join it from the game first, then your balances appear here.', 'warn')); return; }
  const quote = Object.entries(b.quote).map(([k, v]) => h('tr', {}, td(mockLabel(k as MarketTokenKey)), td(formatAtomic(k as MarketTokenKey, v.free), 'num'), td(formatAtomic(k as MarketTokenKey, v.reserved), 'num'), td(formatAtomic(k as MarketTokenKey, v.total), 'num')));
  const cargo = Object.entries(b.inOrbit).map(([k, v]) => h('tr', {}, td(k), td(v.free, 'num'), td(v.reserved, 'num'), td(v.total, 'num')));
  body.replaceChildren(
    h('p', { class: 'tr-hint' }, `Your colony on ${b.planetId}`),
    quote.length ? table([{ label: 'QUOTE TOKEN' }, { label: 'FREE', num: true }, { label: 'RESERVED', num: true }, { label: 'TOTAL', num: true }], quote, 'Quote balances') : note('No quote tokens yet.'),
    cargo.length ? table([{ label: 'IN ORBIT' }, { label: 'FREE', num: true }, { label: 'RESERVED', num: true }, { label: 'TOTAL', num: true }], cargo, 'In-orbit cargo') : note('No cargo in orbit.'),
    note('Only cargo already in orbit can be sold here. Stock on the surface must be exported to orbit through your Trade Hub in the game (EXPORT TO ORBIT).'));
}
