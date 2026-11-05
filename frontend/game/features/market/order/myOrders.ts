import { formatAtomic, mockLabel, parsePairId, type MyOrderView } from '@terra/contracts';
import { makeBtn, makeDiv } from '../../shared/dom';
import { resourceLabel } from '../tab/pairs';

export const CANCELABLE_STATES: readonly string[] = ['PENDING', 'OPEN', 'PARTIAL'];

const el = (cls: string, text: string): HTMLElement => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };

/** `Buy 300 Water (T1) for 10.00 mock USDC`: the order's pinned terms. */
export function orderTitle(o: MyOrderView): string {
  const quote = parsePairId(o.pair)?.quote;
  const price = quote ? `${formatAtomic(quote, o.price.amount)} ${mockLabel(quote)}` : o.price.amount;
  return `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.amount} ${resourceLabel(o.resource)} for ${price}`;
}

/** One "my orders" row: terms, filled/amount, state, pinned fees and a Cancel button for live orders. */
export function myOrderRow(o: MyOrderView, onCancel: (o: MyOrderView) => void): HTMLElement {
  const row = makeDiv('ta-order__my', 'order-my');
  row.dataset.orderId = o.orderId;
  const fees = `fees ${o.platformFeeBp / 100}% + ${o.stallFeeBp / 100}% (${o.policyVersion})`;
  row.append(el('ta-order__my-title', orderTitle(o)), el('ta-order__my-fill', `${o.filled}/${o.amount}`), el('ta-order__my-state', o.state), el('ta-order__my-fees', fees));
  if (CANCELABLE_STATES.includes(o.state)) row.append(makeBtn('btn-sm plate-sm ta-order__cancel', 'order-cancel', 'Cancel', () => onCancel(o)));
  return row;
}
