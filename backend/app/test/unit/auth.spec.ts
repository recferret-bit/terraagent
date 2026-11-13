import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Controller, Get, type INestApplication, Module, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthResponseSchema } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import {
  AuthRepository,
  AuthTokenService,
  type AuthenticatedRequest,
  BearerAuthGuard,
  CurrentPlayer,
  type AuthenticatedPlayer,
  formatRefreshCookie,
  resolveCookieDomain,
} from '../../src/core/auth';

const coreOnlyDir = fileURLToPath(new URL('../core/fixtures/base/', import.meta.url));

@Controller('test-protected')
class ProtectedController {
  @Get()
  @UseGuards(BearerAuthGuard)
  me(@Req() req: AuthenticatedRequest, @CurrentPlayer() player: AuthenticatedPlayer) {
    return { fromReq: req.player, fromDecorator: player };
  }
}

@Module({ controllers: [ProtectedController] })
class ProtectedTestModule {}

let currentApp: INestApplication | undefined;

async function bootAuthApp() {
  const created = await createApp({
    source: { NODE_ENV: 'test', JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef' },
    modulesDirs: [coreOnlyDir],
  });
  await created.app.listen(0, '127.0.0.1');
  currentApp = created.app;
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

function extractCookieToken(setCookieHeader: string | null): string {
  expect(setCookieHeader).toBeTruthy();
  const match = /^ta_rt=([^;]*)/.exec(setCookieHeader!);
  expect(match).toBeTruthy();
  return match![1]!;
}

afterEach(async () => {
  await currentApp?.close();
  currentApp = undefined;
});

describe('POST /v1/auth/guest (W01-02)', () => {
  it('creates a player row, returns accessToken in body without refreshToken, and sets HttpOnly ta_rt cookie', async () => {
    const { app, url } = await bootAuthApp();
    const repo = app.get(AuthRepository);
    const tokenSvc = app.get(AuthTokenService);

    const res = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'device-secret-alpha-0001' }),
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('ta_rt=rt_');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/v1/auth');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=2592000');

    const rawBody = (await res.json()) as Record<string, unknown>;
    expect(rawBody).not.toHaveProperty('refreshToken');
    expect(rawBody).not.toHaveProperty('ta_rt');

    const parsed = AuthResponseSchema.parse(rawBody);
    expect(parsed.expiresIn).toBe(900);
    expect(parsed.player.isGuest).toBe(true);
    expect(parsed.player.id).toMatch(/^pr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(parsed.player.handle).toBe(`Colonist-${parsed.player.id.slice(-4)}`);

    const claims = tokenSvc.verifyAccessToken(parsed.accessToken);
    expect(claims.sub).toBe(parsed.player.id);
    expect(claims.handle).toBe(parsed.player.handle);

    const players = await repo.listPlayers();
    expect(players).toHaveLength(1);
    expect(players[0]?.id).toBe(parsed.player.id);
  });

  it('returns the same player.id when called again with the same deviceSecret', async () => {
    const { app, url } = await bootAuthApp();
    const repo = app.get(AuthRepository);
    const secret = 'device-secret-repeat-9999';

    const r1 = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: secret, handle: 'CommanderVega' }),
    });
    const b1 = AuthResponseSchema.parse(await r1.json());
    expect(b1.player.handle).toBe('CommanderVega');

    const r2 = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: secret }),
    });
    const b2 = AuthResponseSchema.parse(await r2.json());

    expect(b2.player.id).toBe(b1.player.id);
    expect(b2.player.handle).toBe('CommanderVega');
    expect(await repo.listPlayers()).toHaveLength(1);
  });
});

