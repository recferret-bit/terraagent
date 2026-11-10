import { describe, expect, it } from 'vitest';
import { escrowHoldAccount, escrowIdFromOp } from '../../src/near/infrastructure/adapters/mock/escrow-id.js';

describe('escrowIdFromOp', () => {
  it('is a stable escrow: id that fits the row and is the hold account', () => {
    const id = escrowIdFromOp('bounty-open:bt_01');
    expect(id).toBe(escrowIdFromOp('bounty-open:bt_01'));
    expect(id.startsWith('escrow:')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^escrow:[0-9a-f]{32}$/);
    expect(id).not.toBe(escrowIdFromOp('bounty-open:bt_02'));
    expect(escrowHoldAccount(id)).toBe(id);
  });
});
