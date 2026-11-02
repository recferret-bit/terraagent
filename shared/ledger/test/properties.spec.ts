import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceOf, post, trialBalance, verifyLedger, type BalanceSheet } from '../src';
import { addToSheet } from '../src/balances';
import { SYS } from './helpers';
import { ACCOUNTS, ASSETS, journalLimit, legSums, postings, run } from './arbitraries';

const RUNS = { numRuns: 300 };

describe('ledger properties under random posts', () => {
  it('accepted entries are balanced per asset and seq is gap-free', () => {
    fc.assert(
      fc.property(postings(true), journalLimit, (inputs, limit) => {
        const { results } = run(inputs, limit);
        let seq = 0;
        for (const res of results) {
          if (!res.ok) continue;
          expect(legSums(res.entry.legs)).toEqual({});
          if (!res.duplicate) expect(res.entry.seq).toBe(++seq);
        }
      }),
      RUNS,
    );
  });

  it('the trial balance is always empty and verifyLedger always passes (any journal limit)', () => {
    fc.assert(
      fc.property(postings(true), journalLimit, (inputs, limit) => {
        const { state } = run(inputs, limit);
        expect(trialBalance(state)).toEqual({});
        expect(verifyLedger(state)).toEqual({ ok: true });
        if (limit > 0) expect(state.journal.length).toBeLessThanOrEqual(limit);
      }),
      RUNS,
    );
  });

  it('accounts outside the negative policy never go below zero', () => {
    fc.assert(
      fc.property(postings(true), journalLimit, (inputs, limit) => {
        const { state } = run(inputs, limit);
        for (const account of ACCOUNTS.filter((a) => !SYS(a))) {
          for (const asset of ASSETS) expect(balanceOf(state, account, asset)).toBeGreaterThanOrEqual(0);
        }
      }),
      RUNS,
    );
  });

  it('a rejected or duplicate post leaves the state deep-equal to its clone', () => {
    fc.assert(
      fc.property(postings(true), journalLimit, (inputs, limit) => {
        const { state } = run([], limit);
        for (const input of inputs) {
          const before = structuredClone(state);
          const res = post(state, input, SYS);
          if (!res.ok || res.duplicate) expect(state).toEqual(before);
          else expect(state.seq).toBe(before.seq + 1);
        }
      }),
      RUNS,
    );
  });

  it('is deterministic: the same inputs give identical states and results', () => {
    fc.assert(
      fc.property(postings(true), journalLimit, (inputs, limit) => {
        const a = run(inputs, limit);
        const b = run(structuredClone(inputs), limit);
        expect(b.state).toEqual(a.state);
        expect(b.results).toEqual(a.results);
        expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
      }),
      RUNS,
    );
  });

  it('the journal limit changes only what is retained, never balances or results (without opIds)', () => {
    fc.assert(
      fc.property(postings(false), journalLimit, (inputs, limit) => {
        const full = run(inputs, 0);
        const tail = run(inputs, limit);
        expect(tail.state.balances).toEqual(full.state.balances);
        expect(tail.state.seq).toBe(full.state.seq);
        expect(tail.results).toEqual(full.results);
        expect(tail.state.journal).toEqual(limit === 0 ? full.state.journal : full.state.journal.slice(-limit));
      }),
      RUNS,
    );
  });

  it('an unlimited journal replays from nothing to the balances', () => {
    fc.assert(
      fc.property(postings(true), (inputs) => {
        const { state } = run(inputs, 0);
        const replay: BalanceSheet = {};
        for (const entry of state.journal) for (const l of entry.legs) addToSheet(replay, l.account, l.asset, l.delta);
        expect(replay).toEqual(state.balances);
        expect(state.opening).toEqual({});
      }),
      RUNS,
    );
  });
});
