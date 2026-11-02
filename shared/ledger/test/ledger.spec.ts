import { describe, expect, it } from 'vitest';
import { DEFAULT_JOURNAL_LIMIT, Ledger, createLedgerState, transferLegs, type TransferMeta } from '../src';
import { SYS, move } from './helpers';

const META: TransferMeta<string> = { at: 3, reason: 'construction.spend', actor: 'colony:0', ref: 'order:9' };

describe('transferLegs', () => {
  it('builds one debit and one credit per asset in sorted asset order', () => {
    expect(transferLegs('a', 'b', { water: 2, ore: 5 })).toEqual([
      { account: 'a', asset: 'ore', delta: -5 },
      { account: 'b', asset: 'ore', delta: 5 },
      { account: 'a', asset: 'water', delta: -2 },
      { account: 'b', asset: 'water', delta: 2 },
    ]);
  });

  it('skips zero amounts and returns [] for nothing to move', () => {
    expect(transferLegs('a', 'b', { ore: 0, water: 1 })).toEqual([
      { account: 'a', asset: 'water', delta: -1 },
      { account: 'b', asset: 'water', delta: 1 },
    ]);
    expect(transferLegs('a', 'b', {})).toEqual([]);
    expect(transferLegs('a', 'b', { ore: 0 })).toEqual([]);
  });

  it('returns null for negative, fractional or non-finite amounts', () => {
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(transferLegs('a', 'b', { ore: 1, water: bad })).toBeNull();
    }
  });
});

describe('Ledger', () => {
  it('defaults to a fresh state with the default journal limit and a no-negative policy', () => {
    const ledger = new Ledger();
    expect(ledger.state).toEqual(createLedgerState());
    expect(ledger.state.journalLimit).toBe(DEFAULT_JOURNAL_LIMIT);
    expect(ledger.post(move('sys:mine', 'a', 'ore', 1))).toMatchObject({ ok: false, code: 'insufficient_funds' });
  });

  it('wraps a given state in place and applies its policy', () => {
    const state = createLedgerState<'mine' | 'spend'>({ journalLimit: 0 });
    const ledger = new Ledger(state, SYS);
    expect(ledger.state).toBe(state);
    const res = ledger.post({ at: 1, reason: 'mine', actor: 'system:mine', legs: move('sys:mine', 'a', 'ore', 4).legs });
    expect(res).toMatchObject({ ok: true, entry: { seq: 1, reason: 'mine' } });
    expect(state.balances.a).toEqual({ ore: 4 });
  });

  it('transfer moves several assets as one entry', () => {
    const ledger = new Ledger(createLedgerState(), SYS);
    ledger.transfer('sys:mine', 'colony:0', { ore: 10, water: 5 }, { ...META, reason: 'seed' });
    const res = ledger.transfer('colony:0', 'sys:construction', { water: 2, ore: 3, gold: 0 }, META);
    expect(res).toMatchObject({ ok: true, duplicate: false, entry: { seq: 2, at: 3, ref: 'order:9', actor: 'colony:0' } });
    expect(res.ok && res.entry.legs.map((l) => l.asset)).toEqual(['ore', 'ore', 'water', 'water']);
    expect(ledger.balances('colony:0')).toEqual({ ore: 7, water: 3 });
  });

  it('transfer rejects bad amounts as invalid_amount and empty transfers as no_legs', () => {
    const ledger = new Ledger(createLedgerState(), SYS);
    expect(ledger.transfer('sys:a', 'b', { ore: 1.5 }, META)).toEqual({
      ok: false,
      code: 'invalid_amount',
      detail: 'amounts must be whole non-negative numbers',
    });
    expect(ledger.transfer('sys:a', 'b', { ore: -1 }, META)).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(ledger.transfer('sys:a', 'b', {}, META)).toMatchObject({ ok: false, code: 'no_legs' });
    expect(ledger.transfer('sys:a', 'b', { ore: 0 }, META)).toMatchObject({ ok: false, code: 'no_legs' });
    expect(ledger.state.seq).toBe(0);
  });

  it('transfer honours opId idempotency', () => {
    const ledger = new Ledger(createLedgerState(), SYS);
    const first = ledger.transfer('sys:a', 'b', { ore: 2 }, { ...META, opId: 'op' });
    const again = ledger.transfer('sys:a', 'b', { ore: 2 }, { ...META, opId: 'op' });
    expect(again).toEqual({ ok: true, duplicate: true, entry: first.ok ? first.entry : null });
    expect(ledger.transfer('sys:a', 'b', { ore: 3 }, { ...META, opId: 'op' })).toMatchObject({ ok: false, code: 'op_conflict' });
    expect(ledger.balance('b', 'ore')).toBe(2);
  });

  it('query helpers delegate to the state', () => {
    const ledger = new Ledger(createLedgerState(), SYS);
    ledger.transfer('sys:mine', 'b', { ore: 5 }, META);
    ledger.transfer('b', 'a', { ore: 2 }, { ...META, reason: 'gift' });
    expect(ledger.balance('b', 'ore')).toBe(3);
    expect(ledger.balance('b', 'water')).toBe(0);
    expect(ledger.balances('a')).toEqual({ ore: 2 });
    expect(ledger.accounts()).toEqual(['a', 'b', 'sys:mine']);
    expect(ledger.entries().map((e) => e.seq)).toEqual([1, 2]);
    expect(ledger.entries({ reason: 'gift' }).map((e) => e.seq)).toEqual([2]);
    expect(ledger.trialBalance()).toEqual({});
    expect(ledger.verify()).toEqual({ ok: true });
  });

  it('covers checks every listed asset', () => {
    const ledger = new Ledger(createLedgerState(), SYS);
    ledger.transfer('sys:mine', 'a', { ore: 5, water: 1 }, META);
    expect(ledger.covers('a', { ore: 5, water: 1 })).toBe(true);
    expect(ledger.covers('a', { ore: 4 })).toBe(true);
    expect(ledger.covers('a', {})).toBe(true);
    expect(ledger.covers('a', { ore: 6 })).toBe(false);
    expect(ledger.covers('a', { ore: 1, gold: 1 })).toBe(false);
    expect(ledger.covers('nobody', { ore: 0 })).toBe(true);
  });

  it('verify reports tampering', () => {
    const ledger = new Ledger(createLedgerState(), SYS);
    ledger.transfer('sys:mine', 'a', { ore: 5 }, META);
    ledger.state.balances.a.ore = 6;
    expect(ledger.verify().ok).toBe(false);
  });
});
