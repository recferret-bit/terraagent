import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState } from '../../kernel/state';
import {
  DEFAULT_SHIELD_DURATION_TICKS,
  dropColonyShield,
  getColonyRaidProtectedUntil,
  initColonyNewcomerShield,
  isColonyRaidProtected,
  setColonyShieldHours,
  syncColonyNewcomerShield,
  TICKS_PER_HOUR,
} from './index';

describe('W18-06 newcomer shield — unit tests (UO-T-05, AC-06)', () => {
  it('initializes 6h newcomer shield on colony creation below S4 and blocks raids while active', () => {
    const data = compileData(parseWaves('..18'));
    const state = createState({
      planetId: 'pl_w18_06_unit',
      planetType: 'temperate',
      seed: 'w18-06-seed',
      radius: 20,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.status = 'active';
    col0.stage = 3;

    const rec = initColonyNewcomerShield(state, 0, 0, data);
    expect(rec.raidProtectedUntil).toBe(DEFAULT_SHIELD_DURATION_TICKS);
    expect(col0.raidProtectedUntil).toBe(DEFAULT_SHIELD_DURATION_TICKS);

    // At 1 hour (18,000 ticks) and S3, colony 0 is still protected (5 hours remaining)
    const oneHourTick = TICKS_PER_HOUR;
    expect(isColonyRaidProtected(state, 0, oneHourTick, data)).toBe(true);
    expect(getColonyRaidProtectedUntil(state, 0, oneHourTick, data)).toBe(
      DEFAULT_SHIELD_DURATION_TICKS,
    );
  });

  it('enforces exact 6h boundary tick (107,999 protected vs 108,000 expired)', () => {
    const data = compileData(parseWaves('..18'));
    const state = createState({
      planetId: 'pl_w18_06_boundary',
      planetType: 'temperate',
      seed: 'w18-06-boundary',
      radius: 20,
    });
    const col = ensureColonyRecord(state, 0, 0);
    col.status = 'active';
    col.stage = 3;
    initColonyNewcomerShield(state, 0, 0, data);

    expect(isColonyRaidProtected(state, 0, DEFAULT_SHIELD_DURATION_TICKS - 1, data)).toBe(true);
    expect(isColonyRaidProtected(state, 0, DEFAULT_SHIELD_DURATION_TICKS, data)).toBe(false);
    expect(col.raidProtectedUntil).toBe(0);
  });

  it('immediately drops newcomer shield when colony reaches S4 (or S5+) or launches a raid', () => {
    const data = compileData(parseWaves('..18'));
    const state = createState({
      planetId: 'pl_w18_06_drop',
      planetType: 'temperate',
      seed: 'w18-06-drop',
      radius: 20,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.status = 'active';
    col0.stage = 3;
    initColonyNewcomerShield(state, 0, 0, data);

    const col1 = ensureColonyRecord(state, 1, 0);
    col1.status = 'active';
    col1.stage = 2;
    initColonyNewcomerShield(state, 1, 0, data);

    // Reaching S4 drops col0's shield immediately
    col0.stage = 4;
    syncColonyNewcomerShield(state, 0, 5_000, data);
    expect(isColonyRaidProtected(state, 0, 5_000, data)).toBe(false);
    expect(col0.raidProtectedUntil).toBe(0);

    // Launching an offensive raid drops col1's shield while still at S2
    expect(isColonyRaidProtected(state, 1, 5_000, data)).toBe(true);
    dropColonyShield(state, 1, 5_000, data);
    expect(isColonyRaidProtected(state, 1, 5_000, data)).toBe(false);
    expect(col1.raidProtectedUntil).toBe(0);
  });

  it('supports setColonyShieldHours override and disables shield when W18 wave flag is off', () => {
    const w18Data = compileData(parseWaves('..18'));
    const w17Data = compileData(parseWaves('..17'));
    const state = createState({
      planetId: 'pl_w18_06_override',
      planetType: 'temperate',
      seed: 'w18-06-override',
      radius: 20,
    });
    const col = ensureColonyRecord(state, 0, 0);
    col.status = 'active';
    col.stage = 4;

    const until = setColonyShieldHours(state, 0, 2, 1000, w18Data);
    expect(until).toBe(1000 + 2 * TICKS_PER_HOUR);
    expect(isColonyRaidProtected(state, 0, 2000, w18Data)).toBe(true);
    expect(isColonyRaidProtected(state, 0, 2000, w17Data)).toBe(false);

    setColonyShieldHours(state, 0, 0, 2500, w18Data);
    expect(isColonyRaidProtected(state, 0, 2500, w18Data)).toBe(false);
  });
});
