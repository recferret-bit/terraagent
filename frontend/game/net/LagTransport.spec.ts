import type { ServerMessage } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { LagTransport, lagFromSearch, type LagDeps } from './LagTransport';
import { Emitter } from './emitter';
import type { Outgoing, Transport } from './types';

class FakeClock implements LagDeps {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  now() { return this.t; }
  setTimer(fn: () => void, ms: number) { const id = ++this.n; this.timers.push({ at: this.t + ms, fn, id }); return id; }
  clearTimer(h: unknown) { this.timers = this.timers.filter((x) => x.id !== h); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

const inner = () => {
  const msgs = new Emitter<ServerMessage>();
  const sent: { at: number; m: Outgoing }[] = [];
  const clock = new FakeClock();
  const tr: Transport = { start() {}, stop() {}, send: (m) => { sent.push({ at: clock.t, m }); }, onMessage: (f) => msgs.on(f), onState: () => () => {}, state: { phase: 'streaming', attempt: 0, downSinceMs: null } };
  return { tr, msgs, sent, clock };
};
const ping = (n: number): Outgoing => ({ t: 'ping', d: { clientTimeMs: n } });
const pong = (n: number) => ({ v: 1, t: 'pong', d: { clientTimeMs: n, serverTimeMs: n } }) as ServerMessage;

describe('LagTransport', () => {
  it('delays sends by ms and keeps their order', () => {
    const { tr, sent, clock } = inner();
    const lag = new LagTransport(tr, 300, clock);
    lag.send(ping(1)); clock.advance(10); lag.send(ping(2)); lag.send(ping(3));
    clock.advance(289);
    expect(sent).toHaveLength(0);
    clock.advance(1);
    expect(sent.map((s) => [s.at, (s.m as { d: { clientTimeMs: number } }).d.clientTimeMs])).toEqual([[300, 1]]);
    clock.advance(10);
    expect(sent.map((s) => [s.at, (s.m as { d: { clientTimeMs: number } }).d.clientTimeMs])).toEqual([[300, 1], [310, 2], [310, 3]]);
  });

  it('delays incoming messages by ms in order and stop drops what is in flight', () => {
    const { tr, msgs, clock } = inner();
    const lag = new LagTransport(tr, 300, clock);
    const got: [number, number][] = [];
    lag.onMessage((m) => got.push([clock.t, (m as { d: { clientTimeMs: number } }).d.clientTimeMs]));
    msgs.emit(pong(1)); clock.advance(50); msgs.emit(pong(2));
    clock.advance(249);
    expect(got).toEqual([]);
    clock.advance(1);
    expect(got).toEqual([[300, 1]]);
    clock.advance(50);
    expect(got).toEqual([[300, 1], [350, 2]]);
    msgs.emit(pong(3)); lag.stop(); clock.advance(1000);
    expect(got).toHaveLength(2);
  });

  it('parses ?lag', () => {
    expect(lagFromSearch('?lag=300')).toBe(300);
    expect(lagFromSearch('?x=1')).toBe(0);
    expect(lagFromSearch('?lag=abc')).toBe(0);
    expect(lagFromSearch('?lag=-5')).toBe(0);
  });
});
