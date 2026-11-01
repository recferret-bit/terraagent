import 'reflect-metadata';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreException } from '../../src/core/errors';
import type { ColonySeatAssignment } from '../../src/core/home';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import { devPlanetsToGenerate } from '../../src/game/dev-planets';
import { InMemoryLedgerStore } from '../../src/game/ledger/in-memory-ledger-store';
import type { LedgerRow } from '../../src/game/ledger/ledger-store.port';
import type { PlanetLedgerService } from '../../src/game/ledger/planet-ledger.service';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { PlanetHeldError, SnapshotService } from '../../src/game/persistence/snapshot.service';
import { gameSeatHost, seatColonyOnPlanet } from '../../src/game/seat-colony';
import { FRESH, credit, row, setupLedgerService } from './fixtures/ledger-service';

const ON = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 3600, NODE_ENV: 'test' } as unknown as AppEnv;
const OFF = { SNAPSHOTS: 'off', SNAPSHOT_EVERY_S: 3600, NODE_ENV: 'test' } as unknown as AppEnv;

/** A ledger store whose appends fail `failures` times (the database is down, then recovers). */
class FlakyStore extends InMemoryLedgerStore {
  constructor(public failures: number) { super(); }
  override async append(planetId: string, rows: readonly LedgerRow[]): Promise<number> {
    if (this.failures > 0) { this.failures--; throw new Error('db down'); }
    return super.append(planetId, rows);
  }
}

/** A fake snapshot store: `snapshots` = planets with snapshot rows; `down` = every query throws. Saves are recorded. */
function fakeSnapshotStore(o: { snapshots?: string[]; down?: boolean; onSave?: (id: string, tick: number) => void } = {}) {
  const saved: Array<[string, number]> = [];
  const check = () => { if (o.down) throw new Error('db down'); };
  const store = {
    saved,
    hasSnapshots: async (id: string) => { check(); return (o.snapshots ?? []).includes(id); },
    livePlanetIds: async () => { check(); return o.snapshots ?? []; },
    latest: async () => { check(); return null; },
    save: async (id: string, tick: number) => { o.onSave?.(id, tick); saved.push([id, tick]); return { sizeBytes: 1 }; },
    prune: async () => 0,
  };
  return store;
}

/** A ledger service and a snapshot service over the same fake planets (as in `GameModule`). */
function setup(o: { ledgerStore?: InMemoryLedgerStore; snapshots?: Parameters<typeof fakeSnapshotStore>[0]; env?: AppEnv } = {}) {
  const ledger = setupLedgerService(o.ledgerStore ?? new InMemoryLedgerStore());
  const snaps = fakeSnapshotStore(o.snapshots);
  const logs: Array<Record<string, unknown>> = [];
  const root = pino({ level: 'debug' }, { write: (s: string) => { logs.push(JSON.parse(s) as Record<string, unknown>); } });
  const svc = new SnapshotService(ledger.planets as never, snaps as unknown as SnapshotStore, new MetricsRegistry(), o.env ?? ON, root, ledger.svc);
  return { ...ledger, ledger: ledger.svc, snaps, snapshots: svc, snapLogs: logs };
}

