import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLedgerStore } from '../../src/game/ledger/in-memory-ledger-store';
import type { LedgerRow } from '../../src/game/ledger/ledger-store.port';
import { RETRY_MAX_MS, SHUTDOWN_WAIT_MS, VIEW_WAIT_MS } from '../../src/game/ledger/planet-ledger.service';
import { FRESH, UNCHECKED, credit, row, setupLedgerService } from './fixtures/ledger-service';

/**
 * An in-memory store whose next `failures` appends throw (a database that is down, then recovers), and whose next
 * `restoreFailures` restore reads (`deleteAfter` / `deleteAll`) throw.
 */
class FlakyStore extends InMemoryLedgerStore {
  calls: number[][] = [];
  constructor(public failures: number, public restoreFailures = 0) { super(); }
  override async append(planetId: string, rows: readonly LedgerRow[]): Promise<number> {
    this.calls.push(rows.map((r) => r.tick));
    if (this.failures > 0) { this.failures--; throw new Error('db down'); }
    return super.append(planetId, rows);
  }
  override async deleteAfter(planetId: string, tick: number): Promise<number> {
    if (this.restoreFailures > 0) { this.restoreFailures--; throw new Error('db down'); }
    return super.deleteAfter(planetId, tick);
  }
  override async deleteAll(planetId: string): Promise<number> {
    if (this.restoreFailures > 0) { this.restoreFailures--; throw new Error('db down'); }
    return super.deleteAll(planetId);
  }
}

const retryLogs = (logs: Array<Record<string, unknown>>) => logs.filter((l) => l.retryInMs !== undefined);

