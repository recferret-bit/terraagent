import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { GlobalTokenBudget, globalCap } from '../../src/ai/budget/global';

const DAY = '2026-11-04';
const NEXT = '2026-11-05';

function budget(): GlobalTokenBudget {
  return new GlobalTokenBudget(1000);
}

function granted(ledger: GlobalTokenBudget, day: string, tokens: number): void {
  expect(ledger.reserve(day, tokens)).toEqual({ ok: true });
}

function blocked(ledger: GlobalTokenBudget, day: string, tokens: number): void {
  expect(ledger.reserve(day, tokens)).toEqual({ ok: false, outcome: 'budget_exhausted' });
}

describe('W16-08 global token cap', () => {
  it('reads director.budget.globalTokensPerDay and uses it as the default cap', () => {
    const cap = dataRow(compileData(parseWaves('..16')), 'director', 'budget').globalTokensPerDay;
    expect(globalCap()).toBe(cap);
    const ledger = new GlobalTokenBudget();
    granted(ledger, DAY, cap as number);
    blocked(ledger, DAY, 1);
  });
});

describe('W16-08 outstanding reservations', () => {
  it('rejects a second reserve that would exceed the cap while the first is outstanding', () => {
    const ledger = budget();
    granted(ledger, DAY, 600);
    blocked(ledger, DAY, 500);
    granted(ledger, DAY, 400);
    blocked(ledger, DAY, 1);
  });

  it('keeps the reservation outstanding until reconcile', () => {
    const ledger = budget();
    granted(ledger, DAY, 600);
    blocked(ledger, DAY, 500);
    ledger.reconcile(DAY, 600, 0);
    granted(ledger, DAY, 1000);
    blocked(ledger, DAY, 1);
  });
});

describe('W16-08 unknown usage and refunds', () => {
  it('charges the full reservation when usage is unknown', () => {
    const ledger = budget();
    granted(ledger, DAY, 600);
    ledger.reconcile(DAY, 600, null);
    blocked(ledger, DAY, 500);
    granted(ledger, DAY, 400);
    blocked(ledger, DAY, 1);
  });

  it('refunds only the difference when actual is below the reservation', () => {
    const ledger = budget();
    granted(ledger, DAY, 800);
    ledger.reconcile(DAY, 800, 200);
    granted(ledger, DAY, 800);
    blocked(ledger, DAY, 1);
  });

  it('counts usage above the reservation so a later reserve cannot hide it', () => {
    const ledger = budget();
    granted(ledger, DAY, 100);
    ledger.reconcile(DAY, 100, 900);
    granted(ledger, DAY, 100);
    blocked(ledger, DAY, 1);
  });
});

describe('W16-08 reconcile retries', () => {
  it('does not lower a charge that was already reconciled', () => {
    const ledger = budget();
    granted(ledger, DAY, 700);
    ledger.reconcile(DAY, 700, 700);
    ledger.reconcile(DAY, 700, 100);
    granted(ledger, DAY, 300);
    blocked(ledger, DAY, 1);
  });

  it('does not lower an unknown-usage charge when a later actual is smaller', () => {
    const ledger = budget();
    granted(ledger, DAY, 700);
    ledger.reconcile(DAY, 700, null);
    ledger.reconcile(DAY, 700, 50);
    granted(ledger, DAY, 300);
    blocked(ledger, DAY, 1);
  });

  it('does not charge the same reservation twice', () => {
    const ledger = budget();
    granted(ledger, DAY, 400);
    ledger.reconcile(DAY, 400, 400);
    ledger.reconcile(DAY, 400, 400);
    granted(ledger, DAY, 600);
    blocked(ledger, DAY, 1);
  });
});

describe('W16-08 UTC rollover', () => {
  it('gives the next day its own counter and leaves the old day outstanding', () => {
    const ledger = budget();
    granted(ledger, DAY, 800);
    granted(ledger, NEXT, 800);
    blocked(ledger, DAY, 300);
    blocked(ledger, NEXT, 300);
    ledger.reconcile(DAY, 800, 0);
    granted(ledger, DAY, 1000);
    granted(ledger, NEXT, 200);
    blocked(ledger, NEXT, 1);
  });
});
