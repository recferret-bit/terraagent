import { describe, expect, it, vi } from 'vitest';
import { fetchPrestige, type PrestigeFetch } from './prestigeClient';

const ok = (body: unknown): PrestigeFetch => async () => ({ ok: true, status: 200, json: async () => body });
const valid = {
  planetId: 'pl_dune',
  leadPatron: { planetId: 'pl_dune', accountId: 'alice.near', carrierName: 'ISS alice.near', activeStakedNear: '550', sinceMs: 1_700_000_000_000, protocolFeeShareBp: 1500 },
  colonies: [{ colonyId: 'col_a', tier: 3 }, { colonyId: 'col_b', tier: 0 }],
};

describe('W28-12 prestige fetch adapter (unit)', () => {
  it('maps a well-formed 200 to the typed response and asks for the planet', async () => {
    const spy = vi.fn(ok(valid));
    const r = await fetchPrestige('pl_dune', spy);
    expect(r?.colonies).toEqual(valid.colonies);
    expect(r?.leadPatron?.carrierName).toBe('ISS alice.near');
    expect(spy.mock.calls[0][0]).toBe('/v1/near/staking/prestige?planetId=pl_dune');
  });

  it('accepts a planet with no lead patron', async () => {
    const r = await fetchPrestige('pl_dune', ok({ ...valid, leadPatron: null }));
    expect(r?.leadPatron).toBeNull();
  });

  it('404 (W28 off or endpoint missing) is none', async () => {
    expect(await fetchPrestige('pl_dune', async () => ({ ok: false, status: 404, json: async () => ({}) }))).toBeNull();
  });

  it('any other non-ok status is none', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      expect(await fetchPrestige('pl_dune', async () => ({ ok: false, status, json: async () => valid }))).toBeNull();
    }
  });

  it('malformed bodies are none: wrong shape, bad tier, extra keys, non-JSON', async () => {
    expect(await fetchPrestige('pl_dune', ok({ nope: true }))).toBeNull();
    expect(await fetchPrestige('pl_dune', ok({ ...valid, colonies: [{ colonyId: 'c', tier: 9 }] }))).toBeNull();
    expect(await fetchPrestige('pl_dune', ok({ ...valid, extra: 1 }))).toBeNull();
    expect(await fetchPrestige('pl_dune', ok(null))).toBeNull();
    expect(await fetchPrestige('pl_dune', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }))).toBeNull();
  });

  it('a network error is none, never a throw', async () => {
    await expect(fetchPrestige('pl_dune', async () => { throw new TypeError('offline'); })).resolves.toBeNull();
  });

  it('refuses an answer for another planet and an empty planet id (corner cases)', async () => {
    expect(await fetchPrestige('pl_ocean', ok(valid))).toBeNull();
    const spy = vi.fn(ok(valid));
    expect(await fetchPrestige('', spy)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('url-encodes the planet id', async () => {
    const spy = vi.fn(ok({ ...valid, planetId: 'a b&c' }));
    await fetchPrestige('a b&c', spy);
    expect(spy.mock.calls[0][0]).toBe('/v1/near/staking/prestige?planetId=a%20b%26c');
  });
});
