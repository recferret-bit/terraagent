import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { SocialAuthResponseSchema } from '@terra/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { mockOauthSecret, signMockToken } from '../../src/near/identity/mock-token';

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
