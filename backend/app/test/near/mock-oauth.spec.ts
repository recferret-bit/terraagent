import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { NearException } from '../../src/near/domain/errors';
import { mockOauthSecret, signMockToken, verifyMockToken } from '../../src/near/identity/mock-token';

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
