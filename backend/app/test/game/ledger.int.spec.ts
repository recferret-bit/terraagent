import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetLedgerListener } from '../../src/game/game-planets.service';
import type { LedgerRow } from '../../src/game/ledger/ledger-store.port';
import { PlanetLedgerService } from '../../src/game/ledger/planet-ledger.service';
import { PrismaLedgerStore } from '../../src/game/ledger/prisma-ledger-store';
import type { LoadedInfo } from '../../src/game/thread/protocol';

let db: TestDatabase;
let store: PrismaLedgerStore;
beforeAll(async () => {
  db = await createTestDatabase();
  store = new PrismaLedgerStore(db.prisma);
});
afterAll(async () => { await db.drop(); });

/** Every stored row of a planet as `[tick, idx]`, in journal order. */
const keys = async (planetId: string) =>
  (await db.prisma.ledgerEntry.findMany({ where: { planetId }, orderBy: [{ tick: 'asc' }, { idx: 'asc' }] })).map((r) => [Number(r.tick), r.idx]);

const credit = (tick: number, idx: number, colony: number, n: number, ref?: string): LedgerRow => ({
  tick, idx, reason: 'landing.cargo', actor: 'system:landing', ...(ref ? { ref } : {}),
  legs: [{ account: 'sys:landing', asset: 'metals.t1', delta: -n }, { account: `colony:${colony}`, asset: 'metals.t1', delta: n }],
});

describe('PrismaLedgerStore (world.ledger_entry)', () => {
  it('appends idempotently by (planet, tick, idx) and round-trips legs and ref', async () => {
    expect(await store.append('pl_a', [credit(1, 0, 0, 5, 'order:1'), credit(1, 1, 1, 6)])).toBe(2);
    expect(await store.append('pl_a', [credit(1, 1, 1, 6), credit(2, 0, 0, 7)])).toBe(1);
    const rows = await store.recent('pl_a', { account: 'sys:landing', limit: 10 });
    expect(rows).toEqual([credit(1, 0, 0, 5, 'order:1'), credit(1, 1, 1, 6), credit(2, 0, 0, 7)].map((r, i) => ({ ...r, seq: i + 1 })));
  });

  it('deletes after a tick and per planet', async () => {
    await store.append('pl_p', [credit(1, 0, 0, 1), credit(1, 1, 0, 1), credit(2, 0, 0, 1), credit(3, 0, 0, 1), credit(4, 0, 0, 1)]);
    expect(await store.deleteAfter('pl_p', 2)).toBe(2);
    expect(await keys('pl_p')).toEqual([[1, 0], [1, 1], [2, 0]]);
    expect(await store.deleteAll('pl_p')).toBe(3);
    expect(await keys('pl_p')).toEqual([]);
  });

  it('balancesThrough: one SQL sum per (account, asset) over multi-leg, multi-asset rows up to a tick, plus the count', async () => {
    const trade = (tick: number, idx: number): LedgerRow => ({
      tick, idx, reason: 'trade', actor: 'colony:0', legs: [
        { account: 'colony:0', asset: 'metals.t1', delta: -40 }, { account: 'colony:1', asset: 'metals.t1', delta: 40 },
        { account: 'colony:1', asset: 'bio.water', delta: -3 }, { account: 'colony:0', asset: 'bio.water', delta: 3 },
      ],
    });
    const big = 2 ** 40; // beyond int4: the sums are bigint end to end
    await store.append('pl_b', [
      credit(1, 0, 0, 600), credit(1, 1, 1, big),
      { tick: 1, idx: 2, reason: 'landing.cargo', actor: 'system:landing', legs: [{ account: 'sys:landing', asset: 'bio.water', delta: -10 }, { account: 'colony:1', asset: 'bio.water', delta: 10 }] },
      trade(2, 0), trade(2, 1),
      { tick: 3, idx: 0, reason: 'x', actor: 'y', legs: [{ account: 'colony:0', asset: 'bio.water', delta: -6 }, { account: 'sys:sink', asset: 'bio.water', delta: 6 }] },
      credit(9, 0, 0, 1),
    ]);
    await store.append('pl_other', [credit(1, 0, 0, 5)]);
    expect(await store.balancesThrough('pl_b', 3)).toEqual({
      count: 6,
      balances: {
        'colony:0': { 'metals.t1': 520 }, // bio.water: +3 +3 -6 = 0, omitted
        'colony:1': { 'metals.t1': big + 80, 'bio.water': 4 },
        'sys:landing': { 'metals.t1': -600 - big, 'bio.water': -10 },
        'sys:sink': { 'bio.water': 6 },
      },
    });
    expect(await store.balancesThrough('pl_b', 0)).toEqual({ balances: {}, count: 0 });
    expect(await store.balancesThrough('pl_none', 99)).toEqual({ balances: {}, count: 0 });
  });

  it('recent: newest rows touching an account, oldest first, with their journal seq', async () => {
    await store.append('pl_r', [credit(1, 0, 0, 1), credit(1, 1, 1, 1), credit(2, 0, 0, 2), credit(3, 0, 1, 1), credit(4, 0, 0, 3)]);
    const rows = await store.recent('pl_r', { account: 'colony:0', limit: 2 });
    expect(rows.map((r) => [r.seq, r.tick, r.legs[1]!.delta])).toEqual([[3, 2, 2], [5, 4, 3]]);
  });
});

describe('PlanetLedgerService over Postgres', () => {
  it('restores at a snapshot tick: deletes later rows, opens from the SQL sums, reconciles, then keeps appending', async () => {
    let loaded!: (id: string, tick: number, info: LoadedInfo) => void;
    let ledger!: PlanetLedgerListener;
    const planets = { onPlanetLoaded: (f: typeof loaded) => { loaded = f; }, onPlanetUnloaded: () => {}, onPlanetLedger: (f: PlanetLedgerListener) => { ledger = f; } };
    const logs: Array<Record<string, unknown>> = [];
    const root = pino({ level: 'info' }, { write: (s: string) => { logs.push(JSON.parse(s) as Record<string, unknown>); } });
    const svc = new PlanetLedgerService(planets as never, store, root, {} as never);
    await store.append('pl_s', [credit(1, 0, 0, 600), credit(2, 0, 0, 5), credit(9, 0, 0, 1)]);
    loaded('pl_s', 5, { restored: true, genesis: false, stocks: [{ 'metals.t1': 605 }] });
    ledger('pl_s', 6, [{ at: 6, reason: 'construction.spend', actor: 'player:p', legs: [{ account: 'colony:0', asset: 'metals.t1', delta: -605 }, { account: 'sys:construction', asset: 'metals.t1', delta: 605 }] }]);
    await svc.settled('pl_s');
    expect(logs.filter((l) => l.level === 50)).toEqual([]);
    expect(logs.find((l) => l.rows !== undefined && l.dropped !== undefined)).toMatchObject({ planetId: 'pl_s', tick: 5, dropped: 1, rows: 2 });
    expect((await keys('pl_s')).map(([t]) => t)).toEqual([1, 2, 6]);
    const journal = svc.journalOf('pl_s')!;
    expect(journal.balances('colony:0')).toEqual({});
    expect(journal.seq).toBe(3);
    expect(journal.verify()).toEqual({ ok: true });
  });
});
