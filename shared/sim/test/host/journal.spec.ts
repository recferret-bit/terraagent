import { describe, expect, it } from 'vitest';
import { HOST_JOURNAL_LIMIT, PlanetJournal, createPlanet, describeJournalProblem, setColonyStock, type LedgerPosting } from '../../src';

const cargo = (colony: number, n: number, at = 1): LedgerPosting => ({
  at, reason: 'landing.cargo', actor: 'system:landing',
  legs: [{ account: 'sys:cargo', asset: 'metals.t1', delta: -n }, { account: `colony:${colony}`, asset: 'metals.t1', delta: n }],
});
const spend = (colony: number, n: number, at = 2): LedgerPosting => ({
  at, reason: 'construction.spend', actor: `colony:${colony}`, ref: 'order:1',
  legs: [{ account: `colony:${colony}`, asset: 'metals.t1', delta: -n }, { account: 'sys:construction', asset: 'metals.t1', delta: n }],
});

describe('PlanetJournal (the one host journal: server, ?host=local worker, fallback host)', () => {
  it('records postings, reports refused ones as problems without throwing, and verifies', () => {
    const j = PlanetJournal.empty();
    expect(j.record([cargo(0, 600), spend(0, 200)])).toEqual([]);
    const problems = j.record([spend(0, 1000)]);
    expect(problems).toEqual([expect.objectContaining({ code: 'insufficient_funds', posting: spend(0, 1000) })]);
    expect(j.record([{ ...cargo(0, 1), legs: [] }])[0]).toMatchObject({ code: 'no_legs', detail: expect.any(String) });
    expect(j.balances('colony:0')).toEqual({ 'metals.t1': 400 });
    expect(j.seq).toBe(2);
    expect(j.verify()).toEqual({ ok: true });
    expect(j.accounts()).toEqual(['colony:0', 'sys:cargo', 'sys:construction']);
  });

  it('views an account: balances and its newest `limit` entries, oldest first (limit floors at 1)', () => {
    const j = PlanetJournal.empty();
    j.record([cargo(0, 600), cargo(1, 5), spend(0, 1), spend(0, 2, 3)]);
    const v = j.view('pl_x', 'colony:0', 2);
    expect(v).toMatchObject({ planetId: 'pl_x', account: 'colony:0', balances: { 'metals.t1': 597 } });
    expect(v.entries.map((e) => e.seq)).toEqual([3, 4]);
    expect(j.view('pl_x', 'colony:0', 0).entries.map((e) => e.seq)).toEqual([4]);
  });

  it('isTailShort: only when entries were trimmed and the retained tail cannot fill the limit', () => {
    const j = PlanetJournal.empty(2);
    j.record([cargo(0, 10), spend(0, 1)]);
    expect(j.isTailShort('colony:0', 5)).toBe(false); // nothing trimmed yet
    j.record([spend(0, 1, 3)]);
    expect(j.isTailShort('colony:0', 5)).toBe(true);
    expect(j.isTailShort('colony:0', 2)).toBe(false);
    expect(j.verify()).toEqual({ ok: true });
  });

  it('fromState continues a saved journal (a copy: the saved state is not mutated); toState copies too', () => {
    const j = PlanetJournal.empty();
    j.record([cargo(0, 600)]);
    const saved = j.toState();
    const resumed = PlanetJournal.fromState(saved);
    resumed.record([spend(0, 100)]);
    expect(saved.seq).toBe(1);
    expect(resumed.seq).toBe(2);
    expect(resumed.balances('colony:0')).toEqual({ 'metals.t1': 500 });
    expect(resumed.view('p', 'colony:0', 10).entries.map((e) => e.reason)).toEqual(['landing.cargo', 'construction.spend']);
    expect(HOST_JOURNAL_LIMIT).toBe(1024);
  });

  it('fromBalances opens from summed history (server restore): next seq follows, verify holds', () => {
    const j = PlanetJournal.fromBalances({ 'colony:0': { 'metals.t1': 400 }, 'sys:cargo': { 'metals.t1': -600 }, 'sys:construction': { 'metals.t1': 200 } }, 7);
    expect(j.seq).toBe(7);
    expect(j.verify()).toEqual({ ok: true });
    j.record([spend(0, 50)]);
    expect(j.view('p', 'colony:0', 5).entries).toEqual([expect.objectContaining({ seq: 8, reason: 'construction.spend' })]);
    expect(j.isTailShort('colony:0', 5)).toBe(true);
    expect(j.verify()).toEqual({ ok: true });
  });

  it('open: one ledger.opening entry per colony with stock (zero-stock colonies skipped), matching col.stock', () => {
    const state = createPlanet({ type: 'flat', seed: 'j', radius: 6 });
    setColonyStock(state, 0, { 'metals.t1': 600, 'bio.water': 20 });
    setColonyStock(state, 1, {});
    setColonyStock(state, 2, { 'minerals.t1': 3 });
    const j = PlanetJournal.open(state, 'system:resume');
    expect(j.reconcile(state)).toEqual([]);
    expect(j.view('p', 'colony:0', 9).entries).toEqual([
      expect.objectContaining({ reason: 'ledger.opening', actor: 'system:resume', at: state.meta.tick }),
    ]);
    expect(j.balances('sys:opening')).toEqual({ 'bio.water': -20, 'metals.t1': -600, 'minerals.t1': -3 });
    expect(j.seq).toBe(2);
  });

  it('reconcile finds both directions: state holds more, and a colony account the state does not have', () => {
    const j = PlanetJournal.empty();
    j.record([cargo(0, 10), cargo(3, 4)]);
    expect(j.reconcile([{ 'metals.t1': 12, 'bio.water': 0 }, {}])).toEqual([
      { account: 'colony:0', asset: 'metals.t1', ledger: 10, state: 12 },
      { account: 'colony:3', asset: 'metals.t1', ledger: 4, state: 0 },
    ]);
    expect(j.reconcile([{ 'metals.t1': 10 }, {}, {}, { 'metals.t1': 4 }])).toEqual([]);
  });

  it('openingPostings: what open() records, also usable from stocks alone (server genesis)', () => {
    const postings = PlanetJournal.openingPostings([{ 'metals.t1': 5, 'bio.water': 0 }, {}, { 'minerals.t1': 2 }], 9, 'system:genesis');
    expect(postings).toEqual([
      { at: 9, reason: 'ledger.opening', actor: 'system:genesis', legs: [{ account: 'sys:opening', asset: 'metals.t1', delta: -5 }, { account: 'colony:0', asset: 'metals.t1', delta: 5 }] },
      { at: 9, reason: 'ledger.opening', actor: 'system:genesis', legs: [{ account: 'sys:opening', asset: 'minerals.t1', delta: -2 }, { account: 'colony:2', asset: 'minerals.t1', delta: 2 }] },
    ]);
  });

  it('describeJournalProblem: one line with where it went negative, or the detail', () => {
    const j = PlanetJournal.empty();
    const [short] = j.record([spend(0, 3)]);
    expect(short).toMatchObject({ account: 'colony:0', asset: 'metals.t1', have: 0, need: 3 });
    expect(describeJournalProblem(short)).toBe('ledger rejected construction.spend by colony:0 at tick 2: insufficient_funds colony:0 metals.t1 have 0, need 3');
    const [empty] = j.record([{ ...cargo(0, 1), legs: [] }]);
    expect(describeJournalProblem(empty)).toMatch(/^ledger rejected landing\.cargo by system:landing at tick 1: no_legs \(.+\)$/);
    expect(describeJournalProblem({ posting: cargo(0, 1), code: 'x', account: 'a' })).toBe('ledger rejected landing.cargo by system:landing at tick 1: x a  have 0, need 0');
  });
});
