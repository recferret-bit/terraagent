import { describe, expect, it } from 'vitest';
import { AFTER_ORDER_CHANGE, onTabOpen, tickRefresh } from './refresh';

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
});
