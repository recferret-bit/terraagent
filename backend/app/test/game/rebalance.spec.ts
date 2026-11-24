import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SimThreadPool } from '../../src/game/sim-thread-pool';
import { PlanetHost } from '../../src/game/thread/planet-host';
import type { FromThread } from '../../src/game/thread/protocol';
import { PlanetRooms, type RoomMember } from '../../src/ws/rooms';

const SLOW = new URL('./fixtures/slow-module.ts', import.meta.url).href;
const ALL_WAVES = Array.from({ length: 21 }, (_, i) => `W${String(i).padStart(2, '0')}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cmd = (commandId: string, kind = 'test.nop') => ({ colonyIndex: null, source: 'dev' as const, commandId, kind, args: {} });

let games: GamePlanets | undefined;
afterEach(async () => { await games?.shutdown(); games = undefined; });

/** Records the planet lifecycle events the lease / ledger / snapshot services listen to: a move must fire none. */
function lifecycle(g: GamePlanets) {
  const seen: string[] = [];
  g.onPlanetLoaded((id) => seen.push(`loaded:${id}`));
  g.onPlanetUnloaded((id) => seen.push(`unloaded:${id}`));
  g.onPlanetDown((id) => seen.push(`down:${id}`));
  return seen;
}

/** A full (server) snapshot of a planet through `snapshotNow`. */
function snapshotOf(g: GamePlanets, planetId: string): Promise<{ tick: number; bytes: Uint8Array }> {
  return new Promise((resolve) => {
    const off = g.pool.listen((_t, msg: FromThread) => { if (msg.t === 'snapshot' && msg.planetId === planetId) { off(); resolve({ tick: msg.tick, bytes: msg.bytes }); } });
    g.requestSnapshot(planetId);
  });
}

function movedEvent(g: GamePlanets, planetId: string): Promise<Extract<FromThread, { t: 'moved' }>> {
  return new Promise((resolve) => {
    const off = g.pool.listen((_t, msg) => { if (msg.t === 'moved' && msg.planetId === planetId) { off(); resolve(msg); } });
  });
}

describe('planet move between threads (3.2)', () => {
  it('moves a planet with its exact state, flags and queued commands; clients resync; no lifecycle event fires', async () => {
    const pool = new SimThreadPool({ threads: 2, flags: ALL_WAVES, autoStep: false, rebalance: false });
    await pool.start();
    const g = (games = new GamePlanets(pool));
    const seen = lifecycle(g);
    const id = 'pl_move_exact';
    await g.load(id, { flags: ['W00'] });
    seen.length = 0;
    const from = pool.threadOf(id);
    for (let i = 0; i < 7; i++) pool.sendToPlanet(id, { t: 'ctl', op: 'step', planetId: id, dt: 1 });
    // a socket in the planet's room (WS layer): the move must make it resync
    const rooms = new PlanetRooms(g);
    let resyncs = 0;
    const member: RoomMember = { welcomeTick: 0, send: () => undefined, bufferedAmount: 0, paused: false, resync: () => { resyncs++; } };
    rooms.join(id, member);
    const before = await g.fullState(id);
    const server = await snapshotOf(g, id);

    // a command queued (not stepped yet) when the move starts, and one sent while it moves
    const queued = g.submit(id, cmd('q1'));
    const moved = movedEvent(g, id);
    expect(pool.movePlanet(id, 1 - from)).toBe(true);
    const during = g.submit(id, cmd('q2'));
    const ev = await moved;
    expect(ev).toMatchObject({ from, to: 1 - from, tick: before.tick });
    expect(pool.threadOf(id)).toBe(1 - from);

    const after = await g.fullState(id);
    expect(after.tick).toBe(before.tick);
    expect(after.dataHash).toBe(before.dataHash); // the load flags (W00, not the pool's) went along
    expect(Buffer.from(after.bytes).equals(Buffer.from(before.bytes))).toBe(true);
    expect(resyncs).toBe(1);

    // stepping on: the moved planet and a control copy restored from the pre-move server snapshot stay identical
    pool.sendToPlanet(id, { t: 'ctl', op: 'step', planetId: id, dt: 1 });
    expect(await queued).toMatchObject({ commandId: 'q1', appliedAtTick: before.tick + 1 });
    expect(await during).toMatchObject({ commandId: 'q2', appliedAtTick: before.tick + 1 });
    for (let i = 0; i < 9; i++) pool.sendToPlanet(id, { t: 'ctl', op: 'step', planetId: id, dt: 1 });
    const moved10 = await snapshotOf(g, id);
    const control = new PlanetHost(9, ALL_WAVES, (msg) => { if (msg.t === 'snapshot') controlSnap = msg.bytes; });
    let controlSnap: Uint8Array | undefined;
    control.handle({ t: 'load', planetId: id, snapshot: server.bytes.slice(), flags: ['W00'] });
    control.handle({ t: 'cmd', planetId: id, cmd: cmd('q1') });
    control.handle({ t: 'cmd', planetId: id, cmd: cmd('q2') });
    for (let i = 0; i < 10; i++) control.stepPlanet(id, 1);
    control.handle({ t: 'snapshotNow', planetId: id });
    expect(moved10.tick).toBe(server.tick + 10);
    expect(Buffer.from(moved10.bytes).equals(Buffer.from(controlSnap!))).toBe(true);

    expect(seen).toEqual([]); // lease, ledger, snapshot scheduler: nothing saw an unload or a load
    expect(g.isLoaded(id)).toBe(true);
    const stats = await pool.stats();
    expect(stats[from]!.planets.map((p) => p.planetId)).not.toContain(id);
    expect(stats[1 - from]!.planets.map((p) => p.planetId)).toContain(id);
  }, 30_000);

  it('a subscribed planet keeps its delta stream (gapless from the handoff tick) and its live tunes across the move', async () => {
    const pool = new SimThreadPool({ threads: 2, flags: ['W00'], rebalance: false });
    await pool.start();
    const g = (games = new GamePlanets(pool));
    const id = 'pl_move_stream';
    await g.load(id);
    const deltas: { fromTick: number; toTick: number }[] = [];
    g.subscribe(id, { onDelta: (d) => deltas.push({ fromTick: d.fromTick, toTick: d.toTick }) });
    const tuned = await g.tune(id, { op: 'set', path: 'dev.probe.nudgeTiles', value: '3' });
    expect(tuned.ok).toBe(true);
    await sleep(800);
    const moved = movedEvent(g, id);
    expect(pool.movePlanet(id, 1 - pool.threadOf(id))).toBe(true);
    await moved;
    expect((await g.fullState(id)).dataHash).toBe(tuned.dataHash); // the dev tune went along (not in the snapshot)
    await sleep(800);
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]!.fromTick).toBe(deltas[i - 1]!.toTick);
    const ack = await g.submit(id, cmd('after-move', 'definitely.not.a.kind'));
    expect(ack).toMatchObject({ ok: false, code: 'unknown_kind' }); // answered by the new thread
    expect(deltas.at(-1)!.toTick).toBeGreaterThan(deltas[0]!.toTick + 5);
  }, 30_000);
});

describe('automatic rebalancing (3.2)', () => {
  it('a thread kept busy by a watched slow planet gives its neighbour to the idle thread', async () => {
    const pool = new SimThreadPool({
      threads: 2, flags: ['W00'], simModules: [SLOW], statsEveryMs: 200, rebalance: { sustainMs: 1500, cooldownMs: 60_000 },
    });
    await pool.start();
    const g = (games = new GamePlanets(pool));
    const seen = lifecycle(g);
    // both on thread 0 on purpose (a placement from before the slow planet got slow)
    for (const id of ['pl_slow_hog', 'pl_neighbour']) pool.send(0, { t: 'load', planetId: id });
    await sleep(300);
    expect(g.isLoaded('pl_neighbour')).toBe(true);
    seen.length = 0;
    g.subscribe('pl_slow_hog', {}); // watched: never demoted, keeps the thread busy
    const moved = await Promise.race([movedEvent(g, 'pl_neighbour'), sleep(8000).then(() => undefined)]);
    expect(moved).toMatchObject({ from: 0, to: 1 });
    expect(pool.threadOf('pl_slow_hog')).toBe(0); // the hog stays: moving it would only move the problem
    const t0 = (await pool.stats())[1]!.planets.find((p) => p.planetId === 'pl_neighbour')!.tick;
    await sleep(600);
    expect((await pool.stats())[1]!.planets.find((p) => p.planetId === 'pl_neighbour')!.tick).toBeGreaterThan(t0 + 1);
    expect(seen).toEqual([]);
  }, 30_000);
});
