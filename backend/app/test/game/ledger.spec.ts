import 'reflect-metadata';
import { HOST_JOURNAL_LIMIT } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from '../../src/game/ledger/in-memory-ledger-store';
import { OPENING_ACCOUNT, OPENING_REASON } from '../../src/game/ledger/ledger-book';
import { FRESH, UNCHECKED, credit, debit, row, setupLedgerService as setup } from './fixtures/ledger-service';

describe('PlanetLedgerService: posting flow', () => {
  it('keys rows by (tick, index in step), posts them in memory and persists them', async () => {
    const { svc, planets, store, errors } = setup();
    planets.loaded!('pl_a', 0, FRESH);
    planets.step('pl_a', 1, [credit(0, 'metals.t1', 600), credit(0, 'bio.water', 200)]);
    planets.step('pl_a', 2, [debit(0, 'metals.t1', 50)]);
    await svc.settled('pl_a');
    expect(store.all('pl_a').map((r) => [r.tick, r.idx, r.reason])).toEqual([
      [1, 0, 'landing.cargo'], [1, 1, 'landing.cargo'], [2, 0, 'construction.spend'],
    ]);
    expect(store.all('pl_a')[2]!.ref).toBe('order:1');
    const journal = svc.journalOf('pl_a')!;
    expect(journal.balances('colony:0')).toEqual({ 'metals.t1': 550, 'bio.water': 200 });
    expect(journal.balances('sys:landing')['metals.t1']).toBe(-600);
    expect(journal.verify()).toEqual({ ok: true });
    expect(errors()).toEqual([]);
  });

  it('logs a rejected posting as drift (planet, tick, reason), never throws, and still persists the row', async () => {
    const { svc, planets, store, errors } = setup();
    planets.loaded!('pl_d', 0, FRESH);
    planets.step('pl_d', 7, [debit(0, 'metals.t1', 5)]);
    await svc.settled('pl_d');
    const [err] = errors();
    expect(err).toMatchObject({ planetId: 'pl_d', tick: 7, reason: 'construction.spend', code: 'insufficient_funds', legs: debit(0, 'metals.t1', 5).legs });
    expect(store.all('pl_d')).toHaveLength(1);
    expect(svc.journalOf('pl_d')!.balances('colony:0')).toEqual({});
  });

  it('drops the in-memory ledger on unload but keeps writing rows that arrive afterwards', async () => {
    const { svc, planets, store } = setup();
    planets.loaded!('pl_u', 0, FRESH);
    planets.step('pl_u', 1, [credit(0, 'metals.t1', 1)]);
    planets.unloaded!('pl_u');
    planets.step('pl_u', 2, [credit(0, 'metals.t1', 1)]);
    await svc.settled('pl_u');
    expect(svc.journalOf('pl_u')).toBeNull();
    expect(store.all('pl_u')).toHaveLength(2);
  });
});

const history = () => [
  row(1, 0, credit(0, 'metals.t1', 600)), row(1, 1, credit(1, 'metals.t1', 600)),
  row(3, 0, debit(0, 'metals.t1', 100)), row(5, 0, debit(0, 'metals.t1', 200)), row(6, 0, credit(1, 'bio.water', 9)),
];

