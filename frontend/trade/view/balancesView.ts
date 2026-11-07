import { formatAtomic, mockLabel, type MarketTokenKey } from '@terra/contracts';
import type { TradeState } from '../model/state';
import { bpLabel } from '../model/units';
import { gate, h, note, table, td } from './dom';

/**
 * Read-only stall fee of the caller's Trade Hub (charged to buyers on fills against your asks) and the fees earned. `market.setHubFee`
 * exists only as a game-socket command (no REST route), so it is changed in the game; the in-game MARKET tab shows the same value.
 */
function stallLine(s: TradeState): HTMLElement {
  const st = s.stall;
  if (!st) return h('p', { class: 'tr-hint', 'data-stall': 'none' }, 'Stall fee: not available (no hub of yours on this planet).');
  const earned = Object.entries(st.earned).filter(([, v]) => BigInt(v) > 0n).map(([k, v]) => `${formatAtomic(k as MarketTokenKey, v)} ${mockLabel(k as MarketTokenKey)}`);
  return h('p', { class: 'tr-hint', 'data-stall': String(st.hubFeeBp) },
    'Stall fee (read-only): ', h('b', {}, bpLabel(st.hubFeeBp)), ` on your sales to buyers (max ${s.policy ? bpLabel(s.policy.stallFeeMaxBp) : 'n/a'}); orders already open keep the fee they were placed with. Earned: ${earned.length ? earned.join(', ') : 'nothing yet'}. The trade API has no endpoint to change it (only the game command market.setHubFee).`);
}

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
    stallLine(s),
    note('Only cargo already in orbit can be sold here. Stock on the surface must be exported to orbit through your Trade Hub in the game (EXPORT TO ORBIT).'));
}
