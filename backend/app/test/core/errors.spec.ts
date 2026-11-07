import type { ArgumentsHost, INestApplication } from '@nestjs/common';
import { REST_ERROR_CODES } from '@terra/contracts';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../../src/core/errors/all-exceptions.filter';
import { CoreConflict, CoreException, CoreNotFound } from '../../src/core/errors/core-exception';
import { restCodeFor } from '../../src/core/errors/map-error';
import { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';
import { InMemoryLedgerStore } from '../../src/game/ledger/in-memory-ledger-store';
import { LedgerStorePort } from '../../src/game/ledger/ledger-store.port';
import { bootCapturing, logsForRequest } from './logging-helpers';

let current: INestApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
  vi.restoreAllMocks();
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
  it('a domain code with its own REST code wins over the status: COLONY_SEAT_REJECTED → seat_rejected', () => {
    expect([restCodeFor(409, 'COLONY_SEAT_REJECTED'), restCodeFor(409, 'CONFLICT'), restCodeFor(409)]).toEqual(['seat_rejected', 'conflict', 'conflict']);
    expect(REST_ERROR_CODES).toContain('seat_rejected');
  });
  it('generic codes by status; only NEAR codes are near_unavailable (BE-17)', () => {
    expect([restCodeFor(503, 'LEDGER_UNAVAILABLE'), restCodeFor(503, 'HOME_UNAVAILABLE'), restCodeFor(503, 'NEAR_UNAVAILABLE'), restCodeFor(503, 'NEAR_MOCK_INJECTED_FAILURE')])
      .toEqual(['unavailable', 'unavailable', 'near_unavailable', 'near_unavailable']);
    expect([restCodeFor(413, 'PAYLOAD_TOO_LARGE'), restCodeFor(429, 'TOO_MANY_REQUESTS'), restCodeFor(409, 'NEAR_ESCROW_STATE')]).toEqual(['payload_too_large', 'rate_limited', 'conflict']);
    for (const s of [400, 401, 403, 404, 409, 413, 429, 500, 503]) expect(REST_ERROR_CODES).toContain(restCodeFor(s));
  });
  it('the filter answers a rejected seat with error.code seat_rejected and the sim code in details.code', () => {
    let sent: { status?: number; body?: unknown } = {};
    const res = { status: (status: number) => { sent = { ...sent, status }; return res; }, json: (body: unknown) => { sent = { ...sent, body }; } };
    const host = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ id: 'r1', method: 'GET', originalUrl: '/v1/me/home' }), getResponse: () => res }) };
    const seat = new CoreConflict('COLONY_SEAT_REJECTED', { message: 'refused', details: { code: 'landing_site_taken', planetId: 'pl_dev' } });
    new AllExceptionsFilter(pino({ level: 'silent' }), true).catch(seat, host as unknown as ArgumentsHost);
    expect(sent).toEqual({
      status: 409,
      body: { errorCode: 'COLONY_SEAT_REJECTED', error: { code: 'seat_rejected', message: 'refused', details: { code: 'landing_site_taken', planetId: 'pl_dev' } }, requestId: 'r1' },
    });
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
    const requestLines = logsForRequest(lines, r.headers.get('x-request-id'));
    expect(requestLines, JSON.stringify(lines)).toHaveLength(1);
    expect(requestLines[0]).toMatchObject({ level: 40, layer: 'http', errorCode: 'TEST_CODE', status: 418, requestId: 'req-123', method: 'GET', path: '/v1/_test/throw' });
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
    expect(logsForRequest(lines, r.headers.get('x-request-id')), JSON.stringify(lines)).toHaveLength(1);
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
    const requestLines = logsForRequest(lines, r.headers.get('x-request-id'));
    expect(requestLines, JSON.stringify(lines)).toHaveLength(1);
    expect(requestLines[0]).toMatchObject({ level: 40, layer: 'http', status: 404 });
  });

  it('prisma P2002 duck-typed to 409 CONFLICT', async () => {
    const { url } = await boot();
    const r = await fetch(`${url}/v1/_test/prisma`);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ errorCode: 'CONFLICT' });
  });

  it('unknown error: 500 INTERNAL hides the message in production, shows it in test; logs at error level', async () => {
    const persistedPlanets = vi.spyOn(SnapshotStore.prototype, 'livePlanetIds').mockRejectedValue(new Error('unit fixture must not query persisted planets'));
    const prod = await boot({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'prod-test-jwt-secret-0123456789', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' });
    expect(prod.app.get(SnapshotService).enabled).toBe(false);
    expect(prod.app.get(LedgerStorePort)).toBeInstanceOf(InMemoryLedgerStore);
    expect(persistedPlanets).not.toHaveBeenCalled();
    const r = await fetch(`${prod.url}/v1/_test/boom`);
    const text = await r.text();
    expect(r.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'INTERNAL', error: { code: 'internal', message: 'Internal server error' } });
    expect(text).not.toContain('secret');
    const requestLines = logsForRequest(prod.lines, r.headers.get('x-request-id'));
    expect(requestLines, JSON.stringify(prod.lines)).toHaveLength(1);
    expect(requestLines[0]).toMatchObject({ level: 50, layer: 'http', errorCode: 'INTERNAL', status: 500, path: '/v1/_test/boom' });
    await prod.app.close();
    const dev = await boot();
    const body = (await (await fetch(`${dev.url}/v1/_test/boom`)).json()) as { error: { message: string } };
    expect(body.error.message).toContain('secret');
  });
});