describe('POST /v1/auth/refresh & /v1/auth/logout (W01-02)', () => {
  it('rotates the ta_rt cookie, returns a valid accessToken, and rejects old rotated token', async () => {
    const { app, url } = await bootAuthApp();
    const tokenSvc = app.get(AuthTokenService);

    const loginRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'device-secret-refresh-1234' }),
    });
    const loginBody = AuthResponseSchema.parse(await loginRes.json());
    const rt1 = extractCookieToken(loginRes.headers.get('set-cookie'));

    const refreshRes = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${rt1}` },
    });
    expect(refreshRes.status).toBe(200);
    const rt2 = extractCookieToken(refreshRes.headers.get('set-cookie'));
    expect(rt2).not.toBe(rt1);
    expect(rt2).toMatch(/^rt_[0-9a-f]{32}$/);

    const refreshBody = AuthResponseSchema.parse(await refreshRes.json());
    expect(refreshBody.player.id).toBe(loginBody.player.id);
    const verified = tokenSvc.verifyAccessToken(refreshBody.accessToken);
    expect(verified.sub).toBe(loginBody.player.id);

    const reuseRes = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${rt1}` },
    });
    expect(reuseRes.status).toBe(401);
  });

  it('revokes the refresh session on logout, clears the cookie, and rejects subsequent refresh', async () => {
    const { url } = await bootAuthApp();

    const loginRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'device-secret-logout-5678' }),
    });
    const rt = extractCookieToken(loginRes.headers.get('set-cookie'));

    const logoutRes = await fetch(`${url}/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${rt}` },
    });
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });

    const clearCookie = logoutRes.headers.get('set-cookie');
    expect(clearCookie).toContain('ta_rt=;');
    expect(clearCookie).toContain('HttpOnly');
    expect(clearCookie).toContain('Max-Age=0');

    const afterLogout = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${rt}` },
    });
    expect(afterLogout.status).toBe(401);
  });

  it('rejects short deviceSecret, unknown fields, and missing cookie on refresh', async () => {
    const { url } = await bootAuthApp();

    const shortRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'too-short' }),
    });
    expect(shortRes.status).toBe(400);

    const extraRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'valid-device-secret-1234', extra: true }),
    });
    expect(extraRes.status).toBe(400);

    const noCookieRefresh = await fetch(`${url}/v1/auth/refresh`, { method: 'POST' });
    expect(noCookieRefresh.status).toBe(401);
  });
});

describe('AuthTokenService & BearerAuthGuard (W01-02)', () => {
  it('rejects expired or tampered tokens and populates req.player in BearerAuthGuard', () => {
    const tokenSvc = new AuthTokenService('unit-test-hmac-secret-key-123456');
    const valid = tokenSvc.signAccessToken({ sub: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Pilot' }, 900);
    const claims = tokenSvc.verifyAccessToken(valid);
    expect(claims.sub).toBe('pr_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(claims.handle).toBe('Pilot');
    expect(claims.exp - claims.iat).toBe(900);

    const expired = tokenSvc.signAccessToken({ sub: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Pilot' }, -5);
    expect(() => tokenSvc.verifyAccessToken(expired)).toThrow(UnauthorizedException);

    const [h, p, s] = valid.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'pr_HACKED', handle: 'Admin', iat: claims.iat, exp: claims.exp })).toString('base64url');
    expect(() => tokenSvc.verifyAccessToken(`${h}.${tamperedPayload}.${s}`)).toThrow(UnauthorizedException);
    expect(() => tokenSvc.verifyAccessToken(`${h}.${p}.${s}x`)).toThrow(UnauthorizedException);

    const otherSvc = new AuthTokenService('different-secret-key-9876543210');
    expect(() => otherSvc.verifyAccessToken(valid)).toThrow(UnauthorizedException);

    const guard = new BearerAuthGuard(tokenSvc);
    const req: { headers: Record<string, string>; player?: AuthenticatedPlayer } = {
      headers: { authorization: `Bearer ${valid}` },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as Parameters<BearerAuthGuard['canActivate']>[0];
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.player).toEqual({ id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Pilot' });

    const badCtx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as Parameters<BearerAuthGuard['canActivate']>[0];
    expect(() => guard.canActivate(badCtx)).toThrow(UnauthorizedException);
    expect(ProtectedTestModule).toBeDefined();
    expect(resolveCookieDomain('terraagent.fun')).toBe('.terraagent.fun');
    expect(resolveCookieDomain('play.terraagent.fun')).toBe('.terraagent.fun');
    expect(resolveCookieDomain('127.0.0.1:3000')).toBeUndefined();
    expect(formatRefreshCookie('rt_1', true, resolveCookieDomain('play.terraagent.fun'))).toContain('Domain=.terraagent.fun; Secure');
  });
});
