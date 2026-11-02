import { DEFAULT_COLONY_COLORS, DEPOSIT_CODES, PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { describe, expect, it } from 'vitest';
import { DEPOSIT, PREP, TERRAIN } from '../../src/grid/layers';
import { DEFAULT_COLONY_COLORS as SIM_COLONY_COLORS } from '../../src/kernel/colonies';

// RN-06: the sim's tile enums and colony palette are the contracts tables the render engine draws from (one copy).
describe('tile codes come from @terra/contracts (RN-06)', () => {
  it('terrain, prep and deposit enums are the contracts tables, with PascalCase aliases that do not enumerate', () => {
    expect({ ...TERRAIN }).toEqual(TERRAIN_CODES);
    expect({ ...PREP }).toEqual(PREP_CODES);
    expect({ ...DEPOSIT }).toEqual(DEPOSIT_CODES);
    expect([TERRAIN.Deep, PREP.Moat, DEPOSIT.Oil]).toEqual([TERRAIN_CODES.deep, PREP_CODES.moat, DEPOSIT_CODES.oil]);
    expect(Object.keys(TERRAIN)).toEqual(Object.keys(TERRAIN_CODES));
  });

  it('the default colony palette is the contracts one', () => {
    expect(SIM_COLONY_COLORS).toBe(DEFAULT_COLONY_COLORS);
  });
});
