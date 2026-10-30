import { flagsFromList } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { compileData, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import type { ServerMessage } from '@terra/contracts';
import { Emitter } from '../net/emitter';
import type { ConnectionState, Outgoing, Transport } from '../net/types';
import { WorldStore, type WorkerLike } from './WorldStore';
import { SimWorkerController } from './worker/SimWorkerController';
import { ReplicaCore } from './replica/ReplicaCore';
import { TEST_MODULES } from './replica/testModule';

class FakeTransport implements Transport {
  msgs = new Emitter<ServerMessage>();
  sent: Outgoing[] = [];
  state: ConnectionState = { phase: 'streaming', attempt: 0, downSinceMs: null };
  start() {} stop() {}
  send(m: Outgoing) { this.sent.push(m); }
  onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
  onState() { return () => {}; }
}

/** Runs the real controller in-process, with the structured clone of postMessage skipped. */
const inProcessWorker = (): WorkerLike => {
  const w: WorkerLike = {
    onmessage: null,
    terminate() {},
    postMessage(msg) { queueMicrotask(() => ctl.handle(msg)); },
  };
  const ctl = new SimWorkerController((m) => queueMicrotask(() => w.onmessage?.({ data: m })), new ReplicaCore({ modules: TEST_MODULES }));
  return w;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('WorldStore', () => {
  it('feeds welcome and deltas to the worker, exposes views and re-joins on a gap', async () => {
    const auth = new SimHost({ flags: ['W00'], modules: TEST_MODULES });
    auth.load(createPlanet({ type: 'flat', seed: 'ws' }));
    const t = new FakeTransport();
    let now = 1000;
    const store = new WorldStore(t, inProcessWorker, () => now);
    store.start(['W00']);
    const base = { v: 1 } as const;
    t.msgs.emit({ ...base, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'pl_x', type: 'temperate', name: 'x' }, state: auth.snapshot(), simVersion: SIM_VERSION, dataHash: compileData(flagsFromList(['W00'])).hash, tick: 0, serverTimeMs: 50_000, tickMs: 200, deltaHz: 5, flags: ['W00'] } } as never);
    await tick();
    expect(store.tick).toBe(0);
    expect(store.latestTiles?.count).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      const from = auth.tick; auth.step(1);
      t.msgs.emit({ ...base, t: 'delta', d: { fromTick: from, toTick: auth.tick, diff: auth.diffSince(from) } } as never);
    }
    await tick();
    expect(store.tick).toBe(3);
    now += 400;
    expect(store.serverTick()).toBe(5);
    expect(store.serverTimeMs()).toBe(50_400);
    // a delta that skips ticks triggers a join for a fresh welcome
    auth.step(1); auth.step(1);
    t.msgs.emit({ ...base, t: 'delta', d: { fromTick: 4, toTick: 5, diff: auth.diffSince(4) } } as never);
    await tick();
    expect(t.sent).toEqual([{ t: 'join', d: { planetId: 'pl_x' } }]);
    expect(store.tick).toBe(3);
    store.dispose();
  });

  it('reports a data hash mismatch as a status', async () => {
    const auth = new SimHost({ flags: ['W00'], modules: TEST_MODULES });
    auth.load(createPlanet({ type: 'flat', seed: 'ws' }));
    const t = new FakeTransport();
    const store = new WorldStore(t, inProcessWorker);
    const seen: string[] = [];
    store.onStatus((s) => seen.push(s.status));
    store.start();
    t.msgs.emit({ v: 1, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'pl_x', type: 'temperate', name: 'x' }, state: auth.snapshot(), simVersion: SIM_VERSION, dataHash: 'nope', tick: 0, serverTimeMs: 1, tickMs: 200, deltaHz: 5, flags: ['W00'] } } as never);
    await tick();
    expect(seen).toContain('versionMismatch');
    expect(store.latest).toBeNull();
  });

  it('predicts a notified command, applies acks and surfaces rejects', async () => {
    const auth = new SimHost({ flags: ['W00'], modules: TEST_MODULES });
    auth.load(createPlanet({ type: 'flat', seed: 'ws' }));
    auth.submit({ colonyIndex: null, source: 'dev', commandId: 'cm_s', kind: 't.spawn', args: { q: 1, r: 1 } });
    auth.step(1);
    const t = new FakeTransport();
    const store = new WorldStore(t, inProcessWorker, () => 1000);
    store.start(['W00']);
    t.msgs.emit({ v: 1, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'pl_x', type: 'temperate', name: 'x' }, state: auth.snapshot(), simVersion: SIM_VERSION, dataHash: compileData(flagsFromList(['W00'])).hash, tick: auth.tick, serverTimeMs: 1000, tickMs: 200, deltaHz: 5, flags: ['W00'] } } as never);
    await tick();
    const id = auth.view().entities[0].id;
    const x = () => store.latest!.entities[5];
    const x0 = x();
    const rejected: string[] = [];
    store.onCommandRejected((r) => rejected.push(`${r.id}:${r.code}`));
    store.notifySent('cm_1', 't.move', { id, x: 9 });
    await tick();
    expect(x()).toBe(9);
    t.msgs.emit({ v: 1, t: 'cmd.reject', d: { id: 'cm_1', code: 'unknown_entity' } } as never);
    await tick();
    expect(x()).toBe(x0);
    expect(rejected).toEqual(['cm_1:unknown_entity']);
    store.dispose();
  });
});
