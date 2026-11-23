import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { nominatePlanet, stakeNominateCmd } from './patronCommand';

const ctx = (planetId: string | null): FeatureContext =>
  ({ services: { session: { planetId: () => planetId } } }) as unknown as FeatureContext;
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('W28 stake.nominate dev command', () => {
  it('backs the current planet with the linked wallet and reports the Lead Patron seat (positive)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, { accountId: 'w28-pilot.near' }))
      .mockResolvedValueOnce(res(200, { isLeadPatron: true, leadPatron: { accountId: 'w28-pilot.near', carrierName: 'ISS w28-pilot.near' } }));
    expect(await nominatePlanet(ctx('pl_demo'), undefined, f)).toBe('w28-pilot.near is Lead Patron of pl_demo (ISS w28-pilot.near)');
    expect(JSON.parse(f.mock.calls[1]![1].body as string)).toEqual({ accountId: 'w28-pilot.near', planetId: 'pl_demo' });
  });

  it('a nomination below 500 NEAR names the current lead; an explicit planet id wins over the session (corner)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, { accountId: 'small.near' }))
      .mockResolvedValueOnce(res(200, { isLeadPatron: false, leadPatron: { accountId: 'w28-rival.near' } }));
    expect(await nominatePlanet(ctx('pl_session'), 'pl_other', f)).toBe('small.near backs pl_other; lead patron: w28-rival.near');
    expect(JSON.parse(f.mock.calls[1]![1].body as string).planetId).toBe('pl_other');
  });

  it('no planet, no linked wallet, or a refused nomination report it without throwing (negative)', async () => {
    expect(await nominatePlanet(ctx(null), undefined, vi.fn())).toContain('no planet');
    expect(await nominatePlanet(ctx('pl'), undefined, vi.fn().mockResolvedValueOnce(res(400, {})))).toContain('no linked wallet');
    const refused = vi.fn().mockResolvedValueOnce(res(200, { accountId: 'a.near' })).mockResolvedValueOnce(res(403, { error: { code: 'FORBIDDEN', message: 'not your wallet' } }));
    expect(await nominatePlanet(ctx('pl'), undefined, refused)).toBe('nominate failed (403): not your wallet');
  });

  it('rejects extra arguments with its usage line', async () => {
    await expect(Promise.resolve().then(() => stakeNominateCmd.run(['a', 'b'], ctx('pl')))).rejects.toThrow(/stake\.nominate/);
  });
});
