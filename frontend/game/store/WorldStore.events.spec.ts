import { flagsFromList, type ServerMessage, type SimEventWire } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { compileData, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { Emitter } from '../net/emitter';
import type { Outgoing, Transport } from '../net/types';
import { WorldStore, type WorkerLike } from './WorldStore';
import { SimWorkerController } from './worker/SimWorkerController';

const inProcessWorker = (): WorkerLike => {
  const w: WorkerLike = { onmessage: null, terminate() {}, postMessage(msg) { queueMicrotask(() => ctl.handle(msg)); } };
  const ctl = new SimWorkerController((m) => queueMicrotask(() => w.onmessage?.({ data: m })));
  return w;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  const msgs = new Emitter<ServerMessage>();
  const transport: Transport = { start() {}, stop() {}, send: (_m: Outgoing) => {}, onMessage: (fn) => msgs.on(fn), onState: () => () => {}, state: { phase: 'streaming', attempt: 0, downSinceMs: null } };
  const auth = new SimHost({ flags: ['W00'] });
  auth.load(createPlanet({ type: 'flat', seed: 'ev' }));
  const store = new WorldStore(transport, inProcessWorker, () => 1000);
  store.start(['W00']);
  msgs.emit({ v: 1, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'pl_x', type: 'temperate', name: 'x' }, state: auth.snapshot(), simVersion: SIM_VERSION, dataHash: compileData(flagsFromList(['W00'])).hash, tick: 0, serverTimeMs: 1000, tickMs: 200, deltaHz: 5, flags: ['W00'] } } as never);
  await settle();
  const render: SimEventWire[] = [], server: SimEventWire[] = [];
  store.onRenderEvents((e) => render.push(...e));
  store.onServerEvents((e) => server.push(...e));
  return { msgs, store, render, server, auth };
}

describe('WorldStore event split', () => {
  it('surfaces predicted engine events as render events only', async () => {
    const { store, render, server } = await setup();
    store.notifySent('cm_1', 'dev.ping', {});
    await settle();
    expect(render.map((e) => e.kind)).toEqual(['dev.pong']);
    expect(server).toEqual([]);
    store.dispose();
  });

  it('takes player-facing events only from server messages (event envelope and delta.events)', async () => {
    const { msgs, store, render, server, auth } = await setup();
    const ev = (kind: string): SimEventWire => ({ kind, severity: 'info', atTick: 1, colonyIds: [], data: {} });
    msgs.emit({ v: 1, t: 'event', d: ev('a') } as never);
    auth.step(1);
    msgs.emit({ v: 1, t: 'delta', d: { fromTick: 0, toTick: 1, diff: auth.diffSince(0), events: [ev('b'), ev('c')] } } as never);
    await settle();
    expect(server.map((e) => e.kind)).toEqual(['a', 'b', 'c']);
    expect(render).toEqual([]);
    store.dispose();
  });

  it('reports the prediction mode', async () => {
    const { store } = await setup();
    expect(store.predictionMode).toBe('on');
    store.dispose();
  });
});
