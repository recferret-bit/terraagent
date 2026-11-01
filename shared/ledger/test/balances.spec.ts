import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNAL_LIMIT,
  accountsOf,
  balanceOf,
  balancesOf,
  createLedgerState,
  post,
  readSheet,
  trialBalance,
  type BalanceSheet,
} from '../src';
import { addToSheet } from '../src/balances';
import { SYS, move } from './helpers';

describe('createLedgerState', () => {
  it('starts empty with the default journal limit', () => {
    expect(createLedgerState()).toEqual({ seq: 0, journalLimit: DEFAULT_JOURNAL_LIMIT, balances: {}, opening: {}, journal: [] });
    expect(DEFAULT_JOURNAL_LIMIT).toBe(256);
  });

  it('normalises journalLimit to a non-negative integer', () => {
    expect(createLedgerState({ journalLimit: 0 }).journalLimit).toBe(0);
    expect(createLedgerState({ journalLimit: 5 }).journalLimit).toBe(5);
    expect(createLedgerState({ journalLimit: 7.9 }).journalLimit).toBe(7);
    expect(createLedgerState({ journalLimit: -3 }).journalLimit).toBe(0);
    expect(createLedgerState({ journalLimit: undefined }).journalLimit).toBe(DEFAULT_JOURNAL_LIMIT);
  });

  it('treats a non-finite journalLimit as unlimited (0)', () => {
    expect(createLedgerState({ journalLimit: NaN }).journalLimit).toBe(0);
    expect(createLedgerState({ journalLimit: Infinity }).journalLimit).toBe(0);
  });

  it('returns a fresh object every call', () => {
    const a = createLedgerState();
    const b = createLedgerState();
    expect(a).not.toBe(b);
    expect(a.balances).not.toBe(b.balances);
  });
});

describe('readSheet / addToSheet', () => {
  it('reads 0 for missing accounts and assets', () => {
    const sheet: BalanceSheet = { a: { x: 3 } };
    expect(readSheet(sheet, 'a', 'x')).toBe(3);
    expect(readSheet(sheet, 'a', 'y')).toBe(0);
    expect(readSheet(sheet, 'b', 'x')).toBe(0);
  });

  it('ignores inherited Object.prototype keys', () => {
    const sheet: BalanceSheet = { a: { x: 3 } };
    expect(readSheet(sheet, 'constructor', 'x')).toBe(0);
    expect(readSheet(sheet, '__proto__', 'x')).toBe(0);
    expect(readSheet(sheet, 'a', 'toString')).toBe(0);
    expect(readSheet(sheet, 'a', 'constructor')).toBe(0);
  });

  it('adds deltas and drops cells and rows that return to zero', () => {
    const sheet: BalanceSheet = {};
    addToSheet(sheet, 'a', 'x', 5);
    addToSheet(sheet, 'a', 'y', -2);
    expect(sheet).toEqual({ a: { x: 5, y: -2 } });
    addToSheet(sheet, 'a', 'x', -5);
    expect(sheet).toEqual({ a: { y: -2 } });
    addToSheet(sheet, 'a', 'y', 2);
    expect(sheet).toEqual({});
    expect(Object.keys(sheet)).toEqual([]);
  });

  it('a zero delta on an empty cell leaves the sheet canonical', () => {
    const sheet: BalanceSheet = {};
    addToSheet(sheet, 'a', 'x', 0);
    expect(sheet).toEqual({});
  });

  it('treats inherited keys as absent when writing', () => {
    const sheet: BalanceSheet = {};
    addToSheet(sheet, 'constructor', 'toString', 4);
    expect(Object.hasOwn(sheet, 'constructor')).toBe(true);
    expect(readSheet(sheet, 'constructor', 'toString')).toBe(4);
    addToSheet(sheet, 'constructor', 'toString', -4);
    expect(sheet).toEqual({});
  });
});

describe('balance queries', () => {
  const state = createLedgerState();
  post(state, move('sys:mine', 'colony:0', 'ore', 7), SYS);
  post(state, move('sys:well', 'colony:0', 'water', 2), SYS);
  post(state, move('colony:0', 'colony:1', 'ore', 3), SYS);

  it('balanceOf reads one cell', () => {
    expect(balanceOf(state, 'colony:0', 'ore')).toBe(4);
    expect(balanceOf(state, 'colony:1', 'ore')).toBe(3);
    expect(balanceOf(state, 'sys:mine', 'ore')).toBe(-7);
    expect(balanceOf(state, 'colony:1', 'water')).toBe(0);
    expect(balanceOf(state, 'nobody', 'ore')).toBe(0);
  });

  it('balancesOf returns a detached copy', () => {
    const row = balancesOf(state, 'colony:0');
    expect(row).toEqual({ ore: 4, water: 2 });
    row.ore = 999;
    expect(balanceOf(state, 'colony:0', 'ore')).toBe(4);
    expect(balancesOf(state, 'nobody')).toEqual({});
    expect(balancesOf(state, 'constructor')).toEqual({});
  });

  it('accountsOf lists non-zero accounts sorted', () => {
    expect(accountsOf(state)).toEqual(['colony:0', 'colony:1', 'sys:mine', 'sys:well']);
  });

  it('trialBalance is empty for a healthy ledger', () => {
    expect(trialBalance(state)).toEqual({});
  });

  it('trialBalance reports per-asset drift and drops assets that cancel', () => {
    const broken = createLedgerState();
    broken.balances = { a: { x: 5, y: 1 }, b: { x: -5, y: 2 }, c: { z: -1 } };
    expect(trialBalance(broken)).toEqual({ y: 3, z: -1 });
  });
});
