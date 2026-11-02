import { describe, expect, it } from 'vitest';
import { createLedgerState, post, verifyLedger, type LedgerState, type VerifyResult } from '../src';
import { SYS, move } from './helpers';

/** Five entries over three accounts, journal tail of 3 (so `opening` is non-empty). */
function healthy(): LedgerState {
  const state = createLedgerState({ journalLimit: 3 });
  post(state, move('sys:mine', 'a', 'ore', 10), SYS);
  post(state, move('a', 'b', 'ore', 4), SYS);
  post(state, move('sys:well', 'b', 'water', 3), SYS);
  post(state, move('b', 'c', 'ore', 1), SYS);
  post(state, move('b', 'a', 'water', 2), SYS);
  return state;
}

function problemsOf(res: VerifyResult): string[] {
  expect(res.ok).toBe(false);
  return res.ok ? [] : res.problems;
}

const has = (problems: string[], text: string) => expect(problems.some((p) => p.includes(text))).toBe(true);

describe('verifyLedger: healthy ledgers', () => {
  it('passes for a fresh ledger', () => expect(verifyLedger(createLedgerState())).toEqual({ ok: true }));

  it('passes with a trimmed journal and a non-empty opening', () => {
    const state = healthy();
    expect(state.opening).not.toEqual({});
    expect(verifyLedger(state)).toEqual({ ok: true });
  });

  it('passes when the whole journal was folded into opening', () => {
    const state = healthy();
    state.opening = structuredClone(state.balances);
    state.journal = [];
    expect(verifyLedger(state)).toEqual({ ok: true });
  });
});

describe('verifyLedger: tampering', () => {
  it('detects a seq gap inside the journal', () => {
    const state = healthy();
    state.journal[1].seq = 9;
    const problems = problemsOf(verifyLedger(state));
    has(problems, 'seq gap before entry 9');
  });

  it('detects a last-seq mismatch', () => {
    const state = healthy();
    state.seq = 7;
    expect(problemsOf(verifyLedger(state))).toEqual(['last entry seq 5 != ledger seq 7']);
  });

  it('cannot check seq when the journal is empty (nothing to compare against)', () => {
    const state = createLedgerState();
    state.seq = 4;
    expect(verifyLedger(state)).toEqual({ ok: true });
  });

  it('detects an unbalanced entry', () => {
    const state = healthy();
    state.journal[0].legs[0].delta = -5;
    has(problemsOf(verifyLedger(state)), `entry ${state.journal[0].seq} is unbalanced in`);
  });

  it('detects a non-integer delta', () => {
    const state = healthy();
    state.journal[2].legs[1].delta = 1.5;
    const problems = problemsOf(verifyLedger(state));
    has(problems, 'entry 5 has non-integer delta 1.5');
    has(problems, 'entry 5 is unbalanced');
  });

  it('detects balance drift against opening + journal', () => {
    const state = healthy();
    state.balances.a.ore += 1;
    state.balances.c.ore -= 1;
    expect(problemsOf(verifyLedger(state))).toEqual(['balance a/ore is 7, journal says 6', 'balance c/ore is 0, journal says 1']);
  });

  it('detects accounts and assets present on only one side', () => {
    const state = healthy();
    state.balances.ghost = { ore: 1 };
    state.balances.a.gold = 2;
    delete state.balances.c;
    const problems = problemsOf(verifyLedger(state));
    has(problems, 'balance ghost/ore is 1, journal says 0');
    has(problems, 'balance a/gold is 2, journal says 0');
    has(problems, 'balance c/ore is 0, journal says 1');
  });

  it('detects a nonzero trial balance', () => {
    const state = healthy();
    state.balances.a.ore += 3;
    state.opening.a.ore += 3;
    expect(problemsOf(verifyLedger(state))).toEqual(['trial balance of ore is 3, not 0']);
  });

  it('detects a tampered opening', () => {
    const state = healthy();
    state.opening.b.ore += 1;
    has(problemsOf(verifyLedger(state)), 'balance b/ore is');
  });
});
