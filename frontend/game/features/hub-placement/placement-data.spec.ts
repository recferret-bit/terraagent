import { flagsFromList, parseWaves, type ServerMessage } from '@terra/contracts';
import {
  buildPipeline,
  compileData,
  createPlanet,
  hasColonyHub,
  SIM_VERSION,
  SimHost,
  spawnHqUnit,
  type BalanceOverrides,
  type SimCommand,
} from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../net/emitter';
import type { ConnectionState, Outgoing, Transport } from '../../net/types';
import { WorldStore, type WorkerLike } from '../../store/WorldStore';
import { evaluateHubGhost } from './GhostEvaluator';
import { ensureDom, mountHubPlacement } from './index';

/** `hub.t1` tuned so unclaimed ground no longer takes a Hub: the default rule says yes, the live data says no. */
const OVERRIDES: BalanceOverrides = { hub: { t1: { allowUnclaimedPlacement: false } } };
const FLAGS = parseWaves('..01').list;

function tunedHost(): SimHost {
  const host = new SimHost(buildPipeline(FLAGS, OVERRIDES));
  host.load(createPlanet({ id: 'p', seed: 'placement-data', type: 'flat', radius: 12 }));
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return host;
}

const placeCmd = (q: number, r: number): SimCommand => ({ colonyIndex: 0, source: 'player', commandId: `pd_${q}_${r}`, kind: 'placeBuilding', args: { building: 'commandHub', q, r } });

describe('ghost evaluates with the host live balance data (D-37 / D-35)', () => {
  it('a tuned hub.t1 rule gives the same verdict on the ghost and in the placeBuilding handler', () => {
    const host = tunedHost();
    const data = host.pipeline.config.data;
    const tuned = evaluateHubGhost(host.state, { colonyId: 0, q: 3, r: 0, data });
    const stale = evaluateHubGhost(host.state, { colonyId: 0, q: 3, r: 0 }); // the drift this fixes
    host.submit(placeCmd(3, 0));
    const code = host.step(1).outcomes[0]?.code;
    expect(stale.valid).toBe(true);
    expect([tuned.valid, tuned.reasonCode]).toEqual([false, 'not_own_territory']);
    expect(code).toBe('not_own_territory');
    expect(hasColonyHub(host.state, 0)).toBe(false);
  });

  it('the hub-placement feature reads the data from the store (simData) and agrees with the host', () => {
    ensureDom();
    const host = tunedHost();
    const store = { latest: null, latestTiles: null, simData: () => host.pipeline.config.data };
    const sendCommand = vi.fn();
    const hub = mountHubPlacement(document.createElement('div'), { host, store, sendCommand });
    const g = hub.startPlacement(3, 0);
    expect([g.valid, g.reasonCode]).toEqual([false, 'not_own_territory']);
    expect(hub.confirmPlacement()).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();
    hub.dispose();
  });

  it('WorldStore.simData is compiled from the last welcome flags + overrides (same hash as the host)', () => {
    class FakeTransport implements Transport {
      msgs = new Emitter<ServerMessage>();
      state: ConnectionState = { phase: 'streaming', attempt: 0, downSinceMs: null };
      start() {} stop() {}
      send(_m: Outgoing) {}
      onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
      onState() { return () => {}; }
    }
    const t = new FakeTransport();
    const worker: WorkerLike = { onmessage: null, terminate() {}, postMessage() {} };
    const store = new WorldStore(t, () => worker);
    store.start(['W00', 'W01']);
    expect(store.simData()).toBeNull();
    const host = tunedHost();
    t.msgs.emit({ v: 1, t: 'welcome', d: { reason: 'join', colonyId: null, planet: { id: 'p', type: 'temperate', name: 'p' }, state: host.snapshot({ forClient: true }), simVersion: SIM_VERSION, dataHash: host.pipeline.config.data.hash, tick: 0, serverTimeMs: 1, tickMs: 200, deltaHz: 5, flags: FLAGS, overrides: OVERRIDES } } as never);
    expect(store.simData()?.hash).toBe(host.pipeline.config.data.hash);
    expect(store.simData()?.hash).not.toBe(compileData(flagsFromList(FLAGS)).hash);
    store.dispose();
  });
});