describe('fresh loads never replace a planet that has snapshots (H1)', () => {
  it('loadNew generates a planet without snapshots and tells the ledger so: rows of an older planet with the id go', async () => {
    const { snapshots, planets, store, ledger } = setup();
    await store.append('pl_new', [row(1, 0, credit(0, 'metals.t1', 5))]);
    await snapshots.loadNew('pl_new', { params: { type: 'desert' } });
    await ledger.settled('pl_new');
    expect(planets.loads).toMatchObject([{ id: 'pl_new', opts: { params: { type: 'desert' }, noSnapshots: true } }]);
    expect(store.all('pl_new')).toEqual([]);
    await snapshots.loadNew('pl_new'); // already loaded: nothing to do
    expect(planets.loads).toHaveLength(1);
  });

  it.each([
    ['it has snapshots (newer build, corrupt, failed restore, END)', { snapshots: ['pl_held'] }],
    ['the database is down', { down: true }],
  ])('loadNew refuses when %s: nothing is loaded, the journal rows stay', async (_why, snapOpts) => {
    const { snapshots, planets, store, errors } = setup({ snapshots: snapOpts });
    await store.append('pl_held', [row(1, 0, credit(0, 'metals.t1', 5))]);
    await expect(snapshots.loadNew('pl_held')).rejects.toBeInstanceOf(PlanetHeldError);
    expect(planets.loads).toEqual([]);
    expect(store.all('pl_held')).toHaveLength(1);
    expect(errors()).toEqual([]);
  });

  it('with persistence off there are no snapshots: loadNew generates without asking the database', async () => {
    const { snapshots, planets } = setup({ env: OFF, snapshots: { down: true } });
    await snapshots.loadNew('pl_off');
    expect(planets.loads).toMatchObject([{ id: 'pl_off', opts: { noSnapshots: true } }]);
  });

  it('restoreAll reports a database that is down; boot then generates no dev planet', async () => {
    const { snapshots } = setup({ snapshots: { down: true } });
    const report = await snapshots.restoreAll();
    expect(report).toEqual({ restored: [], held: [], dbUnavailable: true });
    expect(devPlanetsToGenerate(['pl_a', 'pl_b'], [], report)).toEqual([]);
  });

  it('restoreAll holds a planet whose snapshots are all corrupt or whose restore failed; boot skips held and loaded ids', async () => {
    const { snapshots, snaps } = setup({ snapshots: { snapshots: ['pl_corrupt'] } });
    expect(await snapshots.restoreAll()).toEqual({ restored: [], held: ['pl_corrupt'], dbUnavailable: false });
    snaps.latest = async () => { throw new Error('read failed'); };
    const report = await snapshots.restoreAll();
    expect(report.held).toEqual(['pl_corrupt']);
    expect(devPlanetsToGenerate(['pl_corrupt', 'pl_up', 'pl_new'], ['pl_up'], report)).toEqual(['pl_new']);
  });

  it('a seat on a planet that has snapshots but is not loaded is rejected host_unavailable, never generated', async () => {
    const { snapshots, planets, store } = setup({ snapshots: { snapshots: ['pl_dev'] } });
    await store.append('pl_dev', [row(1, 0, credit(0, 'metals.t1', 5))]);
    const submitted: unknown[] = [];
    const host = gameSeatHost(snapshots, { submit: async (_p, cmd) => { submitted.push(cmd); return { ok: true, commandId: 'c', appliedAtTick: 1 }; } }, pino({ level: 'silent' }));
    const assignment = {
      player: { id: 'p_1', handle: 'A' }, colony: { id: 'col_1', colonyIndex: 0, planetId: 'pl_dev' },
      planet: { id: 'pl_dev', type: 'desert', seed: 's', radius: 56, capacity: 5 }, slot: { index: 0, q: 1, r: 1 },
    } as unknown as ColonySeatAssignment;
    const err = (await seatColonyOnPlanet(host, assignment).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ errorCode: 'COLONY_SEAT_REJECTED', status: 409, details: { code: 'host_unavailable', planetId: 'pl_dev' } });
    expect(planets.loads).toEqual([]);
    expect(submitted).toEqual([]);
    expect(store.all('pl_dev')).toHaveLength(1);
  });
});

describe('SnapshotService.write and the ledger (L1, L2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('waits for the planet\'s queued journal writes before saving the snapshot', async () => {
    const order: string[] = [];
    const store = new FlakyStore(2);
    const { planets, snaps } = setup({ ledgerStore: store, snapshots: { onSave: (id, tick) => order.push(`save ${tick} with ${store.all(id).length} rows`) } });
    planets.loaded('pl_s', 0, FRESH);
    planets.step('pl_s', 1, [credit(0, 'metals.t1', 5)]);
    planets.snapshot('pl_s', 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(snaps.saved).toEqual([]); // the row of tick 1 is still being retried
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['save 1 with 1 rows']);
  });

  it('a genesis snapshot is saved only after its opening rows are written', async () => {
    const store = new FlakyStore(2);
    const { planets, snaps } = setup({ ledgerStore: store, snapshots: { onSave: (id) => expect(store.all(id)).toHaveLength(1) } });
    planets.loaded('pl_g', 4, { restored: true, genesis: true, stocks: [{ 'metals.t1': 40 }] });
    planets.snapshot('pl_g', 4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(snaps.saved).toEqual([['pl_g', 4]]);
  });

  it('skips (and logs) the snapshot of a planet with unwritten rows once the ledger gave up at shutdown', async () => {
    const { planets, snaps, ledger, snapLogs } = setup({ ledgerStore: new FlakyStore(Number.POSITIVE_INFINITY) });
    planets.loaded('pl_x', 0, FRESH);
    planets.loaded('pl_ok', 0, FRESH);
    planets.step('pl_x', 1, [credit(0, 'metals.t1', 5)]);
    const shutdown = (ledger as PlanetLedgerService).beforeApplicationShutdown();
    planets.snapshot('pl_x', 1);
    planets.snapshot('pl_ok', 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await shutdown;
    expect(snaps.saved).toEqual([['pl_ok', 1]]);
    expect(snapLogs.find((l) => l.unwritten !== undefined)).toMatchObject({ level: 50, planetId: 'pl_x', tick: 1, unwritten: 1 });
  });
});