describe('PlanetLedgerService: journal writes are never dropped', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('retries a failed batch with capped exponential backoff until the store recovers, keeping order', async () => {
    const store = new FlakyStore(12);
    const { svc, planets, logs } = setupLedgerService(store);
    planets.loaded!('pl_f', 0, FRESH);
    planets.step('pl_f', 1, [credit(0, 'metals.t1', 5)]);
    await vi.advanceTimersByTimeAsync(0);
    // later steps wait behind the failing batch (and join one queued batch)
    planets.step('pl_f', 2, [credit(0, 'metals.t1', 1)]);
    planets.step('pl_f', 3, [credit(0, 'metals.t1', 1)]);
    expect(svc.unwrittenRows('pl_f')).toBe(3);
    // the in-memory journal does not wait for the database
    expect(svc.journalOf('pl_f')!.balances('colony:0')).toEqual({ 'metals.t1': 7 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await svc.settled('pl_f');
    expect(retryLogs(logs).map((l) => l.retryInMs)).toEqual([100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    expect(retryLogs(logs).every((l) => l.level === 50 && l.planetId === 'pl_f' && l.fromTick === 1)).toBe(true);
    expect(store.calls.slice(-2)).toEqual([[1], [2, 3]]);
    expect(store.all('pl_f').map((r) => r.tick)).toEqual([1, 2, 3]);
    expect(svc.unwrittenRows('pl_f')).toBe(0);
    expect(logs.some((l) => l.attempt === 13 && l.level === 30)).toBe(true); // "recovered"
  });

  it('retries the opening rows of a genesis inside the restore job: ready before they are written, settled only after', async () => {
    const store = new FlakyStore(2);
    const { svc, planets } = setupLedgerService(store);
    planets.loaded!('pl_g', 4, { restored: true, genesis: true, stocks: [{ 'metals.t1': 40 }] });
    // a snapshot write waits for this before saving: it must not resolve before `landing.cargo` / opening rows are stored
    let settled = false;
    void svc.settled('pl_g').then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.journalOf('pl_g')!.balances('colony:0')).toEqual({ 'metals.t1': 40 });
    expect(svc.unwrittenRows('pl_g')).toBe(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(true);
    expect(store.all('pl_g').map((r) => [r.tick, r.reason])).toEqual([[4, 'ledger.opening']]);
    expect(svc.unwrittenRows('pl_g')).toBe(0);
  });

  it('shutdown waits a bounded time, then logs the unwritten rows per planet and stops retrying', async () => {
    const store = new FlakyStore(Number.POSITIVE_INFINITY);
    const { svc, planets, logs } = setupLedgerService(store);
    planets.loaded!('pl_x', 0, FRESH);
    planets.step('pl_x', 1, [credit(0, 'metals.t1', 5), credit(1, 'metals.t1', 5)]);
    let done = false;
    const shutdown = svc.beforeApplicationShutdown().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;
    expect(logs.find((l) => l.unwritten !== undefined)).toMatchObject({ level: 50, unwritten: { pl_x: 2 } });
    await svc.settled();
    const calls = store.calls.length;
    await vi.advanceTimersByTimeAsync(10 * RETRY_MAX_MS);
    expect(store.calls.length).toBe(calls);
  });

  it('shutdown returns at once when every row is written', async () => {
    const { svc, planets, logs } = setupLedgerService();
    planets.loaded!('pl_ok', 0, FRESH);
    planets.step('pl_ok', 1, [credit(0, 'metals.t1', 5)]);
    await svc.beforeApplicationShutdown();
    expect(logs.find((l) => l.unwritten !== undefined)).toBeUndefined();
  });
});

describe('PlanetLedgerService: a failed restore is retried before any write', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('retries a failed restore with the same backoff, holding later batches behind it: the stale rows go first', async () => {
    const store = new FlakyStore(0, 3);
    // a lost timeline: rows up to tick 6, the snapshot is at tick 4
    await store.append('pl_r', [row(1, 0, credit(0, 'metals.t1', 600)), row(5, 0, credit(0, 'bio.water', 1)), row(6, 0, credit(0, 'bio.water', 1))]);
    const { svc, planets, logs } = setupLedgerService(store);
    planets.loaded!('pl_r', 4, { restored: true, genesis: false, stocks: [{ 'metals.t1': 600 }] });
    planets.step('pl_r', 5, [credit(0, 'metals.t1', 7)]); // the new tick 5, same (tick, idx) as a stale row
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.journalOf('pl_r')).toBeNull();
    expect(store.all('pl_r').map((r) => r.tick)).toEqual([1, 5, 6]); // nothing written before the stale rows are gone
    await vi.advanceTimersByTimeAsync(10_000);
    await svc.settled('pl_r');
    expect(retryLogs(logs).map((l) => l.retryInMs)).toEqual([100, 200, 400]);
    expect(store.all('pl_r').map((r) => [r.tick, r.legs[1]!.asset])).toEqual([[1, 'metals.t1'], [5, 'metals.t1']]);
    expect(svc.journalOf('pl_r')!.balances('colony:0')).toEqual({ 'metals.t1': 607 });
    expect(logs.filter((l) => l.level === 50 && l.retryInMs === undefined)).toEqual([]);
    expect(svc.unwrittenRows('pl_r')).toBe(0);
  });

  it('the dev view answers LEDGER_UNAVAILABLE (503) while the restore is pending, and serves once it recovered', async () => {
    const store = new FlakyStore(0, 1000);
    const { svc, planets } = setupLedgerService(store);
    planets.loaded!('pl_p', 4, { restored: true, genesis: false, stocks: [] });
    const pending = svc.view('pl_p', 'colony:0', 5).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(VIEW_WAIT_MS);
    expect(await pending).toMatchObject({ errorCode: 'LEDGER_UNAVAILABLE', status: 503 });
    store.restoreFailures = 0;
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(await svc.view('pl_p', 'colony:0', 5)).toMatchObject({ planetId: 'pl_p', balances: {} });
  });

  it('a restore abandoned at shutdown leaves the journal unavailable and never writes the planet\'s later rows', async () => {
    const store = new FlakyStore(0, Number.POSITIVE_INFINITY);
    await store.append('pl_a', [row(9, 0, credit(0, 'metals.t1', 1))]);
    const { svc, planets, logs } = setupLedgerService(store);
    planets.loaded!('pl_a', 4, { restored: true, genesis: false, stocks: [] });
    planets.step('pl_a', 5, [credit(0, 'metals.t1', 1)]);
    const shutdown = svc.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_WAIT_MS);
    await shutdown;
    await svc.settled();
    expect(svc.isStopped()).toBe(true);
    expect(store.calls).toEqual([[9]]); // only the seeding append: the tick-5 batch was not written over the stale rows
    expect(svc.unwrittenRows('pl_a')).toBe(1);
    expect(logs.some((l) => l.level === 50 && String(l.msg).includes('abandoned'))).toBe(true);
    expect(await svc.view('pl_a', 'colony:0', 1).catch((e: unknown) => e)).toMatchObject({ errorCode: 'LEDGER_UNAVAILABLE' });
  });

  it('logs rows a write found already stored: warn after a retried write that had committed, error on a first attempt', async () => {
    /** The first append stores the rows, then fails (the commit landed, the answer did not). */
    class CommitThenFail extends FlakyStore {
      override async append(planetId: string, rows: readonly LedgerRow[]): Promise<number> {
        const n = await InMemoryLedgerStore.prototype.append.call(this, planetId, rows);
        if (this.failures-- > 0) throw new Error('connection reset');
        return n;
      }
    }
    const { svc, planets, logs } = setupLedgerService(new CommitThenFail(1));
    planets.loaded!('pl_w', 0, FRESH);
    planets.step('pl_w', 1, [credit(0, 'metals.t1', 5), credit(0, 'bio.water', 5)]);
    await vi.advanceTimersByTimeAsync(1000);
    await svc.settled('pl_w');
    expect(logs.filter((l) => l.skipped !== undefined)).toMatchObject([{ level: 40, planetId: 'pl_w', inserted: 0, skipped: 2, attempts: 2 }]);

    const stale = new InMemoryLedgerStore();
    await stale.append('pl_x', [row(1, 0, credit(0, 'metals.t1', 9))]);
    const b = setupLedgerService(stale);
    b.planets.loaded!('pl_x', 0, UNCHECKED);
    b.planets.step('pl_x', 1, [credit(0, 'metals.t1', 5)]);
    await b.svc.settled('pl_x');
    expect(b.logs.filter((l) => l.skipped !== undefined)).toMatchObject([{ level: 50, planetId: 'pl_x', inserted: 0, skipped: 1, attempts: 1 }]);
  });
});

