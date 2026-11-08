import { describe, expect, it } from 'vitest';
import { AFTER_ORDER_CHANGE, OVERVIEW_MIN_GAP_MS, onTabOpen, overviewDelay, tickRefresh } from './refresh';

describe('refresh rules', () => {
  it('an order change also refreshes the keys usage meters', () => {
    expect(AFTER_ORDER_CHANGE).toContain('keys');
    expect(AFTER_ORDER_CHANGE).toContain('orders');
  });
  it('the keys tab reloads on open and every tick, other tabs do not poll', () => {
    expect(onTabOpen('keys')).toEqual(['keys']);
    expect(tickRefresh('keys')).toEqual(['keys']);
    expect(tickRefresh('orders')).toEqual([]);
    expect(onTabOpen('fills')).toEqual([]);
  });
  it('the All pairs tab refetches the one-request overview on open; pushes are throttled to one fetch per gap', () => {
    expect(onTabOpen('pairs')).toEqual(['overview']);
    expect(tickRefresh('pairs')).toEqual([]);
    expect(overviewDelay(0, 10_000)).toBe(0);
    expect(overviewDelay(10_000, 10_500)).toBe(OVERVIEW_MIN_GAP_MS - 500);
  });
});
