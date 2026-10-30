import 'reflect-metadata';
import { newId } from '@terra/contracts';
import { applyDiff, createPlanet, createRegistryPipeline, diffSince, insertRow, restore, snapshot, step, type PlanetState } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import { bridgePlanetEvents } from '../../src/game/bus-bridge';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SimThreadPool } from '../../src/game/sim-thread-pool';
import { PlanetHost } from '../../src/game/thread/planet-host';
import type { FromThread } from '../../src/game/thread/protocol';

const ALL_WAVES = Array.from({ length: 21 }, (_, i) => `W${String(i).padStart(2, '0')}`);
const MODULE = new URL('./fixtures/test-module.ts', import.meta.url).href;
let games: GamePlanets | undefined;
afterEach(async () => { await games?.shutdown(); games = undefined; });

async function boot() {
  const pool = new SimThreadPool({ threads: 1, flags: ALL_WAVES, simModules: [MODULE] });
  await pool.start();
  return (games = new GamePlanets(pool));
}
const cmd = (kind: string, args: Record<string, unknown>, commandId = Math.random().toString(36).slice(2)) => ({ colonyIndex: null, source: 'dev' as const, commandId, kind, args });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Delta = { fromTick: number; toTick: number; diff: Uint8Array; events: { kind: string; atTick: number }[]; at: number };

describe('delta builder (real sim thread)', () => {
  it('applying every delta to a replica reproduces the server state, chained, ~5 per second', async () => {
    const g = await boot();
    const id = newId('pl');
    await g.load(id);
    const deltas: Delta[] = [];
    g.subscribe(id, { onDelta: (d) => deltas.push({ ...d, at: performance.now() }) });
    const welcome = await g.fullState(id);
    const replica: PlanetState = restore(welcome.bytes);
    expect(replica.meta.tick).toBe(welcome.tick);

    await g.submit(id, cmd('test.spawn', { x: 1, y: 2 }));
    await sleep(500);
    applyAll(replica, deltas);
    expect(replica.entities.count).toBe(1);
    await g.submit(id, cmd('test.pong', {}));
    const entityId = replica.entities.cols.id[0]!;
    await g.submit(id, cmd('test.move', { id: entityId, x: 42.5, y: -7 }));
    await sleep(1100);

    // quiescence: stop the stream, take a fresh fullState (it flushes a closing delta first), then compare
    const full = await g.fullState(id);
    await sleep(20);
    applyAll(replica, deltas);
    expect(replica.meta.tick).toBe(full.tick);
    const server = restore(full.bytes);
    expect(replica).toEqual(server);
    const row = replica.entities.cols.id.indexOf(entityId);
    expect(replica.entities.cols.x[row]).toBe(42.5);
    expect(replica.entities.cols.y[row]).toBe(-7);

    expect(deltas[0]!.fromTick).toBe(welcome.tick);
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]!.fromTick).toBe(deltas[i - 1]!.toTick);
    const span = deltas[deltas.length - 1]!.at - deltas[0]!.at;
    const rate = ((deltas.length - 1) / span) * 1000;
    expect(rate).toBeGreaterThan(3.5);
    expect(rate).toBeLessThan(6.5);
    expect(deltas.flatMap((d) => d.events).filter((e) => e.kind === 'dev.pong')).toHaveLength(1);
  });

  it('builds no deltas for an unsubscribed planet, but sends its events once', async () => {
    const g = await boot();
    const id = newId('pl');
    await g.load(id);
    const bare: string[] = [];
    const tapped: string[] = [];
    g.onEvents((_p, ev) => ev.forEach((e) => tapped.push(e.kind)));
    const cancel = g.subscribe(id, { onEvent: (ev) => ev.forEach((e) => bare.push(e.kind)) }); // sub then unsub: no stream
    cancel();
    await sleep(50);
    await g.submit(id, cmd('test.pong', {}));
    await sleep(600);
    expect(tapped.filter((k) => k === 'dev.pong')).toHaveLength(1);
    const stats = (await g.pool.stats())[0]!.planets.find((p) => p.planetId === id)!;
    expect(stats.subscribed).toBe(false);
    expect(stats.deltaBytes).toBe(0);
  });
});

