/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthTokenService } from '../../src/core/auth/index.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import { Exchange, ord } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

/** A real session (what mock-oauth issues): a player row and an access token, no colony anywhere. */
async function freshSession(handle: string): Promise<string> {
  const id = `pr_${handle.replace(/[^a-z0-9]/gi, '').toUpperCase().padEnd(26, 'X').slice(0, 26)}`;
  await ex.prisma.player.upsert({ where: { id }, create: { id, handle }, update: {} });
  return ex.app.get(AuthTokenService).signAccessToken({ sub: id, handle });
}

const call = async (method: string, path: string, token: string | null, body?: unknown, as?: string) => {
  const q = as ? `${path.includes('?') ? '&' : '?'}as=${as}` : '';
  const r = await fetch(`${ex.url}/v1${path}${q}`, {
    method, headers: { 'content-type': 'application/json', 'idempotency-key': `k${Math.random().toString(36).slice(2)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

describe('a session without a colony is never seated on colony 0', () => {
  it('a mock-oauth style identity gets no_colony (409) on trade routes and an anonymous market snapshot', async () => {
    const w = ex.world();
    const a = await w.player({ idx: 0, name: 'alpha' });
    await a.fund('USDC', 5_000_000n);
    const token = await freshSession('e2e-ui-human');
    const q = `planetId=${w.planetId}`;
    for (const [m, p, b] of [['GET', `/trade/balances?${q}`], ['GET', `/trade/orders?${q}`], ['GET', `/trade/fills?${q}`], ['GET', `/trade/stall?${q}`], ['PUT', '/trade/stall', { bp: 40, planetId: w.planetId }],
      ['POST', '/trade/orders', { ...ord('sell', 1, 100_000), planetId: w.planetId }], ['GET', `/trade/stream?${q}`]] as const) {
      const r = await call(m, p, token, b);
      expect([m, p, r.status, r.body.error?.code]).toEqual([m, p, 409, 'no_colony']);
    }
    const snap = await call('GET', `/market/${w.planetId}`, token);
    expect(snap.status).toBe(200);
    expect(snap.body.balances).toBeUndefined();
    expect(snap.body.orders).toBeUndefined();
    const own = await call('GET', `/market/${w.planetId}`, null, undefined, 'alpha');
    expect(own.status).toBe(200);
  });

  it('explicit dev scenario identities (?as=<name>, dev:<name>) keep the seat-0 fallback', async () => {
    const w = ex.world();
    const viaAs = await call('GET', `/trade/balances?planetId=${w.planetId}`, null, undefined, 'ghost1');
    expect(viaAs.status, JSON.stringify(viaAs.body)).toBe(200);
    const viaDev = await call('GET', `/trade/balances?planetId=${w.planetId}`, 'dev:ghost2');
    expect(viaDev.status, JSON.stringify(viaDev.body)).toBe(200);
    expect(devPlayerId('ghost1')).not.toBe(devPlayerId('ghost2'));
  });
});
