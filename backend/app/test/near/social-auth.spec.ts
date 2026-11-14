import 'reflect-metadata';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SocialAuthResponseSchema } from '@terra/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { AuthRepository, AuthTokenService } from '../../src/core/auth';
import { mockOauthSecret, signMockToken } from '../../src/near/identity/mock-token';

const DEV = {
  NODE_ENV: 'test',
  SIM_THREADS: '1',
  JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
  LOG_LEVEL: 'silent',
};

const apps: INestApplication[] = [];
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

async function boot(extra: Record<string, string> = {}) {
  const { app } = await createApp({ source: { ...DEV, ...extra } });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { url };
}

/** Flip the first signature byte and re-encode so the token still parses as `payload.sig`. */
function flipSignatureByte(token: string): string {
  const dot = token.indexOf('.');
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const first = sig[0] ?? 0;
  sig[0] = (first ^ 0xff) & 0xff;
  return `${token.slice(0, dot)}.${sig.toString('base64url')}`;
}

function postSocial(url: string, token: string) {
  return fetch(`${url}/v1/auth/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'google', token }),
  });
}

function pilotToken(): string {
  return signMockToken(
    { provider: 'google', subject: 'test-pilot', exp: Math.floor(Date.now() / 1000) + 60 },
    mockOauthSecret(),
  );
}

describe('POST /v1/auth/social', () => {
  it('accepts a mock token, reuses the player, and rejects a flipped signature', async () => {
    const { url } = await boot();
    const token = pilotToken();
    const res = await postSocial(url, token);
    expect(res.status).toBe(200);
    const body = SocialAuthResponseSchema.parse(await res.json());
    expect(body.accountId).toBe('test-pilot.terraagent.mock');
    expect(body.player.isGuest).toBe(false);
    expect(body.accessToken.length).toBeGreaterThan(0);
    expect(res.headers.get('set-cookie')).toContain('ta_rt=');

    const again = await postSocial(url, token);
    expect(again.status).toBe(200);
    const body2 = SocialAuthResponseSchema.parse(await again.json());
    expect(body2.player.id).toBe(body.player.id);
    expect(body2.accountId).toBe(body.accountId);

    const bad = await postSocial(url, flipSignatureByte(token));
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { errorCode: string }).errorCode).toBe('NEAR_PROVIDER_REJECTED');
  });

  it('is 404 when TA_WAVES=..05 (W06 off)', async () => {
    const { url } = await boot({ TA_WAVES: '..05' });
    const res = await postSocial(url, pilotToken());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe('NOT_FOUND');
  });
});

describe('POST /v1/auth/social (Auth0 PKCE profile naming & provider guard)', () => {
  it('derives readable handle & NEAR account from Auth0 PKCE claims, heals legacy google-oauth2-* handles, and blocks Google-under-X SSO mixups', async () => {
    const { app } = await createApp({ source: { ...DEV } });
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'auth0-kid-1', alg: 'RS256' };
    const signIdToken = (claims: Record<string, unknown>): string => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'auth0-kid-1' })).toString('base64url');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signer = createSign('RSA-SHA256');
      signer.update(`${h}.${p}`);
      return `${h}.${p}.${signer.sign(privateKey).toString('base64url')}`;
    };

    const googleJwt = signIdToken({
      iss: 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/',
      aud: 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL',
      sub: 'google-oauth2|106920817337195603999',
      email: 'recferret@gmail.com',
      nickname: 'recferret',
      name: 'Andrey Sokolov',
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (href === 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/oauth/token') {
        return new Response(JSON.stringify({ id_token: googleJwt }), { status: 200 });
      }
      if (href === 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/.well-known/jwks.json') {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      return realFetch(input, init);
    }));

    const pkceToken = 'fastauth-code:code123:verifier123:https%3A%2F%2Fterraagent.fun%2Flanding.html';

    // Cross-provider SSO mixup (Google token sent under provider='x') must be rejected:
    const mismatchRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'x', token: pkceToken }),
    });
    expect(mismatchRes.status).toBe(401);
    expect(((await mismatchRes.json()) as { errorCode: string }).errorCode).toBe('NEAR_PROVIDER_REJECTED');

    // Valid Google login gets clean handle & NEAR account name (not google-oauth2-106920817337195603):
    const okRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', token: pkceToken }),
    });
    expect(okRes.status).toBe(200);
    const linked = SocialAuthResponseSchema.parse(await okRes.json());
    expect(linked.player.handle).toBe('recferret');
    expect(linked.accountId).toBe('recferret.terraagent.mock');

    // Simulate a legacy player row stuck with handle `google-oauth2-106920817337195603`, then re-login:
    const authRepo = app.get(AuthRepository);
    await authRepo.updatePlayerHandle(linked.player.id, 'google-oauth2-106920817337195603');
    const healedRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', token: pkceToken }),
    });
    expect(healedRes.status).toBe(200);
    const healed = SocialAuthResponseSchema.parse(await healedRes.json());
    expect(healed.player.id).toBe(linked.player.id);
    expect(healed.player.handle).toBe('recferret');
  });
});

describe('POST /v1/auth/social with expired or stale guest Authorization bearer', () => {
  it('gracefully ignores an expired guest JWT instead of throwing 401 while upgrading valid guest JWTs', async () => {
    const { app } = await createApp({ source: { ...DEV } });
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    const tokens = app.get(AuthTokenService);
    const guestRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(guestRes.status).toBe(200);
    const guestBody = (await guestRes.json()) as { accessToken: string; player: { id: string; handle: string } };
    const guest = guestBody.player;

    const expiredGuestJwt = tokens.signAccessToken({ sub: guest.id, handle: guest.handle }, -60);
    const expiredLoginToken = signMockToken(
      { provider: 'google', subject: 'expired-bearer-pilot', exp: Math.floor(Date.now() / 1000) + 60 },
      mockOauthSecret(),
    );
    const expiredRes = await fetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${expiredGuestJwt}`,
      },
      body: JSON.stringify({ provider: 'google', token: expiredLoginToken }),
    });
    expect(expiredRes.status).toBe(200);
    const expiredBody = SocialAuthResponseSchema.parse(await expiredRes.json());
    expect(expiredBody.player.isGuest).toBe(false);
    expect(expiredBody.player.id).not.toBe(guest.id);

    // Valid non-expired guest JWT still upgrades the guest player in place:
    const validGuestJwt = tokens.signAccessToken({ sub: guest.id, handle: guest.handle }, 600);
    const upgradeToken = signMockToken(
      { provider: 'google', subject: 'upgraded-guest-pilot', exp: Math.floor(Date.now() / 1000) + 60 },
      mockOauthSecret(),
    );
    const upgradeRes = await fetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validGuestJwt}`,
      },
      body: JSON.stringify({ provider: 'google', token: upgradeToken }),
    });
    expect(upgradeRes.status).toBe(200);
    const upgradedBody = SocialAuthResponseSchema.parse(await upgradeRes.json());
    expect(upgradedBody.player.id).toBe(guest.id);
    expect(upgradedBody.player.isGuest).toBe(false);

    // Non-expired JWT whose guest player ID no longer exists (e.g. server restarted in memory) creates a new player instead of 401:
    const orphanGuestJwt = tokens.signAccessToken({ sub: 'pr_vanished_guest', handle: 'ghost' }, 600);
    const orphanToken = signMockToken(
      { provider: 'google', subject: 'orphan-bearer-pilot', exp: Math.floor(Date.now() / 1000) + 60 },
      mockOauthSecret(),
    );
    const orphanRes = await fetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${orphanGuestJwt}`,
      },
      body: JSON.stringify({ provider: 'google', token: orphanToken }),
    });
    expect(orphanRes.status).toBe(200);
    const orphanBody = SocialAuthResponseSchema.parse(await orphanRes.json());
    expect(orphanBody.player.isGuest).toBe(false);
    expect(orphanBody.player.id).not.toBe('pr_vanished_guest');
  });
});
