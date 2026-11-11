import { describe, expect, it, vi } from 'vitest';
import { readApiErrorCode, sendPlanetRequest } from './planetHttp';

function response(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('planet HTTP helper', () => {
  it('reads errorCode, then the nested error code', async () => {
    expect(await readApiErrorCode(response(false, { errorCode: 'TREASURY_INSUFFICIENT' }))).toBe('TREASURY_INSUFFICIENT');
    expect(await readApiErrorCode(response(false, { error: { code: 'invalid_target' } }))).toBe('invalid_target');
  });

  it('returns null for a body that is not JSON and for a body with no code', async () => {
    const notJson = { ok: false, json: async () => { throw new Error('nope'); } };
    expect(await readApiErrorCode(notJson as unknown as Response)).toBeNull();
    expect(await readApiErrorCode(response(false, { error: 'plain' }))).toBeNull();
  });

  it('sends when the planet id is set and the response is ok', async () => {
    const fail = vi.fn();
    const run = vi.fn(async () => response(true, {}));
    expect(await sendPlanetRequest('pl_1', run, fail)).toBe(true);
    expect(run).toHaveBeenCalledWith('pl_1');
    expect(fail).not.toHaveBeenCalled();
  });

  it('does not send without a planet id', async () => {
    const run = vi.fn();
    expect(await sendPlanetRequest(null, run, () => undefined)).toBe(false);
    expect(await sendPlanetRequest('', run, () => undefined)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('reports the server code, and REQUEST_FAILED when fetch throws', async () => {
    const fail = vi.fn();
    expect(await sendPlanetRequest('pl_1', async () => response(false, { errorCode: 'ALREADY_VOTED' }), fail)).toBe(false);
    expect(fail).toHaveBeenCalledWith('ALREADY_VOTED');
    expect(await sendPlanetRequest('pl_1', async () => { throw new Error('offline'); }, fail)).toBe(false);
    expect(fail).toHaveBeenLastCalledWith('REQUEST_FAILED');
  });
});
