import { describe, expect, it } from 'vitest';
import { feeUnitsOf, merchantEvent, portAuthorityEvent } from '../../src/market/progression/market-progress-events.js';

const src = { planetId: 'p', tick: 7, colonyId: 'cA', playerId: 'A', tradeId: 'tr_1' };

describe('market progress events (W13-27)', () => {
  it('counts a fee unit as one whole display unit of the fee token, rounded up, 0 for a zero fee', () => {
    expect(feeUnitsOf('USDC', '100000')).toBe(1); // demo: 0.10 USDC
    expect(feeUnitsOf('USDC', '1000000')).toBe(1);
    expect(feeUnitsOf('USDC', '1000001')).toBe(2);
    expect(feeUnitsOf('USDC', '0')).toBe(0);
    expect(feeUnitsOf('bio.water', '5')).toBe(5);
    expect(feeUnitsOf('NEAR', (3n * 10n ** 24n).toString())).toBe(3);
  });

  it('builds idempotent ids from trade and colony, and skips a zero fee', () => {
    expect(merchantEvent(src)).toMatchObject({ eventId: 'market:merchant:tr_1:cA', family: 'merchant', metric: 'counter', value: 1, atTick: 7 });
    expect(portAuthorityEvent(src, 'USDC', '100000')).toMatchObject({ eventId: 'market:portAuthority:tr_1:cA', family: 'port-authority', value: 1 });
    expect(portAuthorityEvent(src, 'USDC', '0')).toBeNull();
  });
});
