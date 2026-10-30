import { compileData, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { flagsFromList, type ServerMessage } from '@terra/contracts';
import { Emitter } from '../net/emitter';
import type { Transport } from '../net/types';
import { WorldStore } from './WorldStore';

/**
 * Dev only (`window.__world`): runs a real sim Worker against a loopback authority living in this page. `feed(n)`
 * sends a welcome (first call) and `n` one-tick deltas; `check()` compares the replica tick with the authority's.
 */
export function installWorldDevHook(): void {
  const flags = ['W00'];
  const msgs = new Emitter<ServerMessage>();
  const sent: unknown[] = [];
  const transport: Transport = {
    start() {}, stop() {}, send: (m) => { sent.push(m); },
    onMessage: (fn) => msgs.on(fn), onState: () => () => {},
    state: { phase: 'streaming', attempt: 0, downSinceMs: null },
  };
  const store = new WorldStore(transport);
  const auth = new SimHost({ flags });
  auth.load(createPlanet({ type: 'flat', seed: 'dev-hook' }));
  let welcomed = false;
  const feed = (n = 1) => {
    if (!welcomed) {
      welcomed = true;
      msgs.emit({ v: 1, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'pl_dev', type: 'temperate', name: 'dev' }, state: auth.snapshot(), simVersion: SIM_VERSION, dataHash: compileData(flagsFromList(flags)).hash, tick: auth.tick, serverTimeMs: Date.now(), tickMs: 200, deltaHz: 5, flags } } as ServerMessage);
    }
    for (let i = 0; i < n; i++) {
      const from = auth.tick;
      auth.step(1);
      msgs.emit({ v: 1, t: 'delta', d: { fromTick: from, toTick: auth.tick, diff: auth.diffSince(from) } } as ServerMessage);
    }
  };
  store.start(flags);
  (window as unknown as { __world: unknown }).__world = { store, feed, sent, check: () => ({ replica: store.tick, authority: auth.tick, status: store.status.status }) };
}
