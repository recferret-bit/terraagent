import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { EnvError } from '@terra/config';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type CreateAppOptions } from '../../src/app';
import { ReadinessRegistry } from '../../src/core/readiness.registry';
import { MetricsRegistry } from '../../src/core/metrics.registry';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/modules/', import.meta.url));

let current: INestApplication | undefined;
async function boot(source: Record<string, string> = {}, o: CreateAppOptions = {}) {
  const created = await createApp({ source: { NODE_ENV: 'test', ...source }, modulesDirs: [srcDir], ...o });
  await created.app.listen(0, '127.0.0.1');
  current = created.app;
  const url = await created.app.getUrl();
  return { ...created, url: url.replace('[::1]', '127.0.0.1') };
}
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('health, readiness, metrics', () => {
  it('healthz is ok', async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/v1/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('readyz reports registered checks (acceptance shape)', async () => {
    const { app, url } = await boot();
    const reg = app.get(ReadinessRegistry);
    reg.register('db', async () => 'ok');
    reg.register('simThreads', () => 1);
    const r = await fetch(`${url}/v1/readyz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ db: 'ok', simThreads: 1 });
  });

  it('readyz is 503 and marks the failing check', async () => {
    const { app, url } = await boot();
    const reg = app.get(ReadinessRegistry);
    reg.register('db', async () => {
      throw new Error('connection refused');
    });
    reg.register('simThreads', () => 1);
    const r = await fetch(`${url}/v1/readyz`);
    expect(r.status).toBe(503);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.simThreads).toBe(1);
    expect(body.db).toEqual({ status: 'fail', error: 'connection refused' });
  });

  it('readyz with no checks is 200 {}', async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/v1/readyz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({});
  });

  it('metrics is Prometheus text with app info, default metrics and module metrics', async () => {
    const { app, url } = await boot();
    const { Counter } = await import('prom-client');
    new Counter({ name: 'ta_test_total', help: 't', registers: [app.get(MetricsRegistry).registry] }).inc(3);
    const r = await fetch(`${url}/v1/metrics`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    const text = await r.text();
    expect(text).toMatch(/ta_app_info\{version="[^"]+"\} 1/);
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('ta_test_total 3');
  });
});

describe('CORS', () => {
  const get = (url: string, origin: string) => fetch(`${url}/v1/healthz`, { headers: { Origin: origin } });

  it('allows listed origins and loopback outside production, denies others', async () => {
    const { url } = await boot({ CORS_ORIGINS: 'https://game.example.com, https://example.com' });
    expect((await get(url, 'https://game.example.com')).headers.get('access-control-allow-origin')).toBe('https://game.example.com');
    expect((await get(url, 'http://localhost:5173')).headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect((await get(url, 'http://127.0.0.1:9')).headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:9');
    expect((await get(url, 'https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('denies loopback in production', async () => {
    const { url } = await boot({ NODE_ENV: 'production', CORS_ORIGINS: 'https://example.com' });
    expect((await get(url, 'http://localhost:5173')).headers.get('access-control-allow-origin')).toBeNull();
    expect((await get(url, 'https://example.com')).headers.get('access-control-allow-origin')).toBe('https://example.com');
  });
});

describe('module discovery and env', () => {
  it('picks up modules from every dir, skips folders without a module file, merges their env', async () => {
    const { url, modules } = await boot({ PROBE_FLAG: 'on' }, { modulesDirs: [srcDir, fixtures] });
    expect(modules).toEqual(['bus', 'core', 'probe']);
    expect(await (await fetch(`${url}/v1/probe`)).json()).toEqual({ flag: 'on' });
  });

  it('boot fails naming a bad variable, including a module-owned one', async () => {
    await expect(createApp({ source: { PORT: 'abc' }, modulesDirs: [srcDir] })).rejects.toThrow(/PORT/);
    const err = await createApp({ source: { PROBE_FLAG: 'maybe' }, modulesDirs: [srcDir, fixtures] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvError);
    expect((err as Error).message).toContain('PROBE_FLAG');
  });
});