describe('PlanetLedgerService: restore consistency', () => {
  it('deletes rows after the snapshot tick, opens from the sums of the rest and finds no mismatch when they explain col.stock', async () => {
    const { svc, planets, store, errors } = setup();
    await store.append('pl_r', history());
    planets.loaded!('pl_r', 4, { restored: true, genesis: false, stocks: [{ 'metals.t1': 500, 'bio.water': 0 }, { 'metals.t1': 600 }] });
    await svc.settled('pl_r');
    expect(store.all('pl_r').map((r) => r.tick)).toEqual([1, 1, 3]);
    const journal = svc.journalOf('pl_r')!;
    expect(journal.balances('colony:0')).toEqual({ 'metals.t1': 500 });
    expect(journal.seq).toBe(3);
    expect(journal.verify()).toEqual({ ok: true });
    expect(errors()).toEqual([]);
    // the thread resumes at tick 5: new rows land after the restored ones, numbered on
    planets.step('pl_r', 5, [debit(1, 'metals.t1', 10)]);
    await svc.settled('pl_r');
    expect(store.all('pl_r').map((r) => [r.tick, r.idx])).toEqual([[1, 0], [1, 1], [3, 0], [5, 0]]);
    expect(journal.balances('colony:1')['metals.t1']).toBe(590);
    // the tail is short after a restore: the DB fills it, numbered like the in-memory seq (4)
    expect((await svc.view('pl_r', 'colony:1', 5))!.entries.map((e) => e.seq)).toEqual([2, 4]);
  });

  it('logs every colony balance the journal does not explain (both ways)', async () => {
    const { svc, planets, store, errors } = setup();
    await store.append('pl_m', history());
    planets.loaded!('pl_m', 4, { restored: true, genesis: false, stocks: [{ 'metals.t1': 499, 'bio.water': 3 }] });
    await svc.settled('pl_m');
    const [err] = errors();
    expect(err).toMatchObject({ planetId: 'pl_m', tick: 4, count: 3 });
    expect(err!.mismatches).toEqual([
      { account: 'colony:0', asset: 'bio.water', ledger: 0, state: 3 },
      { account: 'colony:0', asset: 'metals.t1', ledger: 500, state: 499 },
      { account: 'colony:1', asset: 'metals.t1', ledger: 600, state: 0 },
    ]);
  });

  it('a genesis snapshot (scenario) opens the journal with the seeded stock', async () => {
    const { svc, planets, store, errors } = setup();
    await store.append('pl_g', history());
    planets.loaded!('pl_g', 12, { restored: true, genesis: true, stocks: [{ 'metals.t1': 40, 'bio.water': 0 }, {}, { 'minerals.t1': 2 }] });
    await svc.settled('pl_g');
    expect(store.all('pl_g').map((r) => [r.tick, r.idx, r.reason])).toEqual([[12, 0, OPENING_REASON], [12, 1, OPENING_REASON]]);
    const journal = svc.journalOf('pl_g')!;
    expect(journal.balances('colony:0')).toEqual({ 'metals.t1': 40 });
    expect(journal.balances('colony:2')).toEqual({ 'minerals.t1': 2 });
    expect(journal.balances(OPENING_ACCOUNT)['metals.t1']).toBe(-40);
    expect(errors()).toEqual([]);
  });

  it('a genesis with setup postings (scenario) starts the journal with them at their own ticks, and reconciles', async () => {
    const { svc, planets, store, errors } = setup();
    await store.append('pl_gs', history());
    const cargo = { ...credit(0, 'metals.t1', 600), at: 1 };
    const water = { ...credit(0, 'bio.water', 200), at: 1 };
    const spend = { ...debit(0, 'metals.t1', 5), at: 3 };
    planets.loaded!('pl_gs', 3, { restored: true, genesis: true, stocks: [{ 'metals.t1': 595, 'bio.water': 200 }], setupPostings: [cargo, water, spend] });
    await svc.settled('pl_gs');
    expect(store.all('pl_gs').map((r) => [r.tick, r.idx, r.reason])).toEqual([[1, 0, 'landing.cargo'], [1, 1, 'landing.cargo'], [3, 0, 'construction.spend']]);
    expect(svc.journalOf('pl_gs')!.balances('colony:0')).toEqual({ 'metals.t1': 595, 'bio.water': 200 });
    expect(errors()).toEqual([]);
  });

  it('a genesis whose setup postings do not explain the seeded stock logs the mismatch', async () => {
    const { svc, planets, errors } = setup();
    planets.loaded!('pl_gm', 1, { restored: true, genesis: true, stocks: [{ 'metals.t1': 7 }], setupPostings: [] });
    await svc.settled('pl_gm');
    expect(errors()).toHaveLength(1);
  });

  it('postings that arrive while the restore is still reading the database are applied after it', async () => {
    const store = new InMemoryLedgerStore();
    await store.append('pl_s', history());
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sums = store.balancesThrough.bind(store);
    store.balancesThrough = async (...args) => { await gate; return sums(...args); };
    const { svc, planets, errors } = setup(store);
    planets.loaded!('pl_s', 4, { restored: true, genesis: false, stocks: [{ 'metals.t1': 500 }, { 'metals.t1': 600 }] });
    planets.step('pl_s', 5, [debit(0, 'metals.t1', 500)]); // only valid after the restore
    release();
    await svc.settled('pl_s');
    expect(errors()).toEqual([]);
    expect(svc.journalOf('pl_s')!.balances('colony:0')).toEqual({});
    expect(store.all('pl_s').map((r) => r.tick)).toEqual([1, 1, 3, 5]);
  });
});

describe('PlanetLedgerService: fresh loads', () => {
  it('a fresh planet the loader checked has no snapshots clears the rows of an older planet with the same id', async () => {
    const { svc, planets, store, errors } = setup();
    await store.append('pl_n', history());
    planets.loaded!('pl_n', 0, FRESH);
    await svc.settled('pl_n');
    expect(store.all('pl_n')).toEqual([]);
    expect(svc.journalOf('pl_n')!.accounts()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it('a fresh load nobody checked for snapshots keeps the stored rows and logs it (never wipe a journal that may have snapshots)', async () => {
    const { svc, planets, store, errors } = setup();
    await store.append('pl_k', history());
    planets.loaded!('pl_k', 0, UNCHECKED);
    await svc.settled('pl_k');
    expect(store.all('pl_k')).toHaveLength(history().length);
    expect(errors()).toMatchObject([{ planetId: 'pl_k', msg: expect.stringContaining('without the no-snapshot check') as unknown }]);
    expect(svc.journalOf('pl_k')!.accounts()).toEqual([]);
  });
});

describe('PlanetLedgerService.view (dev endpoint)', () => {
  it('returns balances and the newest entries of an account, newest last', async () => {
    const { svc, planets } = setup();
    planets.loaded!('pl_v', 0, FRESH);
    for (let t = 1; t <= 5; t++) planets.step('pl_v', t, [credit(0, 'metals.t1', t), credit(1, 'bio.water', 1)]);
    await svc.settled('pl_v');
    const v = await svc.view('pl_v', 'colony:0', 3);
    expect(v).toMatchObject({ planetId: 'pl_v', account: 'colony:0', balances: { 'metals.t1': 15 } });
    expect(v!.entries.map((e) => [e.at, e.seq, e.legs[1]!.delta])).toEqual([[3, 5, 3], [4, 7, 4], [5, 9, 5]]);
    expect(await svc.view('pl_none', 'colony:0', 3)).toBeNull();
  });

  it('reads older entries from the store once the in-memory tail was trimmed', async () => {
    const { svc, planets } = setup();
    planets.loaded!('pl_t', 0, FRESH);
    planets.step('pl_t', 1, [credit(0, 'metals.t1', 7)]);
    for (let t = 2; t <= HOST_JOURNAL_LIMIT + 10; t++) planets.step('pl_t', t, [credit(1, 'bio.water', 1)]);
    await svc.settled('pl_t');
    const v = await svc.view('pl_t', 'colony:0', 10);
    expect(v!.balances).toEqual({ 'metals.t1': 7 });
    expect(v!.entries).toEqual([{ seq: 1, at: 1, reason: 'landing.cargo', actor: 'system:landing', legs: credit(0, 'metals.t1', 7).legs }]);
  });
});
