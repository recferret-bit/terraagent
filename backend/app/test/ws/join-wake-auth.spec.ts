import { EventEmitter } from 'node:events';
import { decodeWire, encodeWire, WS_PROTO_VERSION } from '@terra/contracts';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { Connection, type ConnectionDeps } from '../../src/ws/connection';

class FakeWs extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: Array<{ t: string; d?: { reason?: string } }> = [];
  closed: [number, string] | undefined;
  send(frame: string | Uint8Array) { this.sent.push(decodeWire(frame as never) as never); }
  close(code: number, reason: string) { this.closed = [code, reason]; this.readyState = 3; }
  terminate() { this.readyState = 3; }
}

/** A real `Connection` over stubs; `ensureHosted` stands for the restore of an idle-unloaded planet. */
function rig(home: unknown, loaded: readonly string[] = [], host?: (planetId: string) => Promise<{ kind: 'local' }>) {
  const ws = new FakeWs();
  const woken: string[] = [];
  const deps = {
    verifier: { verify: async () => ({ playerId: 'pr_visitor', handle: 'x' }) },
    planets: { isLoaded: (id: string) => loaded.includes(id), isScenarioColonyPlanet: () => false, deltaHz: 5, fullState: async () => { throw new Error('no snapshot in this rig'); } },
    rooms: { join() {}, leave() {} },
    ingress: { handle: async () => undefined },
    home: { getHome: async (_player: string, planetId?: string) => (typeof home === 'function' ? (home as (p?: string) => unknown)(planetId) : home) },
    flags: [], log: pino({ level: 'silent' }), helloTimeoutMs: 5000, idleTimeoutMs: 60000,
    onJoined() {}, onClosed() {}, onWelcome() {},
    ensureHosted: host ?? (async (planetId: string) => { woken.push(planetId); return { kind: 'local' as const }; }),
  } as unknown as ConnectionDeps;
  new Connection(ws as never, deps);
  const send = async (msg: object) => {
    ws.emit('message', Buffer.from(encodeWire({ v: 1, ...msg }) as never), false);
    await new Promise((r) => setTimeout(r, 40));
  };
  return { ws, woken, send, hello: () => send({ t: 'hello', d: { accessToken: 't', proto: [WS_PROTO_VERSION], client: { app: 'game', version: 'x' } } }) };
}

describe('a ws join cannot wake a planet the player has no home on', () => {
  it('a player with no colony is refused before anything is restored', async () => {
    const r = rig({ state: 'NEW', planets: [], newPlanetTypes: [] });
    await r.hello();
    await r.send({ t: 'join', d: { planetId: 'pl_dev_2' } });
    expect(r.ws.closed?.[1]).toBe('not_your_planet');
    expect(r.woken).toEqual([]);
  });

  it('a player whose home is on another planet is refused too', async () => {
    const r = rig((planetId?: string) => (planetId === 'pl_dev_9' ? { state: 'NEW', planets: [], newPlanetTypes: [] } : { state: 'ACTIVE', colony: { id: 'co_1', planetId: 'pl_dev' }, planet: { id: 'pl_dev' } }));
    await r.hello();
    await r.send({ t: 'join', d: { planetId: 'pl_dev_9' } });
    expect(r.ws.closed?.[1]).toBe('not_your_planet');
    expect(r.woken).toEqual([]);
  });

  it('the owner of a colony on the sleeping planet wakes it', async () => {
    const r = rig({ state: 'ACTIVE', colony: { id: 'co_1', planetId: 'pl_dev_2' }, planet: { id: 'pl_dev_2' } });
    await r.hello();
    await r.send({ t: 'join', d: { planetId: 'pl_dev_2' } });
    expect(r.woken).toEqual(['pl_dev_2']);
  });

  it('a planet that cannot be hosted answers bye planet_unavailable instead of leaving the socket hanging', async () => {
    const r = rig({ state: 'ACTIVE', colony: { id: 'co_1', planetId: 'pl_dev_2' }, planet: { id: 'pl_dev_2' } }, [], async () => { throw new Error('its snapshots cannot be restored'); });
    await r.hello();
    await r.send({ t: 'join', d: { planetId: 'pl_dev_2' } });
    expect(r.ws.closed?.[1]).toBe('planet_unavailable');
    expect(r.ws.sent.at(-1)).toMatchObject({ t: 'bye', d: { reason: 'planet_unavailable' } });
  });
});
