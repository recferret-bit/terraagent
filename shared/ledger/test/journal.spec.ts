import { describe, expect, it } from 'vitest';
import { createLedgerState, entries, post, trimJournal, verifyLedger } from '../src';
import { SYS, leg, move, posting } from './helpers';

describe('trimJournal', () => {
  it('keeps at most journalLimit entries and folds older ones into opening', () => {
    const state = createLedgerState({ journalLimit: 2 });
    post(state, move('sys:a', 'b', 'ore', 5), SYS);
    post(state, move('b', 'c', 'ore', 2), SYS);
    post(state, move('sys:a', 'b', 'water', 1), SYS);
    expect(state.journal.map((e) => e.seq)).toEqual([2, 3]);
    expect(state.opening).toEqual({ 'sys:a': { ore: -5 }, b: { ore: 5 } });
    post(state, move('b', 'c', 'ore', 3), SYS);
    expect(state.journal.map((e) => e.seq)).toEqual([3, 4]);
    expect(state.opening).toEqual({ 'sys:a': { ore: -5 }, b: { ore: 3 }, c: { ore: 2 } });
    expect(verifyLedger(state)).toEqual({ ok: true });
  });

  it('keeps everything with journalLimit 0', () => {
    const state = createLedgerState({ journalLimit: 0 });
    for (let i = 0; i < 300; i++) post(state, move('sys:a', 'b', 'ore', 1), SYS);
    expect(state.journal).toHaveLength(300);
    expect(state.opening).toEqual({});
  });

  it('is a no-op while the journal fits, and trims many at once when the limit is lowered', () => {
    const state = createLedgerState({ journalLimit: 10 });
    for (let i = 0; i < 4; i++) post(state, move('sys:a', 'b', 'ore', 1), SYS);
    const before = structuredClone(state);
    trimJournal(state);
    expect(state).toEqual(before);
    state.journalLimit = 1;
    trimJournal(state);
    expect(state.journal.map((e) => e.seq)).toEqual([4]);
    expect(state.opening).toEqual({ 'sys:a': { ore: -3 }, b: { ore: 3 } });
    expect(verifyLedger(state)).toEqual({ ok: true });
  });

  it('a negative journalLimit on a hand-built state also means unlimited', () => {
    const state = createLedgerState();
    state.journalLimit = -1;
    post(state, move('sys:a', 'b', 'ore', 1), SYS);
    post(state, move('sys:a', 'b', 'ore', 1), SYS);
    expect(state.journal).toHaveLength(2);
  });
});

describe('entries', () => {
  const state = createLedgerState({ journalLimit: 0 });
  post(state, move('sys:mine', 'colony:0', 'ore', 5, { reason: 'mine', actor: 'system:mine', ref: 'tile:1' }), SYS);
  post(state, move('sys:well', 'colony:1', 'water', 2, { reason: 'pump', actor: 'system:pump' }), SYS);
  post(state, move('colony:0', 'sys:build', 'ore', 3, { reason: 'build', actor: 'colony:0', ref: 'order:7' }), SYS);
  post(
    state,
    posting([leg('colony:1', 'water', -1), leg('colony:0', 'water', 1), leg('colony:0', 'ore', -1), leg('colony:1', 'ore', 1)], {
      reason: 'trade',
      actor: 'player:p1',
    }),
    SYS,
  );
  const seqs = (f: Parameters<typeof entries>[1]) => entries(state, f).map((e) => e.seq);

  it('returns every retained entry oldest first with no or an empty filter', () => {
    expect(entries(state).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(seqs({})).toEqual([1, 2, 3, 4]);
    expect(entries(state)).not.toBe(state.journal);
  });

  it('filters by metadata', () => {
    expect(seqs({ reason: 'build' })).toEqual([3]);
    expect(seqs({ actor: 'system:pump' })).toEqual([2]);
    expect(seqs({ ref: 'tile:1' })).toEqual([1]);
    expect(seqs({ sinceSeq: 2 })).toEqual([3, 4]);
    expect(seqs({ sinceSeq: 0 })).toEqual([1, 2, 3, 4]);
    expect(seqs({ reason: 'nope' })).toEqual([]);
  });

  it('filters by account, asset, or both on the same leg', () => {
    expect(seqs({ account: 'colony:0' })).toEqual([1, 3, 4]);
    expect(seqs({ asset: 'water' })).toEqual([2, 4]);
    expect(seqs({ account: 'colony:1', asset: 'ore' })).toEqual([4]);
    expect(seqs({ account: 'sys:well', asset: 'ore' })).toEqual([]);
    expect(seqs({ account: 'nobody' })).toEqual([]);
  });

  it('combines every condition', () => {
    expect(seqs({ account: 'colony:0', reason: 'build', sinceSeq: 1, actor: 'colony:0', ref: 'order:7', asset: 'ore' })).toEqual([3]);
    expect(seqs({ account: 'colony:0', reason: 'build', sinceSeq: 3 })).toEqual([]);
  });
});
