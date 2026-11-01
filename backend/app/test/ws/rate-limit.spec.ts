import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { CommandRateLimiter } from '../../src/ws/command-rate-limit';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress';

describe('per-player command rate limit (ingress)', () => {
  it('allows a burst, then refills at the sustained rate, per player', () => {
    let now = 0;
    const lim = new CommandRateLimiter({ perSecond: 20, burst: 40, now: () => now });
    let ok = 0;
    for (let i = 0; i < 100; i++) if (lim.take('alice')) ok++;
    expect(ok).toBe(40);
    expect(lim.take('bob')).toBe(true); // another player has their own bucket
    now += 500; // half a second: 10 more
    ok = 0;
    for (let i = 0; i < 100; i++) if (lim.take('alice')) ok++;
    expect(ok).toBe(10);
  });

  it('rejects the overflow as rate_limited before it reaches a planet thread', async () => {
    const submitted: unknown[] = [];
    const planets = { submit: async (_p: string, c: unknown) => { submitted.push(c); return { ok: true, commandId: 'x', appliedAtTick: 1 }; } };
    const ingress = new SimCommandIngress({ planets: planets as never, flags: { gate: () => null }, registry: new Registry(), production: false, rateLimit: { perSecond: 1, burst: 3, now: () => 0 } });
    const codes: Array<string | undefined> = [];
    for (let i = 0; i < 5; i++) {
      ingress.handle(
        { playerId: 'p', planetId: 'pl', reply: (m) => codes.push((m as { t: string; d: { code?: string } }).d.code ?? (m as { t: string }).t) },
        { v: 1, t: 'cmd', id: `cm_${i}`, d: { kind: 'dev.ping', args: {} } } as never,
      );
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(submitted).toHaveLength(3);
    expect(codes.filter((c) => c === 'rate_limited')).toHaveLength(2);
  });
});
