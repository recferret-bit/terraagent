import { describe, expect, it } from 'vitest';
import { createLedgerState, post, type Leg, type LedgerState, type PostResult } from '../src';
import { SYS, leg, move, posting } from './helpers';

const M = Number.MAX_SAFE_INTEGER;

/** A ledger where `colony:0` holds 10 ore and 4 water. */
function funded(): LedgerState {
  const state = createLedgerState();
  post(state, posting([leg('sys:mine', 'ore', -10), leg('colony:0', 'ore', 10), leg('sys:well', 'water', -4), leg('colony:0', 'water', 4)]), SYS);
  return state;
}

/** Posts `input` and asserts it was rejected without touching the state. */
function expectReject(state: LedgerState, legs: unknown, code: string, extra: Partial<PostResult> = {}): void {
  const before = structuredClone(state);
  const res = post(state, posting(legs as Leg[]), SYS);
  expect(res).toMatchObject({ ok: false, code, ...extra });
  expect(state).toEqual(before);
}

describe('post: shape rejects', () => {
  it('no_legs for fewer than two legs or a non-array', () => {
    const state = funded();
    expectReject(state, [], 'no_legs');
    expectReject(state, [leg('colony:0', 'ore', 1)], 'no_legs');
    expectReject(state, undefined, 'no_legs');
    expectReject(state, { length: 2 }, 'no_legs');
  });

  it('invalid_leg for missing, empty or non-string ids', () => {
    const state = funded();
    const ok = leg('colony:1', 'ore', 1);
    expectReject(state, [ok, null], 'invalid_leg');
    expectReject(state, [ok, undefined], 'invalid_leg');
    expectReject(state, [ok, leg('', 'ore', -1)], 'invalid_leg');
    expectReject(state, [ok, leg('colony:0', '', -1)], 'invalid_leg');
    expectReject(state, [ok, { account: 7, asset: 'ore', delta: -1 }], 'invalid_leg');
    expectReject(state, [ok, { account: 'colony:0', asset: null, delta: -1 }], 'invalid_leg');
  });

  it('invalid_leg for Object.prototype keys, which a plain-object sheet cannot hold safely', () => {
    const state = funded();
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expectReject(state, [leg(id, 'ore', 1), leg('colony:0', 'ore', -1)], 'invalid_leg');
      expectReject(state, [leg('sys:mine', id, -1), leg('colony:0', id, 1)], 'invalid_leg');
    }
    expect(({} as Record<string, unknown>).ore).toBeUndefined();
  });

  it('invalid_amount for zero, fractional, non-finite or unsafe deltas', () => {
    const state = funded();
    for (const delta of [0, 0.5, -1.5, NaN, Infinity, M + 1, '1' as unknown as number]) {
      expectReject(state, [leg('colony:0', 'ore', delta), leg('colony:1', 'ore', 1)], 'invalid_amount', { account: 'colony:0', asset: 'ore' });
    }
  });

  it('unbalanced when an asset does not sum to zero', () => {
    const state = funded();
    expectReject(state, [leg('colony:0', 'ore', -2), leg('colony:1', 'ore', 1)], 'unbalanced', { asset: 'ore' });
    expectReject(state, [leg('colony:0', 'ore', -1), leg('colony:1', 'water', 1)], 'unbalanced', { asset: 'ore' });
    expectReject(
      state,
      [leg('colony:0', 'ore', -1), leg('colony:1', 'ore', 1), leg('colony:0', 'water', -1), leg('colony:1', 'water', 2)],
      'unbalanced',
      { asset: 'water' },
    );
  });
});

describe('post: overflow rejects', () => {
  it('rejects an entry whose per-asset partial sum leaves the safe range (no rounding into balance)', () => {
    const state = funded();
    // In floats this sums to 0 by rounding although the true sum is 1.
    const legs = [M, M, 1, 1, -M, -M, -1].map((d, i) => leg(`sys:${i}`, 'ore', d));
    expectReject(state, legs, 'invalid_amount', { asset: 'ore' });
  });

  it('rejects an entry that would push a balance past MAX_SAFE_INTEGER', () => {
    const state = createLedgerState();
    expect(post(state, move('sys:mine', 'colony:0', 'ore', M), SYS).ok).toBe(true);
    expectReject(state, [leg('sys:mine', 'ore', -1), leg('colony:0', 'ore', 1)], 'invalid_amount', { account: 'sys:mine', asset: 'ore' });
  });

  it('rejects an intermediate overflow on one cell even when the net is small', () => {
    const state = createLedgerState();
    post(state, move('sys:mine', 'colony:0', 'ore', 2), SYS);
    const legs = [leg('colony:0', 'ore', M), leg('colony:0', 'ore', -M), leg('sys:a', 'ore', M), leg('sys:a', 'ore', -M)];
    expectReject(state, legs, 'invalid_amount', { account: 'colony:0', asset: 'ore' });
  });
});

describe('post: funds', () => {
  it('insufficient_funds reports have and need', () => {
    const state = funded();
    expectReject(state, [leg('colony:0', 'ore', -11), leg('colony:1', 'ore', 11)], 'insufficient_funds', {
      account: 'colony:0',
      asset: 'ore',
      have: 10,
      need: 11,
    });
  });

  it('nets legs on the same account and asset before checking funds', () => {
    const state = funded();
    const legs = [leg('colony:0', 'ore', -15), leg('colony:0', 'ore', 6), leg('colony:1', 'ore', 9)];
    expect(post(state, posting(legs), SYS).ok).toBe(true);
    expect(state.balances['colony:0'].ore).toBe(1);
    expectReject(state, [leg('colony:0', 'ore', -5), leg('colony:0', 'ore', 3), leg('colony:1', 'ore', 2)], 'insufficient_funds', {
      have: 1,
      need: 2,
    });
  });

  it('can spend the whole balance down to exactly zero', () => {
    const state = funded();
    expect(post(state, move('colony:0', 'sys:build', 'ore', 10), SYS).ok).toBe(true);
    expect(state.balances['colony:0']).toEqual({ water: 4 });
  });

  it('the default policy lets no account go negative', () => {
    const state = createLedgerState();
    expect(post(state, move('sys:mine', 'colony:0', 'ore', 1))).toMatchObject({ ok: false, code: 'insufficient_funds', account: 'sys:mine' });
    expect(state).toEqual(createLedgerState());
  });

  it('a policy account may go negative; a credit to an already negative account passes', () => {
    const state = createLedgerState();
    expect(post(state, move('sys:mine', 'colony:0', 'ore', 5), SYS).ok).toBe(true);
    expect(post(state, move('colony:0', 'sys:mine', 'ore', 2)).ok).toBe(true);
    expect(state.balances['sys:mine'].ore).toBe(-3);
  });

  it('an already negative non-policy account cannot be debited further', () => {
    const state = createLedgerState();
    state.balances = { 'colony:0': { ore: -2 }, 'sys:mine': { ore: 2 } };
    expectReject(state, [leg('colony:0', 'ore', -1), leg('sys:mine', 'ore', 1)], 'insufficient_funds', { have: -2, need: 1 });
  });
});
