import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import { MarketCallers } from '../../src/market/api/market-caller.js';
import { OrderExpirySweep } from '../../src/market/orders/expiry-sweep.js';
import { TokenBucketLimiter } from '../../src/core/token-bucket.js';
import { colonyRef } from '../../src/market/trade/trade-book-orders.js';
import { isOrganicFill } from '../../src/market/settlement/organic.js';
import { TradeAuth } from '../../src/market/trade/trade-auth.js';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress.js';

const root = resolve(import.meta.dirname, '../../../..');

describe('review: one failing order must not starve the expiry sweep', () => {
  it('keeps expiring the other due orders', async () => {
    const due = (id: string) => ({ orderId: id, planetId: 'p', createdAt: new Date(0), ttlS: 1, expiresAt: new Date(1) });
    const release = { release: vi.fn(async (id: string) => { if (id === 'bad') throw new Error('boom'); return { kind: 'released' as const }; }) };
    const prisma = { marketOrder: { findMany: async () => [due('bad'), due('a'), due('b')] } };
    const clock = { warpedPlanets: () => [], gameMsBetween: () => 0 };
    const sweep = new OrderExpirySweep(release as never, clock as never, prisma as never, { NODE_ENV: 'test' } as never, {} as never);
    expect(await sweep.sweep(10_000)).toEqual(['a', 'b']);
  });
});

describe('review: dev identities are ignored in production', () => {
  const callers = (NODE_ENV: string) => new MarketCallers({ verify: () => { throw new Error('bad token'); } } as never, {} as never, { NODE_ENV } as never);
  const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as never;
  it('?as=<name> is not an identity in production, is one in dev', () => {
    expect(callers('production').playerOf(req(), 'alice')).toBeNull();
    expect(callers('development').playerOf(req(), 'alice')).toMatch(/^pr_/);
  });
  it('a dev: bearer is refused (not mapped to a player) in production', () => {
    expect(() => callers('production').playerOf(req('Bearer dev:alice'))).toThrow();
    expect(callers('test').playerOf(req('Bearer dev:alice'))).toMatch(/^pr_/);
  });
});

describe('review: the WS host sets the command source from the channel, never from the payload', () => {
  it('a browser frame that carries source:"bot" is submitted as source "player" on the session colony', async () => {
    const submitted: Array<{ source?: string; colonyIndex: number | null }> = [];
    const planets = { submit: async (_p: string, c: { source?: string; colonyIndex: number | null }) => { submitted.push(c); return { ok: true, appliedAtTick: 1 }; }, isScenarioColonyPlanet: () => false };
    const ingress = new SimCommandIngress({
      planets: planets as never, flags: { gate: () => null }, registry: new Registry(), production: true,
      homeRepo: { findColonyByPlayerAndPlanet: async () => ({ id: 'co_1', playerId: 'pr_x', planetId: 'p', colonyIndex: 2, status: 'ACTIVE' }) as never },
    });
    const replies: unknown[] = [];
    const ctx = { playerId: 'pr_x', planetId: 'p', dev: false, reply: (m: unknown) => replies.push(m) } as never;
    const frame = { v: 1, t: 'cmd', id: 'c1', d: { kind: 'market.cancelOrder', args: { orderId: 'o1' }, source: 'bot', colonyIndex: 7 } };
    await ingress.handle(ctx, frame as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ source: 'player', colonyIndex: 2 });
  });
});

describe('review: the trade page never renders server text as markup and never stores a key secret', () => {
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [join(d, f)] : []));
  it('has no innerHTML-style sinks and no storage write of a secret', () => {
    for (const f of files(join(root, 'frontend/trade'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
      expect(src, f).not.toMatch(/(localStorage|sessionStorage)\.setItem\([^)]*secret/i);
      expect(src, f).not.toMatch(/console\.(log|info|debug)\([^)]*secret/i);
    }
  });
});

describe('review round 2: colonyRef is keyed by a server secret', () => {
  it('different secrets give different refs, one secret is stable', () => {
    expect(colonyRef('p', 'col_0', 's1')).toBe(colonyRef('p', 'col_0', 's1'));
    expect(colonyRef('p', 'col_0', 's1')).not.toBe(colonyRef('p', 'col_0', 's2'));
    expect(colonyRef('p', 'col_0', 's1')).not.toBe(colonyRef('p', 'col_1', 's1'));
  });
});

describe('review round 2: organic rule fails closed in production on an unknown owner', () => {
  const party = (owner: string | null, colony: string) => ({ actorKind: 'player', colonyId: colony, ownerId: owner });
  it('production: unknown owner is not organic; known different owners still are', () => {
    expect(isOrganicFill(party(null, 'c1'), party('o2', 'c2'), true)).toBe(false);
    expect(isOrganicFill(party('o1', 'c1'), party(null, 'c2'), true)).toBe(false);
    expect(isOrganicFill(party('o1', 'c1'), party('o2', 'c2'), true)).toBe(true);
  });
  it('non-production (dev scenario seats): unknown owner still counts as different', () => {
    expect(isOrganicFill(party(null, 'c1'), party('o2', 'c2'), false)).toBe(true);
  });
});

describe('review round 2: bounded per-IP throttles', () => {
  it('the limiter map never exceeds maxKeys', () => {
    const l = new TokenBucketLimiter({ perSecond: 1, burst: 1, maxKeys: 50 });
    for (let i = 0; i < 500; i++) l.take(`ip${i}`);
    expect((l as unknown as { buckets: Map<string, unknown> }).buckets.size).toBeLessThanOrEqual(50);
  });
  it('public reads are throttled per IP (req.ip first), other IPs are unaffected', () => {
    const auth = new TradeAuth({} as never, {} as never);
    const req = (ip: string) => ({ ip, headers: {} }) as never;
    let limited = 0;
    for (let i = 0; i < 200; i++) { try { auth.throttlePublic(req('1.1.1.1')); } catch { limited += 1; } }
    expect(limited).toBeGreaterThan(50);
    expect(() => auth.throttlePublic(req('2.2.2.2'))).not.toThrow();
  });
});
