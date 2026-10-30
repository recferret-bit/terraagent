import { describe, expect, it } from 'vitest';
import { ClientMessage, ServerMessage, newId, Welcome, encodeWire, decodeWire, CLOSE_CODES, RejectCode } from '../src';

const hello = { v: 1, t: 'hello', d: { accessToken: 'dev:alice', proto: [1], client: { app: 'game', version: '0.1.0' } } };
const cmd = { v: 1, t: 'cmd', id: newId('cm'), d: { kind: 'dev.ping', args: {} } };

describe('client messages parse strictly (PR-01)', () => {
  it('accepts valid messages', () => {
    for (const m of [hello, cmd, { v: 1, t: 'join', d: { planetId: newId('pl') } }, { v: 1, t: 'ping', d: { clientTimeMs: 1 } }, { v: 1, t: 'leave', d: {} }]) {
      expect(ClientMessage.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
  });

  it('rejects unknown fields at the envelope, payload and nested levels', () => {
    expect(ClientMessage.safeParse({ ...hello, extra: 1 }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...hello, d: { ...hello.d, extra: 1 } }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...hello, d: { ...hello.d, client: { ...hello.d.client, extra: 1 } } }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...cmd, d: { ...cmd.d, colonyId: 'co_x' } }).success).toBe(false);
  });

  it('rejects a wrong version, an unknown type and a cmd without a cm_ id', () => {
    expect(ClientMessage.safeParse({ ...hello, v: 2 }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...hello, t: 'nope' }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...cmd, id: undefined }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...cmd, id: 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV' }).success).toBe(false);
  });
});

describe('server messages parse permissively', () => {
  const welcome = {
    v: 1, t: 'welcome', tick: 7,
    d: {
      reason: 'join', colonyId: null, planet: { id: newId('pl'), type: 'temperate', name: 'Dev' }, state: new Uint8Array([1, 2, 3]),
      simVersion: 1, dataHash: 'abc', tick: 7, serverTimeMs: 1, tickMs: 200, deltaHz: 5, flags: ['W00'],
    },
  };
  it('ignores unknown keys instead of failing', () => {
    const r = ServerMessage.safeParse({ ...welcome, future: true, d: { ...welcome.d, futureField: 1 } });
    expect(r.success).toBe(true);
  });
  it('round-trips welcome through the binary wire format with its bytes intact', () => {
    const frame = encodeWire(welcome);
    expect(frame).toBeInstanceOf(Uint8Array);
    const back = Welcome.parse(decodeWire(frame));
    expect([...back.d.state]).toEqual([1, 2, 3]);
  });
  it('sends byte-free messages as JSON text', () => {
    expect(typeof encodeWire({ v: 1, t: 'pong', d: { clientTimeMs: 1, serverTimeMs: 2 } })).toBe('string');
  });
});

describe('codes and ids', () => {
  it('has wave_disabled and the close codes', () => {
    expect(RejectCode.parse('wave_disabled')).toBe('wave_disabled');
    expect(CLOSE_CODES.server_restarting).toBe(4012);
  });
  it('makes prefixed ULIDs', () => {
    expect(newId('cm')).toMatch(/^cm_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

import { AnalyticsBatchV1 } from '../src';

describe('AnalyticsBatchV1 (CLIENT §10.2)', () => {
  const ev = { name: 'test_event', ts: 1, props: {} };
  const ok = { anonId: '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11', sessionId: 's', events: [ev] };
  it('accepts a valid batch', () => expect(AnalyticsBatchV1.safeParse(ok).success).toBe(true));
  it('rejects unknown keys, bad names, >20 events, >20 props, nested props', () => {
    expect(AnalyticsBatchV1.safeParse({ ...ok, ip: '1.2.3.4' }).success).toBe(false);
    expect(AnalyticsBatchV1.safeParse({ ...ok, events: [{ ...ev, name: 'Bad-Name' }] }).success).toBe(false);
    expect(AnalyticsBatchV1.safeParse({ ...ok, events: Array.from({ length: 21 }, () => ev) }).success).toBe(false);
    expect(AnalyticsBatchV1.safeParse({ ...ok, events: [{ ...ev, props: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])) }] }).success).toBe(false);
    expect(AnalyticsBatchV1.safeParse({ ...ok, events: [{ ...ev, props: { a: { b: 1 } } }] }).success).toBe(false);
    expect(AnalyticsBatchV1.safeParse({ ...ok, anonId: 'x' }).success).toBe(false);
  });
});
