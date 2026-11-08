/** Which data the page refetches when. Pure so the rules are testable without a DOM or a network. */
export type LoaderName = 'orders' | 'balances' | 'fills' | 'book' | 'board' | 'bookOrders' | 'stall' | 'keys';

/** After a placement, cancel or an `order` / `fill` push: everything an order change can move, including the keys' usage meters. */
export const AFTER_ORDER_CHANGE: readonly LoaderName[] = ['orders', 'balances', 'fills', 'book', 'board', 'bookOrders', 'stall', 'keys'];

/** Every 5 s, per visible tab: the keys panel shows today's usage of each key, which a bot moves without any push to this page. */
export function tickRefresh(tab: string): readonly LoaderName[] {
  return tab === 'keys' ? ['keys'] : [];
}

/** Opening a tab refreshes the data that tab shows and nothing else has kept fresh. */
export function onTabOpen(tab: string): readonly LoaderName[] {
  return tab === 'keys' ? ['keys'] : [];
}
