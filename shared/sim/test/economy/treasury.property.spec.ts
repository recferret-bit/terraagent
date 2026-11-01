import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { T1_RESOURCE_KEYS, parseWaves } from '@terra/contracts';
import { SimHost, createPlanet, getColonyStock, restore, snapshot, systemActor, treasury, type SimCommand } from '../../src';
import { ensureColonyRecord } from '../../src/kernel/colonies';
import { collector, emptyPlanet, hostLedger, nonZero, postAll } from './helpers';

const COLONIES = 3;

const directOp = fc.record({
  colony: fc.integer({ min: 0, max: COLONIES - 1 }),
  key: fc.constantFrom(...T1_RESOURCE_KEYS),
  amount: fc.integer({ min: 0, max: 400 }),
  kind: fc.constantFrom('add', 'addCapped', 'withdraw'),
});

const grantOp = fc.record({
  colony: fc.integer({ min: 0, max: COLONIES - 1 }),
  resource: fc.constantFrom(...T1_RESOURCE_KEYS),
  amount: fc.integer({ min: -500, max: 500 }),
});

function expectStocksMatch(ledger: ReturnType<typeof hostLedger>, stockOf: (c: number) => Record<string, number>): void {
  expect(ledger.verify().ok).toBe(true);
  expect(ledger.trialBalance()).toEqual({});
  for (let c = 0; c < COLONIES; c++) {
    const stock = stockOf(c);
    for (const v of Object.values(stock)) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
    expect(ledger.balances(`colony:${c}`)).toEqual(nonZero(stock));
  }
}

describe('treasury invariants (property)', () => {
  it('direct add/withdraw: postings rebuild col.stock exactly, never negative, all integers', () => {
    fc.assert(
      fc.property(fc.array(directOp, { maxLength: 120 }), (ops) => {
        const state = emptyPlanet();
        const ledger = hostLedger();
        const actor = systemActor('prop');
        ops.forEach((o, i) => {
          const ctx = collector(i + 1);
          const t = treasury(state, ctx);
          const amounts = { [o.key]: o.amount };
          const res =
            o.kind === 'withdraw'
              ? t.withdraw({ colony: o.colony, amounts, reason: 'trade', actor })
              : t.add({ colony: o.colony, amounts, reason: 'trade', actor, clampToCap: o.kind === 'addCapped' });
          expect(ctx.postings).toEqual(res.ok && res.posting ? [res.posting] : []);
          postAll(ledger, ctx.postings);
        });
        expectStocksMatch(ledger, (c) => getColonyStock(state, c));
      }),
      { numRuns: 150 },
    );
  });

  it('dev.grant command sequences through step(): StepResult.postings rebuild col.stock every tick', () => {
    const planet = createPlanet({ type: 'flat', seed: 'grant-prop', radius: 6 });
    ensureColonyRecord(planet, COLONIES - 1, 0); // dev.grant only grants to an existing colony
    const base = snapshot(planet);
    fc.assert(
      fc.property(fc.array(fc.array(grantOp, { maxLength: 4 }), { maxLength: 25 }), (steps) => {
        const host = new SimHost({ flags: parseWaves('..01') });
        host.load(restore(base));
        const ledger = hostLedger();
        let n = 0;
        for (const batch of steps) {
          for (const g of batch) {
            const c: SimCommand = { colonyIndex: g.colony, source: 'dev', commandId: `g${++n}`, kind: 'dev.grant', args: { resource: g.resource, amount: g.amount } };
            host.submit(c);
          }
          const res = host.step(1);
          expect(res.outcomes.every((o) => o.code === undefined)).toBe(true);
          for (const p of res.postings) expect(p).toMatchObject({ reason: 'dev.grant', actor: 'dev:console', at: res.stats.tick });
          postAll(ledger, res.postings);
          expectStocksMatch(ledger, (c) => getColonyStock(host.state, c));
        }
      }),
      { numRuns: 40 },
    );
  });
});