describe('InMemoryLedgerStore: bounded per planet', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1, 0, credit(0, 'metals.t1', 1)));

  it('keeps the newest rows, numbers them after the dropped ones and still dedups the kept keys', async () => {
    const store = new InMemoryLedgerStore(3);
    expect(await store.append('pl_c', rows(5))).toBe(5);
    expect(store.all('pl_c').map((r) => r.tick)).toEqual([3, 4, 5]);
    expect((await store.recent('pl_c', { account: 'colony:0', limit: 9 })).map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(await store.append('pl_c', [row(5, 0, credit(0, 'metals.t1', 1))])).toBe(0);
    expect((await store.balancesThrough('pl_c', 4)).count).toBe(4);
    await store.deleteAll('pl_c');
    await store.append('pl_c', rows(1));
    expect((await store.recent('pl_c', { account: 'colony:0', limit: 9 })).map((r) => r.seq)).toEqual([1]);
  });

  it('balancesThrough sums the rows up to a tick per account and asset, zero sums omitted', async () => {
    const store = new InMemoryLedgerStore();
    await store.append('pl_b', [
      row(1, 0, credit(0, 'metals.t1', 600)), row(1, 1, credit(1, 'bio.water', 4)),
      { tick: 2, idx: 0, reason: 'x', actor: 'y', legs: [{ account: 'colony:1', asset: 'bio.water', delta: -4 }, { account: 'sys:landing', asset: 'bio.water', delta: 4 }] },
      row(3, 0, credit(0, 'metals.t1', 1)),
    ]);
    expect(await store.balancesThrough('pl_b', 2)).toEqual({ balances: { 'colony:0': { 'metals.t1': 600 }, 'sys:landing': { 'metals.t1': -600 } }, count: 3 });
    expect(await store.balancesThrough('pl_none', 9)).toEqual({ balances: {}, count: 0 });
  });
});
