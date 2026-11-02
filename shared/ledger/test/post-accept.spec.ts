import { describe, expect, it } from 'vitest';
import { createLedgerState, post, verifyLedger, type Leg } from '../src';
import { SYS, leg, move, posting } from './helpers';

describe('post: accepted entries', () => {
  it('applies every leg, assigns seq and appends a copy of the legs', () => {
    const state = createLedgerState();
    const legs: Leg[] = [leg('sys:mine', 'ore', -3), leg('colony:0', 'ore', 3)];
    const res = post(state, posting(legs, { at: 42, reason: 'terraform.yield', actor: 'system:terraform', ref: 'tile:1,2' }), SYS);
    expect(res).toEqual({
      ok: true,
      duplicate: false,
      entry: { seq: 1, at: 42, reason: 'terraform.yield', actor: 'system:terraform', ref: 'tile:1,2', legs },
    });
    expect(state.seq).toBe(1);
    expect(state.journal).toHaveLength(1);
    expect(state.balances).toEqual({ 'sys:mine': { ore: -3 }, 'colony:0': { ore: 3 } });
    legs[0].delta = -999;
    legs.push(leg('x', 'ore', 1));
    expect(state.journal[0].legs).toEqual([leg('sys:mine', 'ore', -3), leg('colony:0', 'ore', 3)]);
  });

  it('omits ref and opId when they are not given', () => {
    const state = createLedgerState();
    const res = post(state, move('sys:a', 'b', 'ore', 1), SYS);
    expect(res.ok && Object.keys(res.entry).sort()).toEqual(['actor', 'at', 'legs', 'reason', 'seq']);
  });

  it('seq is gap-free across accepted posts and untouched by rejected ones', () => {
    const state = createLedgerState();
    post(state, move('sys:a', 'b', 'ore', 1), SYS);
    post(state, move('b', 'c', 'ore', 5), SYS);
    const res = post(state, move('b', 'c', 'ore', 1), SYS);
    expect(res.ok && res.entry.seq).toBe(2);
    expect(state.journal.map((e) => e.seq)).toEqual([1, 2]);
    expect(verifyLedger(state)).toEqual({ ok: true });
  });

  it('accepts a multi-asset entry and a self-transfer that nets to zero', () => {
    const state = createLedgerState();
    const multi = [leg('sys:a', 'ore', -2), leg('b', 'ore', 2), leg('sys:a', 'water', -1), leg('b', 'water', 1)];
    expect(post(state, posting(multi), SYS).ok).toBe(true);
    expect(post(state, move('b', 'b', 'ore', 2), SYS).ok).toBe(true);
    expect(state.balances.b).toEqual({ ore: 2, water: 1 });
    expect(state.seq).toBe(2);
  });
});

describe('post: opId idempotency', () => {
  it('a repeat with the same content returns the original entry and changes nothing', () => {
    const state = createLedgerState();
    const first = post(state, move('sys:a', 'b', 'ore', 3, { opId: 'op-1', ref: 'order:1' }), SYS);
    const before = structuredClone(state);
    const again = post(state, move('sys:a', 'b', 'ore', 3, { opId: 'op-1', ref: 'order:1', at: 99 }), SYS);
    expect(first.ok && again.ok).toBe(true);
    expect(again).toEqual({ ok: true, duplicate: true, entry: first.ok ? first.entry : null });
    expect(again.ok && again.entry).toBe(state.journal[0]);
    expect(state).toEqual(before);
  });

  it('a duplicate is returned even if its funds would no longer suffice', () => {
    const state = createLedgerState();
    post(state, move('sys:a', 'b', 'ore', 3), SYS);
    post(state, move('b', 'c', 'ore', 3, { opId: 'spend' }), SYS);
    const again = post(state, move('b', 'c', 'ore', 3, { opId: 'spend' }), SYS);
    expect(again).toMatchObject({ ok: true, duplicate: true });
  });

  it('op_conflict when any of reason, actor, ref or legs differ', () => {
    const base = { opId: 'op-1', ref: 'order:1' };
    const variants = [
      move('sys:a', 'b', 'ore', 3, { ...base, reason: 'other' }),
      move('sys:a', 'b', 'ore', 3, { ...base, actor: 'someone' }),
      move('sys:a', 'b', 'ore', 3, { ...base, ref: 'order:2' }),
      move('sys:a', 'b', 'ore', 3, { opId: 'op-1' }),
      move('sys:a', 'b', 'ore', 4, base),
      move('sys:a', 'c', 'ore', 3, base),
      move('sys:a', 'b', 'water', 3, base),
      posting([leg('sys:a', 'ore', -2), leg('b', 'ore', 1), leg('b', 'ore', 1)], base),
    ];
    for (const input of variants) {
      const state = createLedgerState();
      post(state, move('sys:a', 'b', 'ore', 3, base), SYS);
      const before = structuredClone(state);
      expect(post(state, input, SYS)).toMatchObject({ ok: false, code: 'op_conflict' });
      expect(state).toEqual(before);
    }
  });

  it('a malformed repeat of a retained opId is rejected for its shape, never thrown', () => {
    const state = createLedgerState();
    post(state, move('sys:a', 'b', 'ore', 3, { opId: 'op-1' }), SYS);
    const legs = [leg('sys:a', 'ore', -3), null] as unknown as Leg[];
    expect(() => post(state, posting(legs, { opId: 'op-1' }), SYS)).not.toThrow();
    expect(post(state, posting(legs, { opId: 'op-1' }), SYS)).toMatchObject({ ok: false, code: 'invalid_leg' });
  });

  it('an unused opId posts normally, and a rejected post does not reserve its opId', () => {
    const state = createLedgerState();
    expect(post(state, move('b', 'c', 'ore', 1, { opId: 'x' }), SYS)).toMatchObject({ ok: false, code: 'insufficient_funds' });
    post(state, move('sys:a', 'b', 'ore', 1), SYS);
    expect(post(state, move('b', 'c', 'ore', 1, { opId: 'x' }), SYS)).toMatchObject({ ok: true, duplicate: false });
  });

  it('only the retained journal is searched: an opId trimmed out of the tail posts again', () => {
    const state = createLedgerState({ journalLimit: 1 });
    post(state, move('sys:a', 'b', 'ore', 1, { opId: 'once' }), SYS);
    post(state, move('sys:a', 'b', 'ore', 1), SYS);
    const res = post(state, move('sys:a', 'b', 'ore', 1, { opId: 'once' }), SYS);
    expect(res).toMatchObject({ ok: true, duplicate: false, entry: { seq: 3 } });
    expect(state.balances.b.ore).toBe(3);
  });
});
