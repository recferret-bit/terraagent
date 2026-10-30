import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { CoreException, CoreNotFound } from '../../src/core/errors/core-exception';
import { restCodeFor } from '../../src/core/errors/map-error';
import { bootCapturing } from './logging-helpers';

let current: INestApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});
async function boot(source: Record<string, string> = {}) {
  const b = await bootCapturing(source);
  current = b.app;
  return b;
}

describe('CoreException', () => {
  it('is framework-free with defaults and subclasses', () => {
    const e = new CoreException('X_Y');
    expect([e.errorCode, e.status, e.message, e.name]).toEqual(['X_Y', 400, 'X_Y', 'CoreException']);
    expect(new CoreNotFound('NO_PLANET').status).toBe(404);
    expect(new CoreException('A', { cause: 'c' }).cause).toBe('c');
  });
  it('maps status to REST code', () => {
    expect([restCodeFor(400), restCodeFor(404), restCodeFor(418), restCodeFor(500)]).toEqual(['validation_error', 'not_found', 'validation_error', 'internal']);
  });
});

describe('error responses', () => {
  it('CoreException: status, JSON errorCode, one structured log line (acceptance)', async () => {
    const { url, lines } = await boot();
    const r = await fetch(`${url}/v1/_test/throw`, { headers: { 'x-request-id': 'req-123' } });
    const body = await r.json();
    console.log('ACCEPTANCE response', r.status, JSON.stringify(body));
    console.log('ACCEPTANCE log', JSON.stringify(lines));
    expect(r.status).toBe(418);
    expect(r.headers.get('x-request-id')).toBe('req-123');
    expect(body).toEqual({ errorCode: 'TEST_CODE', error: { code: 'validation_error', message: 'teapot', details: { a: 1 } }, requestId: 'req-123' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, layer: 'http', errorCode: 'TEST_CODE', status: 418, requestId: 'req-123', method: 'GET', path: '/v1/_test/throw' });
  });

  it('generates a request id when none is sent', async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/v1/_test/throw`);
    const body = (await r.json()) as { requestId: string };
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('zod DTO pipe: 400 VALIDATION_ERROR with flattened issues', async () => {
    const { url, lines } = await boot();
    const r = await fetch(`${url}/v1/_test/dto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) });
    const body = (await r.json()) as { errorCode: string; error: { code: string; details: { fieldErrors: Record<string, string[]> } } };
    expect(r.status).toBe(400);
    expect(body.errorCode).toBe('VALIDATION_ERROR');
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.fieldErrors.name).toBeTruthy();
    expect(lines).toHaveLength(1);
    const ok = await fetch(`${url}/v1/_test/dto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'a' }) });
    expect(await ok.json()).toEqual({ ok: true, name: 'a' });
  });

  it('unknown route: http 404 envelope', async () => {
    const { url, lines } = await boot();
    const r = await fetch(`${url}/v1/nope`);
    const body = (await r.json()) as Record<string, unknown>;
    expect(r.status).toBe(404);
    expect(body).toMatchObject({ errorCode: 'NOT_FOUND', error: { code: 'not_found' } });
    expect(typeof body.requestId).toBe('string');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, status: 404 });
  });

  it('prisma P2002 duck-typed to 409 CONFLICT', async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/v1/_test/prisma`);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ errorCode: 'CONFLICT' });
  });

  it('unknown error: 500 INTERNAL hides the message in production, shows it in test; logs at error level', async () => {
    const prod = await boot({ NODE_ENV: 'production', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' });
    const r = await fetch(`${prod.url}/v1/_test/boom`);
    const text = await r.text();
    expect(r.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'INTERNAL', error: { code: 'internal', message: 'Internal server error' } });
    expect(text).not.toContain('secret');
    expect(prod.lines).toHaveLength(1);
    expect(prod.lines[0]).toMatchObject({ level: 50, errorCode: 'INTERNAL' });
    await prod.app.close();
    const dev = await boot();
    const body = (await (await fetch(`${dev.url}/v1/_test/boom`)).json()) as { error: { message: string } };
    expect(body.error.message).toContain('secret');
  });
});
