import { describe, expect, it } from 'vitest';
import { spatialAllowed, type ObservedRoute, type ProtectedArea } from '../../src/systems/director';

// Both risk profiles share this guard. It does not take a risk argument.
// Risky cannot enter an unobserved sector.

const routes: ObservedRoute[] = [
  { id: 'north', sectorIds: ['s-home', 's-ridge'] },
  { id: 'east', sectorIds: ['s-home', 's-ford'] },
];

const protectedAreas: ProtectedArea[] = [{ sectorId: 's-ridge' }, { sectorId: 's-vault' }];

describe('W16-37 spatial skill routes', () => {
  it('allows hold on an observed sector', () => {
    const home = spatialAllowed({ skill: 'defence', sectorId: 's-home', variant: 'hold' }, routes, protectedAreas);
    const ford = spatialAllowed({ skill: 'scouting', sectorId: 's-ford', variant: 'hold' }, routes, protectedAreas);
    expect(home).toEqual({ ok: true });
    expect(ford).toEqual({ ok: true });
  });

  it('allows flank and frontier only when a route lists the sector', () => {
    expect(spatialAllowed({ skill: 'defence', sectorId: 's-ridge', variant: 'flank' }, routes, protectedAreas)).toEqual({ ok: true });
    expect(spatialAllowed({ skill: 'scouting', sectorId: 's-ford', variant: 'flank' }, routes, protectedAreas)).toEqual({ ok: true });
    expect(spatialAllowed({ skill: 'expansion', sectorId: 's-ford', variant: 'frontier' }, routes, protectedAreas)).toEqual({ ok: true });
    expect(spatialAllowed({ skill: 'defence', sectorId: 's-unknown', variant: 'flank' }, routes, protectedAreas)).toEqual({
      ok: false,
      reason: 'unobserved',
    });
    expect(spatialAllowed({ skill: 'expansion', sectorId: 's-unknown', variant: 'frontier' }, routes, protectedAreas)).toEqual({
      ok: false,
      reason: 'unobserved',
    });
  });

  it('rejects reclaim inside a protected area and on an unknown sector', () => {
    expect(spatialAllowed({ skill: 'terraforming', sectorId: 's-ridge', variant: 'reclaim' }, routes, protectedAreas)).toEqual({
      ok: false,
      reason: 'protected',
    });
    expect(spatialAllowed({ skill: 'terraforming', sectorId: 's-ford', variant: 'reclaim' }, routes, protectedAreas)).toEqual({ ok: true });
    expect(spatialAllowed({ skill: 'terraforming', sectorId: 's-unknown', variant: 'reclaim' }, routes, protectedAreas)).toEqual({
      ok: false,
      reason: 'unobserved',
    });
    expect(spatialAllowed({ skill: 'terraforming', sectorId: 's-vault', variant: 'reclaim' }, routes, protectedAreas)).toEqual({
      ok: false,
      reason: 'unobserved',
    });
  });
});
