import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@terra/contracts';
import { CommandBus } from './commandBus';
import type { Listener, Outgoing, Transport } from './types';

function fakeTransport() {
  const sent: Outgoing[] = [];
  const fns = new Set<Listener<ServerMessage>>();
  const t = { send: (m: Outgoing) => void sent.push(m), onMessage: (fn: Listener<ServerMessage>) => { fns.add(fn); return () => fns.delete(fn); } } satisfies Pick<Transport, 'send' | 'onMessage'>;
  return { t, sent, deliver: (m: unknown) => fns.forEach((f) => f(m as ServerMessage)), listeners: () => fns.size };
}
const idOf = (m: Outgoing) => (m.t === 'cmd' ? m.id : '');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('CommandBus', () => {
  it('sends cmd with a fresh cm_ id and resolves on the matching ack', async () => {
    const f = fakeTransport();
    const bus = new CommandBus(f.t);
    const a = bus.send('dev.spawn', { q: 1, r: 2 });
    const b = bus.send('dev.ping');
    expect(f.sent).toHaveLength(2);
    expect(idOf(f.sent[0])).toMatch(/^cm_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(idOf(f.sent[0])).not.toBe(idOf(f.sent[1]));
    expect(f.sent[0]).toMatchObject({ t: 'cmd', d: { kind: 'dev.spawn', args: { q: 1, r: 2 } } });
    f.deliver({ t: 'cmd.ack', d: { id: idOf(f.sent[1]), appliedAtTick: 9 } });
    f.deliver({ t: 'cmd.ack', d: { id: idOf(f.sent[0]), appliedAtTick: 8 } });
    expect(await a).toEqual({ ok: true, appliedAtTick: 8 });
    expect(await b).toEqual({ ok: true, appliedAtTick: 9 });
  });
  it('resolves a reject with code and detail', async () => {
    const f = fakeTransport();
    const p = new CommandBus(f.t).send('dev.teleport', {});
    f.deliver({ t: 'cmd.reject', d: { id: idOf(f.sent[0]), code: 'unknown_entity', detail: 'no entity 4' } });
    expect(await p).toEqual({ ok: false, code: 'unknown_entity', detail: 'no entity 4' });
  });
  it('ignores unknown ids and unrelated messages', async () => {
    const f = fakeTransport();
    const p = new CommandBus(f.t).send('dev.ping');
    f.deliver({ t: 'cmd.ack', d: { id: 'cm_other', appliedAtTick: 1 } });
    f.deliver({ t: 'pong', d: {} });
    f.deliver({ t: 'cmd.ack', d: { id: idOf(f.sent[0]), appliedAtTick: 3 } });
    expect(await p).toEqual({ ok: true, appliedAtTick: 3 });
  });
  it('times out after 5 s without an ack, and a late ack is ignored', async () => {
    const f = fakeTransport();
    const p = new CommandBus(f.t).send('dev.ping');
    await vi.advanceTimersByTimeAsync(4999);
    f.deliver({ t: 'pong', d: {} });
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toMatchObject({ ok: false, code: 'timeout' });
    f.deliver({ t: 'cmd.ack', d: { id: idOf(f.sent[0]), appliedAtTick: 1 } });
  });
  it('dispose unsubscribes and fails pending commands', async () => {
    const f = fakeTransport();
    const bus = new CommandBus(f.t);
    const p = bus.send('dev.ping');
    bus.dispose();
    expect(f.listeners()).toBe(0);
    expect(await p).toMatchObject({ ok: false, code: 'not_connected' });
  });

  it('reports sends to onSent unless predict is false', () => {
    const f = fakeTransport();
    const seen: string[] = [];
    const bus = new CommandBus(f.t, undefined, (_id, kind) => seen.push(kind));
    void bus.send('dev.teleport', { id: 1 });
    void bus.send('dev.teleport', { id: 1 }, { predict: false });
    expect(f.sent).toHaveLength(2);
    expect(seen).toEqual(['dev.teleport']);
    bus.dispose();
  });
});
