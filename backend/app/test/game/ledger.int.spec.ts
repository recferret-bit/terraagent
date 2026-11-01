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

const credit = (tick: number, idx: number, colony: number, n: number, ref?: string): LedgerRow => ({
  tick, idx, reason: 'landing.cargo', actor: 'system:landing', ...(ref ? { ref } : {}),
  legs: [{ account: 'sys:landing', asset: 'metals.t1', delta: -n }, { account: `colony:${colony}`, asset: 'metals.t1', delta: n }],
});

describe('PrismaLedgerStore (world.ledger_entry)', () => {
  it('appends idempotently by (planet, tick, idx) and round-trips legs and ref', async () => {
    expect(await store.append('pl_a', [credit(1, 0, 0, 5, 'order:1'), credit(1, 1, 1, 6)])).toBe(2);
    expect(await store.append('pl_a', [credit(1, 1, 1, 6), credit(2, 0, 0, 7)])).toBe(1);
    const rows = await store.page('pl_a', { throughTick: 10, limit: 10 });
    expect(rows).toEqual([credit(1, 0, 0, 5, 'order:1'), credit(1, 1, 1, 6), credit(2, 0, 0, 7)]);
  });

  it('pages by (tick, idx) cursor up to a tick, deletes after a tick and per planet', async () => {
    await store.append('pl_p', [credit(1, 0, 0, 1), credit(1, 1, 0, 1), credit(2, 0, 0, 1), credit(3, 0, 0, 1), credit(4, 0, 0, 1)]);
    const first = await store.page('pl_p', { throughTick: 3, limit: 2 });
    expect(first.map((r) => [r.tick, r.idx])).toEqual([[1, 0], [1, 1]]);
    const next = await store.page('pl_p', { throughTick: 3, after: { tick: 1, idx: 1 }, limit: 5 });
    expect(next.map((r) => [r.tick, r.idx])).toEqual([[2, 0], [3, 0]]);
    expect(await store.deleteAfter('pl_p', 2)).toBe(2);
    expect(await store.deleteAll('pl_p')).toBe(3);
    expect(await store.page('pl_p', { throughTick: 99, limit: 9 })).toEqual([]);
  });

  it('recent: newest rows touching an account, oldest first, with their journal seq', async () => {
    await store.append('pl_r', [credit(1, 0, 0, 1), credit(1, 1, 1, 1), credit(2, 0, 0, 2), credit(3, 0, 1, 1), credit(4, 0, 0, 3)]);
    const rows = await store.recent('pl_r', { account: 'colony:0', limit: 2 });
    expect(rows.map((r) => [r.seq, r.tick, r.legs[1]!.delta])).toEqual([[3, 2, 2], [5, 4, 3]]);
  });
});

describe('PlanetLedgerService over Postgres', () => {
  it('restores at a snapshot tick: deletes later rows, replays, reconciles, then keeps appending', async () => {
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
    expect(logs.find((l) => l.replayed !== undefined)).toMatchObject({ planetId: 'pl_s', tick: 5, dropped: 1, replayed: 2 });
    expect((await store.page('pl_s', { throughTick: 99, limit: 9 })).map((r) => r.tick)).toEqual([1, 2, 6]);
    expect(svc.ledgerOf('pl_s')!.balances('colony:0')).toEqual({});
  });
});
