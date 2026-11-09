import { RESOURCE_KEYS } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  RESIDUAL_SCALE,
  SIM_VERSION,
  colonyResourcePosition,
  consumeResource,
  creditResource,
  debitCost,
  decodeValue,
  encodeValue,
  ensureColonyLedger,
  payProgressiveSlice,
  refundCost,
  resourceValue,
  restore,
  snapshot,
  splitLegacyAmount,
  withLedgerSink,
  type ColonyWithLedger,
  type LedgerPosting,
  type StepContext,
} from '../../src';
import { ensureColonyRecord } from '../../src/kernel/colonies';
import { colonyPlanet, hostLedger, postAll } from './helpers';

/** A step ctx that collects postings, enough for the ledger helpers. */
function ctxAt(tick: number): StepContext & { postings: LedgerPosting[] } {
  const postings: LedgerPosting[] = [];
  return { tick, dt: 1, postings, record: (p: LedgerPosting) => void postings.push(p), events: [], emit: () => {} } as unknown as StepContext & { postings: LedgerPosting[] };
}

const isWhole = (v: number): boolean => Number.isInteger(v) && v >= 0;

describe('LED-16 residual accumulator: credit, debit, refund', () => {
  it('credits fractions as whole units plus a micro-unit residual, with no float dust', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    for (let i = 0; i < 3; i++) creditResource(col, 'metals.t1', 0.1, i); // 0.1 + 0.1 + 0.1 is 0.30000000000000004 in floats
    expect(col.stock['metals.t1']).toBe(0);
    expect(col.residual['metals.t1']).toBe(300_000);
    for (let i = 3; i < 25; i++) creditResource(col, 'metals.t1', 0.1, i);
    expect(col.stock['metals.t1']).toBe(2);
    expect(col.residual['metals.t1']).toBe(500_000);
    expect(col.production.produced['metals.t1']).toBe(2);
    expect(resourceValue(col, 'metals.t1')).toBe(2.5);
  });

  it('refunds 50 % of a cost exactly: 37.5 is 37 whole units and a 0.5 residual; the two halves make 38', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    refundCost(col, { 'minerals.t1': 75 }, 0.5, 1);
    expect(col.stock['minerals.t1']).toBe(37);
    expect(col.residual['minerals.t1']).toBe(500_000);
    refundCost(col, { 'minerals.t1': 75 }, 0.5, 2);
    expect(col.stock['minerals.t1']).toBe(75);
    expect(col.residual['minerals.t1']).toBe(0);
    expect(col.production.produced['minerals.t1']).toBe(0); // refunds are not production
  });

  it('keeps refund clamping (LED-17): whole units over the cap are counted in production.capped, the fraction stays', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    creditResource(col, 'metals.t1', 498, 0);
    const res = creditResource(col, 'metals.t1', 4.5, 1);
    expect(res.capped).toBe(2);
    expect(col.stock['metals.t1']).toBe(500);
    expect(col.production.capped.metals).toBe(2);
    expect(col.residual['metals.t1']).toBe(500_000);
  });

  it('pays progressive slices in micro-units that add up to exactly the total, debiting whole units from stock', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    creditResource(col, 'metals.t1', 100, 0);
    const spent: Record<string, number> = {};
    const total = { 'metals.t1': 65 };
    for (let i = 1; i <= 7; i++) expect(payProgressiveSlice(col, total, spent, i / 7, i).ok).toBe(true);
    expect(spent['metals.t1']).toBe(65);
    expect(col.stock['metals.t1']).toBe(35);
    expect(col.residual['metals.t1']).toBe(0);
    for (const k of RESOURCE_KEYS) expect(isWhole(col.stock[k])).toBe(true);
  });

  it('debits an instant cost from stock plus residual, and refuses what the exact value does not cover', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    creditResource(col, 'metals.t1', 10.25, 0);
    expect(debitCost(col, { 'metals.t1': 10.5 }, 1)).toBe(false);
    expect(debitCost(col, { 'metals.t1': 9.5 }, 1)).toBe(true);
    expect(col.stock['metals.t1']).toBe(0);
    expect(col.residual['metals.t1']).toBe(750_000);
  });

  it('consumes a rate-based input (fuel) from the exact value', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    creditResource(col, 'bio.biomass', 1, 0);
    for (let i = 0; i < 2; i++) expect(consumeResource(col, 'bio.biomass', 0.375, i)).toBe(0.375);
    expect(resourceValue(col, 'bio.biomass')).toBe(0.25);
    expect(consumeResource(col, 'bio.biomass', 0.375, 3)).toBe(0.25); // takes what is left, never below empty
    expect(resourceValue(col, 'bio.biomass')).toBe(0);
    expect(col.stock['bio.biomass']).toBe(0);
    expect(col.residual['bio.biomass']).toBe(0);
  });
});

