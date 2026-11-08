/** Which data the page refetches when. Pure so the rules are testable without a DOM or a network. */
export type LoaderName = 'orders' | 'balances' | 'fills' | 'book' | 'board' | 'bookOrders' | 'stall' | 'keys' | 'overview';

/** After a placement, cancel or an `order` / `fill` push: everything an order change can move, including the keys' usage meters. */
export const AFTER_ORDER_CHANGE: readonly LoaderName[] = ['orders', 'balances', 'fills', 'book', 'board', 'bookOrders', 'stall', 'keys'];

/** Every 5 s, per visible tab: the keys panel shows today's usage of each key, which a bot moves without any push to this page. */
export function tickRefresh(tab: string): readonly LoaderName[] {
  return tab === 'keys' ? ['keys'] : [];
}

/** Minimum gap between two overview refetches caused by book pushes (they arrive up to 1 Hz per pair, 110 pairs). */
export const OVERVIEW_MIN_GAP_MS = 3000;

/** Delay until the next push-driven overview refetch may run; 0 = now. Pure so the throttle is testable. */
export function overviewDelay(lastFetchAt: number, now: number, minGapMs = OVERVIEW_MIN_GAP_MS): number {
  return Math.max(0, lastFetchAt + minGapMs - now);
}

/** Opening a tab refreshes the data that tab shows and nothing else has kept fresh. */
export function onTabOpen(tab: string): readonly LoaderName[] {
  return tab === 'keys' ? ['keys'] : tab === 'pairs' ? ['overview'] : [];
}
