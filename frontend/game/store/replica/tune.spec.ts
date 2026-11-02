import { flagsFromList, type ServerMessage } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { compileData, createPlanet, setOverride, SIM_VERSION, SimHost } from '@terra/sim';
import { Emitter } from '../../net/emitter';
import type { Outgoing } from '../../net/types';
import { WorldStore, type WorkerLike } from '../WorldStore';
import { SimWorkerController } from '../worker/SimWorkerController';
import { ReplicaCore } from './ReplicaCore';
import { TEST_MODULES } from './testModule';

const FLAGS = ['W00'];
const PATH = 'dev.probe.nudgeTiles';
const hashOf = (o = {}) => compileData(flagsFromList(FLAGS), o).hash;
const tunedHash = (v: number) => hashOf(setOverride({}, PATH, v));

function authority() {
  const auth = new SimHost({ flags: FLAGS, modules: TEST_MODULES });
  auth.load(createPlanet({ type: 'flat', seed: 'tune' }));
  return auth;
}
const welcomeOf = (auth: SimHost) => ({ state: auth.snapshot(), tick: auth.tick, flags: FLAGS, dataHash: hashOf(), simVersion: SIM_VERSION });

describe('live tune reaches the replica / prediction (FA-31)', () => {
  it('a dev.tuned set rebuilds the replica data with the same hash as the host, keeping the state', () => {
    const auth = authority();
    const core = new ReplicaCore({ modules: TEST_MODULES });
    expect(core.welcome(welcomeOf(auth)).ok).toBe(true);
    expect(core.dataHash).toBe(hashOf());
    expect(core.retune({ op: 'set', path: PATH, value: 3, dataHash: tunedHash(3) })).toBe(true);
    expect(core.dataHash).toBe(tunedHash(3));
    const from = auth.tick; auth.step(2);
    expect(core.delta({ fromTick: from, toTick: auth.tick, diff: auth.diffSince(from) })).toEqual({ ok: true, tick: auth.tick });
    // a hash the client cannot reproduce, or a reset (the base is unknown to the client): needs a fresh welcome
    expect(core.retune({ op: 'set', path: PATH, value: 4, dataHash: tunedHash(5) })).toBe(false);
    expect(core.retune({ op: 'reset', dataHash: hashOf() })).toBe(false);
    expect(core.dataHash).toBe(tunedHash(3));
  });

  it('WorldStore forwards dev.tuned to the worker and simData(); a reset asks for a fresh welcome', async () => {
    const auth = authority();
    const msgs = new Emitter<ServerMessage>();
    const sent: Outgoing[] = [];
    const t = { send: (m: Outgoing) => void sent.push(m), onMessage: (fn: (m: ServerMessage) => void) => msgs.on(fn) };
    const core = new ReplicaCore({ modules: TEST_MODULES });
    const worker = (): WorkerLike => {
      const w: WorkerLike = { onmessage: null, terminate() {}, postMessage(m) { queueMicrotask(() => ctl.handle(m)); } };
      const ctl = new SimWorkerController((m) => queueMicrotask(() => w.onmessage?.({ data: m })), core);
      return w;
    };
    const store = new WorldStore(t, worker, () => 1000);
    store.start(FLAGS);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    msgs.emit({ v: 1, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'pl_t', type: 'temperate', name: 't' }, ...welcomeOf(auth), state: auth.snapshot(), serverTimeMs: 1000, tickMs: 200, deltaHz: 5 } } as never);
    await tick();
    const tuned = (d: object) => ({ kind: 'dev.tuned', severity: 'info', atTick: auth.tick, colonyIds: [], data: d });
    const from = auth.tick; auth.step(1);
    msgs.emit({ v: 1, t: 'delta', d: { fromTick: from, toTick: auth.tick, diff: auth.diffSince(from), events: [tuned({ op: 'set', path: PATH, value: 3, dataHash: tunedHash(3) })] } } as never);
    await tick();
    expect(core.dataHash).toBe(tunedHash(3));
    expect(store.simData()?.hash).toBe(tunedHash(3));
    expect(sent).toEqual([]);
    msgs.emit({ v: 1, t: 'event', d: tuned({ op: 'reset', dataHash: hashOf() }) } as never);
    await tick(); await tick();
    expect(sent).toEqual([{ t: 'join', d: { planetId: 'pl_t' } }]);
    store.dispose();
  });
});
