import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { SocialAuthResponseSchema } from '@terra/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { NearException } from '../../src/near/domain/errors';
import { assertLocalhostRequest, assertLocalMockEnvAllowed } from '../../src/near/identity/local-mock-guard';
import { mockOauthSecret, signMockToken, verifyMockToken } from '../../src/near/identity/mock-token';
import { UNIT_APP_ENV } from '../unit-app-env';

const DEV = {
  NODE_ENV: 'test',
  SIM_THREADS: '1',
  JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
  LOG_LEVEL: 'silent',
};

const apps: INestApplication[] = [];
afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

async function boot(extra: Record<string, string> = {}) {
  const { app } = await createApp({ source: { ...DEV, ...extra } });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { url };
}

function postToken(url: string, body: unknown) {
  return fetch(`${url}/v1/dev/mock-oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Flip the first signature byte and re-encode so the token still parses as `payload.sig`. */
function flipSignatureByte(token: string): string {
  const dot = token.indexOf('.');
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const first = sig[0] ?? 0;
  sig[0] = (first ^ 0xff) & 0xff;
  return `${token.slice(0, dot)}.${sig.toString('base64url')}`;
}

describe('POST /v1/dev/mock-oauth/token', () => {
  it('signs test-pilot for google, and a flipped signature byte is 401 NEAR_PROVIDER_REJECTED', async () => {
    const prev = process.env.NEAR_ADAPTER_IDENTITY;
    delete process.env.NEAR_ADAPTER_IDENTITY;
    try {
      const { url } = await boot();
      const res = await postToken(url, { provider: 'google', subject: 'test-pilot' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      const now = Date.now();
      const secret = mockOauthSecret();
      expect(verifyMockToken(body.token, secret, now)).toMatchObject({ provider: 'google', subject: 'test-pilot' });

      let caught: unknown;
      try {
        verifyMockToken(flipSignatureByte(body.token), secret, now);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NearException);
      const err = caught as NearException;
      expect(err.status).toBe(401);
      expect(err.errorCode).toBe('NEAR_PROVIDER_REJECTED');
    } finally {
      if (prev === undefined) delete process.env.NEAR_ADAPTER_IDENTITY;
      else process.env.NEAR_ADAPTER_IDENTITY = prev;
    }
  });

  it('is 404 when TA_WAVES=..05 (W06 off)', async () => {
    const { url } = await boot({ TA_WAVES: '..05' });
    const res = await postToken(url, { provider: 'google', subject: 'test-pilot' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe('NOT_FOUND');
  });
});

describe('verifyMockToken', () => {
  it('throws NEAR_PROVIDER_REJECTED when exp is in the past', () => {
    const secret = 'unit-mock-oauth-secret';
    const token = signMockToken({ provider: 'google', subject: 'test-pilot', exp: 1_000 }, secret);
    expect(() => verifyMockToken(token, secret, 1_001_000)).toThrow(NearException);
    try {
      verifyMockToken(token, secret, 1_001_000);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NearException);
      expect((e as NearException).errorCode).toBe('NEAR_PROVIDER_REJECTED');
      expect((e as NearException).status).toBe(401);
    }
  });
});

function fakeReq(opts: {
  ip?: string;
  host?: string;
  origin?: string;
  referer?: string;
  xfh?: string;
  xff?: string;
  xri?: string;
  forwarded?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.host !== undefined) headers.host = opts.host;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.referer !== undefined) headers.referer = opts.referer;
  if (opts.xfh !== undefined) headers['x-forwarded-host'] = opts.xfh;
  if (opts.xff !== undefined) headers['x-forwarded-for'] = opts.xff;
  if (opts.xri !== undefined) headers['x-real-ip'] = opts.xri;
  if (opts.forwarded !== undefined) headers.forwarded = opts.forwarded;
  return {
    headers,
    socket: { remoteAddress: opts.ip ?? '127.0.0.1' },
  } as unknown as IncomingMessage;
}

describe('local-mock-guard (env & localhost request checks)', () => {
  it('allows development/test on non-mainnet and rejects production, staging, mainnet, and disabled toggle', () => {
    expect(() => assertLocalMockEnvAllowed({ NODE_ENV: 'development', NEAR_MODE: 'mock' })).not.toThrow();
    expect(() => assertLocalMockEnvAllowed({ NODE_ENV: 'test', NEAR_MODE: 'testnet' })).not.toThrow();
    expect(() => assertLocalMockEnvAllowed({ NODE_ENV: 'development', VITE_APP_ENV: 'local' })).not.toThrow();

    for (const bad of [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'staging' },
      {},
      { NODE_ENV: 'development', VITE_APP_ENV: 'production' },
      { NODE_ENV: 'development', VITE_APP_ENV: 'staging' },
      { NODE_ENV: 'development', NEAR_MODE: 'mainnet' },
      { NODE_ENV: 'development', NEAR_ADAPTER_IDENTITY: 'mainnet' },
      { NODE_ENV: 'development', TA_ALLOW_LOCAL_MOCK_AUTH: 'false' },
      { NODE_ENV: 'development', TA_ALLOW_LOCAL_MOCK_AUTH: '0' },
    ]) {
      expect(() => assertLocalMockEnvAllowed(bad)).toThrow();
    }
  });

  it('allows loopback IPs/hosts/origins and blocks non-localhost or spoofed proxy headers', () => {
    expect(() => assertLocalhostRequest(fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', origin: 'http://localhost:5173' }))).not.toThrow();
    expect(() => assertLocalhostRequest(fakeReq({ ip: '::1', host: '[::1]:4001', origin: 'http://127.0.0.1:5173' }))).not.toThrow();
    expect(() => assertLocalhostRequest(fakeReq({ ip: '::ffff:127.0.0.1', host: '127.0.0.1:4001' }))).not.toThrow();

    for (const bad of [
      fakeReq({ ip: '10.0.0.5', host: 'localhost:5173' }),
      fakeReq({ ip: '127.0.0.1', host: 'terraagent.fun' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost.evil.com:5173' }),
      fakeReq({ ip: '127.0.0.1', host: '127.0.0.1.nip.io' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', xfh: 'terraagent.fun' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', xff: '203.0.113.5' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', xff: '' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', xri: '10.0.0.2' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', forwarded: 'for=203.0.113.5;host=terraagent.fun' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', forwarded: 'proto=https' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', origin: 'https://terraagent.fun' }),
      fakeReq({ ip: '127.0.0.1', host: 'localhost:5173', referer: 'https://evil.example/login' }),
    ]) {
      expect(() => assertLocalhostRequest(bad)).toThrow();
    }
  });
});

describe('POST /v1/dev/mock-oauth/login', () => {
  it('creates/reuses player, upgrades guest only, works in NEAR_MODE=testnet, and enforces 400/403/404', async () => {
    const { url } = await boot({ ...UNIT_APP_ENV, NEAR_MODE: 'testnet', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' });
    const res1 = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Commander Nova', mode: 'signup' }),
    });
    expect(res1.status).toBe(200);
    const body1 = SocialAuthResponseSchema.parse(await res1.json());
    expect(body1.player.handle).toBe('Commander Nova');
    expect(body1.player.isGuest).toBe(false);
    expect(body1.accountId).toBe('commander-nova.terraagent.mock');
    expect(res1.headers.get('set-cookie')).toContain('ta_rt=');

    const res2 = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'commander nova', mode: 'signin' }),
    });
    expect(res2.status).toBe(200);
    const body2 = SocialAuthResponseSchema.parse(await res2.json());
    expect(body2.player.id).toBe(body1.player.id);
    expect(body2.player.handle).toBe('Commander Nova');

    // Sending an already-linked player bearer for a different mock player name must NOT overwrite the linked player:
    const otherRes = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${body1.accessToken}` },
      body: JSON.stringify({ playerName: 'Pilot Two' }),
    });
    expect(otherRes.status).toBe(200);
    const otherBody = SocialAuthResponseSchema.parse(await otherRes.json());
    expect(otherBody.player.id).not.toBe(body1.player.id);
    expect(otherBody.player.handle).toBe('Pilot Two');

    // Guest bearer upgrades in place:
    const guestRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const guestBody = (await guestRes.json()) as { accessToken: string; player: { id: string } };
    const upgRes = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${guestBody.accessToken}` },
      body: JSON.stringify({ playerName: 'Guest Upgraded' }),
    });
    expect(upgRes.status).toBe(200);
    const upgBody = SocialAuthResponseSchema.parse(await upgRes.json());
    expect(upgBody.player.id).toBe(guestBody.player.id);
    expect(upgBody.player.handle).toBe('Guest Upgraded');

    // Invalid name -> 400
    const badName = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'x' }),
    });
    expect(badName.status).toBe(400);

    // Spoofed Origin / X-Forwarded-Host -> 403
    const badOrigin = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://terraagent.fun' },
      body: JSON.stringify({ playerName: 'Spoofed' }),
    });
    expect(badOrigin.status).toBe(403);

    const badXfh = await fetch(`${url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'terraagent.fun' },
      body: JSON.stringify({ playerName: 'Spoofed' }),
    });
    expect(badXfh.status).toBe(403);

    // Disabled by W06 off or mainnet -> 404
    const offApp = await boot({ ...UNIT_APP_ENV, TA_WAVES: '..05' });
    const offRes = await fetch(`${offApp.url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Valid Pilot' }),
    });
    expect(offRes.status).toBe(404);

    const mainnetApp = await boot({ ...UNIT_APP_ENV, NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1', NEAR_ALLOW_MOCK_IN_PROD: 'true' });
    const mainRes = await fetch(`${mainnetApp.url}/v1/dev/mock-oauth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Valid Pilot' }),
    });
    expect(mainRes.status).toBe(404);
  });
});
