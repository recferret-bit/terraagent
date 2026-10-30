import { ServerMessage } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { LocalHostController } from '../store/local/LocalHostController';
import type { FromLocalHost, ToLocalHost } from '../store/local/protocol';
import { memorySnapshotStore } from '../store/local/snapshotStore';
import { DevServerError } from './devServer';
import { LocalTransport, type LocalLink } from './LocalTransport';
import { Emitter } from './emitter';
import { localHostOptions } from '../app/online/localHost';

/** The controller on the other end of a synchronous in-process link, with real timers (short waits only). */
function transport() {
  const fromHost = new Emitter<FromLocalHost>();
  const ctl = new LocalHostController((m) => queueMicrotask(() => fromHost.emit(m)), {
    now: () => performance.now(), wallMs: () => Date.now(), schedule: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); }, store: memorySnapshotStore(),
  });
  const link: LocalLink = { post: (m: ToLocalHost) => ctl.handle(m), onMessage: (fn) => fromHost.on(fn), dispose: () => ctl.handle({ t: 'stop' }) };
  const t = new LocalTransport(link, { scenario: 'w00' });
  const msgs: ServerMessage[] = [];
  t.onMessage((m) => msgs.push(m));
  return { t, msgs };
}
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

describe('LocalTransport', () => {
  it('runs hello -> ready -> join -> welcome -> deltas with valid server messages and acks commands', async () => {
    const { t, msgs } = transport();
    const phases: string[] = [];
    t.onState((s) => phases.push(s.phase));
    t.start();
    await wait(700);
    expect(phases).toEqual(['connecting', 'welcomed', 'streaming']);
    t.send({ t: 'cmd', id: 'cm_01J0000000000000000000000B', d: { kind: 'dev.ping', args: {} } });
    t.send({ t: 'ping', d: { clientTimeMs: 1 } });
    await wait(500);
    for (const m of msgs) expect(ServerMessage.safeParse(m).success).toBe(true);
    const kinds = new Set(msgs.map((m) => m.t));
    for (const k of ['ready', 'welcome', 'delta', 'cmd.ack', 'pong']) expect(kinds.has(k as ServerMessage['t'])).toBe(true);
    t.dispose();
  });

  it('send before the welcome throws like the socket transport; devServer: warp works, others are host_unavailable', async () => {
    const { t, msgs } = transport();
    expect(() => t.send({ t: 'ping', d: { clientTimeMs: 1 } })).toThrow(/cannot send/);
    t.start();
    await wait(100);
    await t.devServer('warp', { planetId: 'x', k: 5 });
    await wait(50);
    expect(msgs.some((m) => m.t === 'event' && m.d.kind === 'dev.warp' && (m.d.data as { k: number }).k === 5)).toBe(true);
    await expect(t.devServer('chain.ping')).rejects.toMatchObject({ code: 'host_unavailable' });
    await expect(t.devServer('chain.ping')).rejects.toBeInstanceOf(DevServerError);
    t.dispose();
  });
});

describe('localHostOptions', () => {
  it('only ?host=local; scenario defaults to w00; waves is passed through', () => {
    expect(localHostOptions('?scenario=w00')).toBeNull();
    expect(localHostOptions('?host=local')).toEqual({ scenario: 'w00', waves: null });
    expect(localHostOptions('?host=local&scenario=W00&waves=..03')).toEqual({ scenario: 'w00', waves: '..03' });
  });
});
