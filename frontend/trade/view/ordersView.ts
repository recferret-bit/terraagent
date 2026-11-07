import { formatAtomic, mockLabel, parsePairId, type TradeFillView, type TradeOrderView } from '@terra/contracts';
import { cancellable, filterOrders, type OrderFilter, type TradeState } from '../model/state';
import { bpLabel, fmtAmount, fmtUnit, timeLeft } from '../model/units';
import { badge, gate, h, table, td } from './dom';

export interface OrdersActions { cancel(orderId: string): void; cancelAll(): void; setFilter(f: OrderFilter): void }

const STATE_KIND: Record<string, string> = { OPEN: 'info', PARTIAL: 'warn', FILLED: 'ok', CANCELLED: 'dim', EXPIRED: 'dim', REJECTED: 'err', PENDING: 'warn', MATCHED: 'warn' };
const FILTERS: ReadonlyArray<[OrderFilter, string]> = [['open', 'Open'], ['filled', 'Filled'], ['cancelled', 'Cancelled'], ['expired', 'Expired'], ['all', 'All']];

/** What an order holds back: buys reserve quote atomic, sells reserve base units. */
export function reservedLabel(o: TradeOrderView): string {
  const p = parsePairId(o.pair);
  if (o.side === 'sell') return `${o.reserved} ${o.resource}`;
  return p ? `${formatAtomic(p.quote, o.reserved)} ${mockLabel(p.quote)}` : o.reserved;
}

export function renderOrders(body: HTMLElement, s: TradeState, filter: OrderFilter, busy: ReadonlySet<string>, a: OrdersActions, now: number): void {
  if (!gate(body, s.panels.orders, null)) return;
  const shown = filterOrders(s.orders, filter);
  const open = cancellable(s.orders);
  const tabs = h('div', { class: 'tr-chips', role: 'group', 'aria-label': 'Order filter' }, ...FILTERS.map(([f, label]) =>
    h('button', { type: 'button', class: `tr-chip${f === filter ? ' is-on' : ''}`, 'aria-pressed': String(f === filter), onclick: () => a.setFilter(f) }, `${label} (${filterOrders(s.orders, f).length})`)));
  const cancelAll = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'orders-cancel-all', disabled: open.length === 0 ? true : null, onclick: () => a.cancelAll() }, `CANCEL ALL (${open.length})`);
  const rows = shown.map((o) => {
    const q = parsePairId(o.pair)?.quote ?? 'USDC';
    const live = o.state === 'OPEN' || o.state === 'PARTIAL';
    return h('tr', { 'data-order': o.orderId, 'data-state': o.state },
      td(badge(o.state, STATE_KIND[o.state] ?? 'dim')),
      td(o.side.toUpperCase(), o.side === 'buy' ? 'tr-buy' : 'tr-sell'),
      td(o.pair),
      td(`${o.filled}/${o.amount}`, 'num'),
      td(fmtAmount(q, o.price.amount), 'num'),
      td(fmtUnit({ num: o.price.amount, den: o.amount }, q), 'num'),
      td(reservedLabel(o), 'num'),
      td(`${bpLabel(o.platformFeeBp)} + ${bpLabel(o.stallFeeBp)}`, 'num'),
      td(live ? timeLeft(o.expiresAtMs, now) : '-', 'num'),
      td(o.fillPolicy === 'all_or_nothing' ? badge('AON', 'info') : badge('partial', 'dim')),
      td(live ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-cancel': o.orderId, disabled: busy.has(o.orderId) ? true : null, 'aria-label': `Cancel order ${o.orderId.slice(-8)}`, onclick: () => a.cancel(o.orderId) }, busy.has(o.orderId) ? '...' : 'CANCEL') : o.lastError ? h('span', { class: 'tr-hint' }, o.lastError) : null));
  });
  body.replaceChildren(h('div', { class: 'tr-row tr-between' }, tabs, cancelAll),
    rows.length ? table([{ label: 'STATE' }, { label: 'SIDE' }, { label: 'PAIR' }, { label: 'FILLED', num: true }, { label: 'TOTAL', num: true }, { label: 'UNIT', num: true }, { label: 'RESERVED', num: true }, { label: 'FEES PLAT + STALL', num: true }, { label: 'TTL LEFT', num: true }, { label: 'FILL' }, { label: '' }], rows, 'My orders', true)
      : h('p', { class: 'tr-note' }, filter === 'open' ? 'You have no open orders on this planet. Use the ticket to place one.' : 'No orders in this state.'));
}

const KIND_BADGE: Record<string, string> = { player: 'info', bot: 'system', npc: 'dim', guild: 'info', fixture: 'fixture', subsidy: 'warn' };

/** My fills with the fee breakdown (notional, platform, stall) and the receipt link. */
export function renderFills(body: HTMLElement, s: TradeState): void {
  if (!gate(body, s.panels.fills, s.panels.fills.status === 'ready' && s.fills.length === 0 ? 'No fills yet. A fill appears here the moment one of your orders trades.' : null)) return;
  const rows = s.fills.slice(0, 100).map((f: TradeFillView) => {
    const q = f.quote;
    const when = new Date(f.atMs).toLocaleTimeString();
    return h('tr', { 'data-trade': f.tradeId },
      td(when), td(f.side.toUpperCase(), f.side === 'buy' ? 'tr-buy' : 'tr-sell'), td(f.pair),
      td(String(f.amount), 'num'), td(fmtAmount(q, f.notional), 'num'),
      td(`${fmtAmount(q, f.platformFee)}`, 'num'), td(`${fmtAmount(q, f.stallFee)} (${bpLabel(f.stallFeeBp)})`, 'num'),
      td(badge(f.counterpartyKind, KIND_BADGE[f.counterpartyKind] ?? 'dim')),
      td(badge(f.state, f.state === 'FINAL' ? 'ok' : f.state === 'FAILED' ? 'err' : 'warn'), ''),
      td(f.txHash ? h('a', { href: `/dev/chain/tx/${encodeURIComponent(f.txHash)}`, target: '_blank', rel: 'noopener' }, `${f.txHash.slice(0, 10)}...`) : h('span', { class: 'tr-hint' }, 'pending')));
  });
  body.replaceChildren(table([{ label: 'TIME' }, { label: 'SIDE' }, { label: 'PAIR' }, { label: 'AMOUNT', num: true }, { label: 'NOTIONAL', num: true }, { label: 'PLATFORM FEE', num: true }, { label: 'STALL FEE', num: true }, { label: 'COUNTERPARTY' }, { label: 'SETTLEMENT' }, { label: 'RECEIPT' }], rows, 'My fills'),
    h('p', { class: 'tr-hint' }, 'Fees are paid by the buyer. Receipts open the dev chain explorer.'));
}