describe('LED-16 the journal explains col.stock', () => {
  it('inside a step ctx every whole-unit change is posted: ledger balance equals col.stock after a mixed run', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    const ctx = ctxAt(5);
    withLedgerSink(state, ctx, () => {
      creditResource(col, 'metals.t1', 300, 5, { reason: 'terraform.yield' });
      for (let i = 0; i < 53; i++) creditResource(col, 'metals.t1', 0.7, 5);
      refundCost(col, { 'metals.t1': 75 }, 0.5, 5);
      debitCost(col, { 'metals.t1': 40.5 }, 5);
      consumeResource(col, 'metals.t1', 3.3, 5);
      creditResource(col, 'metals.t1', 1000, 5); // overflow to sys:overflow
    });
    const ledger = hostLedger();
    postAll(ledger, ctx.postings);
    const bal = ledger.balances('colony:0');
    expect(bal['metals.t1'] ?? 0).toBe(col.stock['metals.t1']);
    expect(col.stock['metals.t1']).toBe(500);
    expect(ctx.postings.some((p) => p.reason === 'production.tick')).toBe(true);
    expect(ctx.postings.every((p) => p.legs.every((l) => Number.isInteger(l.delta)))).toBe(true);
  });

  it('outside a step it still changes col.stock (whole units) and records nothing', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(state.colonies[0]!);
    creditResource(col, 'bio.water', 2.75, 0);
    expect(col.stock['bio.water']).toBe(2);
    expect(col.residual['bio.water']).toBe(750_000);
  });
});

describe('LED-16 snapshot migration (SIM_VERSION 2 -> 3)', () => {
  function asV2(state: ReturnType<typeof colonyPlanet>, patch: (col: Record<string, unknown>) => void): Uint8Array {
    const decoded = decodeValue(snapshot(state)) as { header: { simVersion: number }; state: { colonies: Record<string, unknown>[] } };
    decoded.header.simVersion = 2;
    for (const c of decoded.state.colonies) { delete c.residual; patch(c); }
    return encodeValue(decoded);
  }

  it('an old save with stock 12.75 restores as stock 12 and residual 0.75, value preserved', () => {
    const state = colonyPlanet();
    ensureColonyLedger(state.colonies[0]!);
    const bytes = asV2(state, (c) => {
      (c.stock as Record<string, number>)['metals.t1'] = 12.75;
      (c.stock as Record<string, number>)['bio.water'] = 0.30000000000000004;
      (c.production as { produced: Record<string, number> }).produced['minerals.t1'] = 515.0000000000043;
    });
    const back = restore(bytes);
    const col = back.colonies[0] as ColonyWithLedger;
    expect(back.meta.simVersion).toBe(SIM_VERSION);
    expect(col.stock['metals.t1']).toBe(12);
    expect(col.residual['metals.t1']).toBe(750_000);
    expect(col.stock['bio.water']).toBe(0);
    expect(col.residual['bio.water']).toBe(300_000);
    expect(col.production.produced['minerals.t1']).toBe(515);
    expect(resourceValue(col, 'metals.t1')).toBe(12.75);
    expect(splitLegacyAmount(12.75)).toEqual({ stock: 12, residual: 750_000 });
    expect(JSON.stringify(restore(snapshot(back)).colonies[0])).toBe(JSON.stringify(col)); // a v3 save round-trips as is
  });
});

describe('LED-16 one resource position', () => {
  it('counts stock, orbit, in-flight cargo and the residual once; reserved orbit stays a subset', () => {
    const state = colonyPlanet();
    const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
    creditResource(col, 'metals.t1', 10.5, 0);
    col.cargo = {
      inOrbit: { 'metals.t1': 7 },
      pendingMint: { a: { resource: 'metals.t1', amount: 3 }, b: { resource: 'bio.water', amount: 99 } },
      pendingImport: { c: { resource: 'metals.t1', amount: 2, debitedInOrbit: true }, d: { resource: 'metals.t1', amount: 50 } },
    };
    col.market = { reservedInOrbit: { 'metals.t1': 4 } };
    const p = colonyResourcePosition(col, 'metals.t1');
    expect(p).toMatchObject({ stock: 10, residualMicro: 500_000, inOrbit: 7, inFlight: 5, reservedInOrbit: 4 });
    expect(p.totalMicro).toBe((10 + 7 + 5) * RESIDUAL_SCALE + 500_000);
  });
});