/** Applies the not-yet-applied deltas in order and returns the count applied. */
function applyAll(replica: PlanetState, deltas: Delta[]): number[] {
  const done: number[] = [];
  for (const d of deltas) {
    if (d.toTick <= replica.meta.tick) continue;
    applyDiff(replica, d.diff);
    done.push(d.toTick);
  }
  return done;
}

describe('PlanetHost delta windows (deterministic clock)', () => {
  it('first delta starts at the subscription tick; events ride in the window; welcome is a boundary', () => {
    let now = 0;
    const out: FromThread[] = [];
    const host = new PlanetHost(0, ALL_WAVES, (m) => out.push(m), undefined, { now: () => now });
    host.handle({ t: 'load', planetId: 'p1' });
    host.stepAll(3);
    host.handle({ t: 'subscribe', planetId: 'p1' });
    host.stepAll(1);
    host.flushDeltas();
    expect(out.filter((m) => m.t === 'delta')).toHaveLength(0); // not due yet
    now = 200;
    host.flushDeltas();
    host.handle({ t: 'fullState', planetId: 'p1', reqId: 1 });
    const deltas = out.filter((m): m is Extract<FromThread, { t: 'delta' }> => m.t === 'delta');
    expect(deltas.map((d) => [d.fromTick, d.toTick])).toEqual([[3, 4]]);
    host.stepAll(1);
    host.handle({ t: 'fullState', planetId: 'p1', reqId: 2 }); // boundary delta then the snapshot at the same tick
    const idx = out.map((m) => m.t);
    expect(idx.slice(-2)).toEqual(['delta', 'fullState']);
    const last = out[out.length - 2] as Extract<FromThread, { t: 'delta' }>;
    const fs = out[out.length - 1] as Extract<FromThread, { t: 'fullState' }>;
    expect([last.fromTick, last.toTick, fs.tick]).toEqual([4, 5, 5]);
    // no tick advance -> no empty delta
    now = 400;
    host.flushDeltas();
    expect(out.filter((m) => m.t === 'delta')).toHaveLength(2);
  });
});

describe('diffSince cost on a radius-56 planet with 500 entities', () => {
  it('reports build time and idle size', () => {
    const state = createPlanet({ type: 'flat', seed: 'bench', radius: 56 });
    const pipe = createRegistryPipeline({ flags: ALL_WAVES });
    for (let i = 0; i < 500; i++) insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    step(state, [], 1, pipe);
    const from = state.meta.tick;
    step(state, [], 1, pipe);
    const runs = 50;
    const t0 = performance.now();
    let bytes = 0;
    for (let i = 0; i < runs; i++) bytes = diffSince(state, from).byteLength;
    const ms = (performance.now() - t0) / runs;
    console.log(`diffSince idle: ${ms.toFixed(3)} ms, ${bytes} bytes, tiles ${state.grid.count}, entities ${state.entities.count}; snapshot ${snapshot(state).byteLength} bytes`);
    expect(ms).toBeLessThan(10);
  });
});

describe('planet.event bus bridge', () => {
  it('emits each sim event once (subscribed or not) and drops unknown kinds', async () => {
    const g = await boot();
    const bus = new EventBus();
    bridgePlanetEvents(g, bus);
    const seen: { planetId: string; kind: string; tick: number }[] = [];
    bus.on('planet.event', (e) => seen.push({ planetId: e.planetId, kind: e.kind, tick: e.tick }), { module: 'test' });
    const id = newId('pl');
    await g.load(id);
    await g.submit(id, cmd('test.pong', {}));
    await sleep(300);
    const un = g.subscribe(id, { onDelta: () => undefined });
    await g.submit(id, cmd('test.pong', {}));
    await sleep(500);
    un();
    expect(seen.filter((e) => e.kind === 'dev.pong' && e.planetId === id)).toHaveLength(2);
    expect(new Set(seen.map((e) => e.tick)).size).toBe(seen.length);
  });
});
