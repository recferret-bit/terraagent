import { describe, expect, it } from 'vitest';
import { W11_DEFAULT_SECTOR_RADIUS } from '@terra/contracts';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState } from '../../kernel/state';
import {
  canAttackMoveToTileSector,
  canRaidTargetSector,
  isCrossSectorRaidEnabled,
  resolveColonySectorId,
  setCrossSectorRaidEnabled,
} from './index';

describe('W18-31 W11 R=48 founding sector & cross_sector_disabled guard — unit tests', () => {
  it('permits raids between rival colonies co-seated inside the same R=48 founding sector (sec_0_0)', () => {
    const state = createState({
      planetId: 'pl_w18_31_same',
      planetType: 'temperate',
      seed: 'w18-31-same',
      radius: W11_DEFAULT_SECTOR_RADIUS,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.foundingSectorId = 'sec_0_0';
    const col1 = ensureColonyRecord(state, 1, 0);
    col1.foundingSectorId = 'sec_0_0';

    expect(resolveColonySectorId(state, 0)).toBe('sec_0_0');
    expect(resolveColonySectorId(state, 1)).toBe('sec_0_0');
    expect(canRaidTargetSector(state, 0, 1)).toEqual({
      ok: true,
      sectorId: 'sec_0_0',
    });
    expect(canAttackMoveToTileSector(state, 0, 10, -5)).toEqual({ ok: true });
  });

  it('rejects cross-sector raid orders and foreign attackMove with cross_sector_disabled unless enabled', () => {
    const state = createState({
      planetId: 'pl_w18_31_cross',
      planetType: 'temperate',
      seed: 'w18-31-cross',
      radius: W11_DEFAULT_SECTOR_RADIUS,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.foundingSectorId = 'sec_0_0';
    const col1 = ensureColonyRecord(state, 1, 0);
    col1.foundingSectorId = 'sec_1_0';

    expect(isCrossSectorRaidEnabled(state)).toBe(false);
    expect(canRaidTargetSector(state, 0, 1)).toEqual({
      ok: false,
      code: 'cross_sector_disabled',
      attackerSectorId: 'sec_0_0',
      targetSectorId: 'sec_1_0',
    });

    setCrossSectorRaidEnabled(state, true, 10);
    expect(isCrossSectorRaidEnabled(state)).toBe(true);
    expect(canRaidTargetSector(state, 0, 1)).toEqual({
      ok: true,
      sectorId: 'sec_0_0',
    });
  });
});
