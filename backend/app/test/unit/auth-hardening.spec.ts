import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { AuthRepository, AuthService, AuthTokenService } from '../../src/core/auth';
import { HomeRepository } from '../../src/core/home/home.repository';
import { JwtSessionVerifier } from '../../src/ws/session-verifier';

const coreOnlyDir = fileURLToPath(new URL('../core/fixtures/base/', import.meta.url));
let current: INestApplication | undefined;
afterEach(async () => { await current?.close(); current = undefined; });

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({ source: { NODE_ENV: 'test', JWT_ACCESS_SECRET: 'auth-hardening-jwt-secret-012345', ...extra }, modulesDirs: [coreOnlyDir] });
  await created.app.listen(0, '127.0.0.1');
  current = created.app;
  return { app: created.app, url: (await created.app.getUrl()).replace('[::1]', '127.0.0.1') };
}
const guest = (url: string, body: object) => fetch(`${url}/v1/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /^ta_rt=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')![1]!;
const refresh = (url: string, rt: string) => fetch(`${url}/v1/auth/refresh`, { method: 'POST', headers: { cookie: `ta_rt=${rt}` } });

describe('handles (BE-02)', () => {
  it('a taken handle is retried with a suffix against the store, never dropped to memory', async () => {
    const repo = new AuthRepository(); // memory store: the same unique rules as the database
    const a = await repo.createPlayer({ id: 'pr_a', handle: 'Taken', deviceSecretHash: 'h_a' });
    const b = await repo.createPlayer({ id: 'pr_b', handle: 'Taken', deviceSecretHash: 'h_b' });
    expect(a.handle).toBe('Taken');
    expect(b.handle).toMatch(/^Taken-[0-9A-F]{4}$/);
    expect((await repo.listPlayers()).map((p) => p.id).sort()).toEqual(['pr_a', 'pr_b']);
  });

  it('a device secret registered meanwhile returns that player (two first logins at once)', async () => {
    const repo = new AuthRepository();
    const first = await repo.createPlayer({ id: 'pr_1', handle: 'One', deviceSecretHash: 'same' });
    expect(await repo.createPlayer({ id: 'pr_2', handle: 'Two', deviceSecretHash: 'same' })).toBe(first);
  });
});

describe('database errors propagate (BE-03)', () => {
  const failing = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('db down'); } }) });
  const env = { NODE_ENV: 'development' } as never;

  it('the auth and home repositories answer a database error with that error, not a memory fallback', async () => {
    const auth = new AuthRepository(failing as never, env);
    await expect(auth.findPlayerById('pr_x')).rejects.toThrow('db down');
    await expect(auth.createPlayer({ id: 'pr_x', handle: 'X', deviceSecretHash: null })).rejects.toThrow('db down');
    await expect(auth.revokeSessionIfActive('as_x')).rejects.toThrow('db down');
    const home = new HomeRepository(failing as never, env);
    await expect(home.findLatestColonyByPlayerId('pr_x')).rejects.toThrow('db down');
    await expect(home.setColonyStatus('col_x', 'ELIMINATED')).rejects.toThrow('db down');
  });
});

describe('refresh rotation (BE-04)', () => {
  it('two concurrent refreshes with one cookie: one rotates, the other is reuse and revokes every session', async () => {
    const { app, url } = await boot();
    const login = await guest(url, { deviceSecret: 'refresh-race-device-0001' });
    const rt = cookieOf(login);
    const [a, b] = await Promise.all([refresh(url, rt), refresh(url, rt)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const sessions = await app.get(AuthRepository).listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true); // reuse revoked the fresh session too
    const winner = a.status === 200 ? a : b;
    expect((await refresh(url, cookieOf(winner))).status).toBe(401);
  });

  it('presenting a rotated token later revokes the session that replaced it', async () => {
    const { url } = await boot();
    const rt1 = cookieOf(await guest(url, { deviceSecret: 'refresh-reuse-device-0001' }));
    const r2 = await refresh(url, rt1);
    expect(r2.status).toBe(200);
    expect((await refresh(url, rt1)).status).toBe(401);
    expect((await refresh(url, cookieOf(r2))).status).toBe(401);
  });

  it('expired sessions are deleted (at most hourly, from a login)', async () => {
    const repo = new AuthRepository();
    const svc = new AuthService(repo, new AuthTokenService('prune-test-secret-0123456789'));
    await repo.createPlayer({ id: 'pr_old', handle: 'Old', deviceSecretHash: null });
    await repo.createSession({ id: 'as_old', playerId: 'pr_old', refreshTokenHash: 'x', expiresAt: new Date(Date.now() - 1000) });
    await svc.guestLogin({ deviceSecret: 'prune-device-secret-0001' });
    expect((await repo.listSessions()).map((s) => s.id)).not.toContain('as_old');
    expect(await repo.listSessions()).toHaveLength(1);
  });
});

describe('per-IP throttle of guest sign-up and /me/home (BE-05)', () => {
  it('answers 429 rate_limited over AUTH_RATE_PER_MIN', async () => {
    const { url } = await boot({ AUTH_RATE_PER_MIN: '2' });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await guest(url, {})).status);
    expect(codes).toEqual([200, 200, 429]);
    const body = (await (await guest(url, {})).json()) as { errorCode: string; error: { code: string } };
    expect([body.errorCode, body.error.code]).toEqual(['TOO_MANY_REQUESTS', 'rate_limited']);
  });
});

describe('dev session tokens in production (BE-23)', () => {
  it('JwtSessionVerifier refuses dev: tokens in production and marks them dev outside it', async () => {
    const tokens = { verify: async () => ({ playerId: 'pr_jwt', handle: 'J', exp: 1 }) };
    await expect(new JwtSessionVerifier(tokens, true).verify('dev:alice')).rejects.toThrow(/disabled in production/);
    expect(await new JwtSessionVerifier(tokens, false).verify('dev:alice')).toMatchObject({ dev: true });
    expect(await new JwtSessionVerifier(tokens, false).verify('jwt')).toEqual({ playerId: 'pr_jwt', handle: 'J', exp: 1 });
  });
});
