import { describe, expect, it } from 'vitest';
import {
  ESCROW_STATUSES,
  EscrowActionInput,
  EscrowGetInput,
  EscrowOpenInput,
  EscrowPort,
  EscrowView,
  NEAR_ADAPTER_ESCROW,
} from '../../src/near/application/ports/escrow.port';

const FUNDER = 'col-a.pilot.terraagent.mock';
const HOLD = 'bounty.escrow.terraagent.mock';
const VIEW = {
  escrowId: 'esc_bt01',
  status: 'open' as const,
  funder: FUNDER,
  beneficiary: HOLD,
  tokenId: 'metals.t1',
  amount: '200',
  expiresAtMs: 1_700_000_000_000,
};
const OPEN = {
  opId: 'bounty-open:bt_01',
  funder: FUNDER,
  beneficiary: HOLD,
  tokenId: 'metals.t1',
  amount: '200',
  expiresAtMs: VIEW.expiresAtMs,
};

describe('W22-02 EscrowPort get and view schemas', () => {
  it('parses a get with no opId and a view in each status', () => {
    expect(NEAR_ADAPTER_ESCROW).toBe('NEAR_ADAPTER_ESCROW');
    expect(EscrowPort.prototype.open).toBeUndefined();
    expect(EscrowPort.prototype.get).toBeUndefined();
    expect([...ESCROW_STATUSES]).toEqual(['open', 'claimed', 'refunded']);
    expect(EscrowGetInput.parse({ escrowId: 'esc_bt01' }).escrowId).toBe('esc_bt01');
    expect(EscrowView.parse(VIEW).amount).toBe('200');
    expect(EscrowView.parse({ ...VIEW, status: 'claimed' }).status).toBe('claimed');
    expect(EscrowView.parse({ ...VIEW, status: 'refunded', amount: '0' }).status).toBe('refunded');
    expect(EscrowOpenInput.parse(OPEN).beneficiary).toBe(HOLD);
    expect(EscrowActionInput.parse({ opId: 'bounty-pay:bt_01', escrowId: 'esc_bt01', caller: FUNDER }).caller).toBe(FUNDER);
  });

  it('rejects a bad account on the view, the open, and the claim', () => {
    expect(EscrowView.safeParse({ ...VIEW, funder: 'NOT AN ACCOUNT' }).success).toBe(false);
    expect(EscrowView.safeParse({ ...VIEW, beneficiary: 'Has Spaces' }).success).toBe(false);
    expect(EscrowOpenInput.safeParse({ ...OPEN, funder: 'NOT AN ACCOUNT' }).success).toBe(false);
    expect(EscrowActionInput.safeParse({ opId: 'bounty-pay:bt_01', escrowId: 'esc_bt01', caller: 'BAD' }).success).toBe(false);
  });

  it('rejects an extra field, a missing beneficiary, a non-status, and an opId on get', () => {
    expect(EscrowView.safeParse({ ...VIEW, extra: 1 }).success).toBe(false);
    expect(EscrowView.safeParse({ ...VIEW, status: 'pending' }).success).toBe(false);
    expect(EscrowView.safeParse({ ...VIEW, amount: '0200' }).success).toBe(false);
    expect(EscrowView.safeParse({ ...VIEW, amount: '-1' }).success).toBe(false);
    expect(EscrowGetInput.safeParse({ escrowId: '' }).success).toBe(false);
    expect(EscrowGetInput.safeParse({ escrowId: 'esc_bt01', opId: 'bounty-open:bt_01' }).success).toBe(false);
    expect(EscrowOpenInput.safeParse({
      opId: OPEN.opId,
      funder: OPEN.funder,
      tokenId: OPEN.tokenId,
      amount: OPEN.amount,
      expiresAtMs: OPEN.expiresAtMs,
    }).success).toBe(false);
    expect(EscrowOpenInput.safeParse({ ...OPEN, expiresAtMs: -1 }).success).toBe(false);
    expect(EscrowOpenInput.safeParse({ ...OPEN, expiresAtMs: 0 }).success).toBe(true);
  });
});
