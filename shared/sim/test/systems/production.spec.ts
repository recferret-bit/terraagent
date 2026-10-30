import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_STATE,
  hexIndex,
  placeMetalsExtractor,
  setTileDeposit,
  step,
} from '../../src';

describe('W02-08 Metals Extractor T1 production & deposit coverage', () => {
  it('place on non-deposit -> site_blocked (no deposit); place on metals deposit -> +1.0 * richness/s; fill to cap -> halts', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 6 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // 1. Place on non-deposit at (0, 0) -> rejected with site_blocked (no deposit)
    const noDep = placeMetalsExtractor(state, { owner: 0, q: 0, r: 0 });
    expect(noDep).toEqual({ ok: false, code: 'site_blocked', detail: 'no deposit' });

    // 2. Put a metals deposit at (2, 1) with richness 1.15 (11500 bp) and place extractor at (1, 1) (2x2 covers (2,1))
    const idx = hexIndex(state.grid.radius);
    const depTile = idx.indexOf(2, 1);
    setTileDeposit(state, depTile, DEPOSIT.metals, 11500, 0);

    const placed = placeMetalsExtractor(state, { owner: 0, q: 1, r: 1 });
    expect(placed.ok).toBe(true);
    if (!placed.ok) throw new Error('expected ok');
    expect(placed.richnessMult).toBeCloseTo(1.15, 5);

    // Advance 5 ticks (1 second at 5 TPS) -> produces 1.0 * 1.15 = 1.15 metals.t1
    step(state, [], 5, pipeline);
    const colony = ensureColonyLedger(state.colonies[0]);
    expect(colony.stock['metals.t1']).toBeCloseTo(1.15, 5);
    expect(colony.production.incomePerS['metals.t1']).toBeCloseTo(1.15, 4);

    // 3. Fill to cap (500) -> extractor halts (ENTITY_STATE.offlineCapped) and produces 0 additional stock
    creditResource(colony, 'metals.t1', 500, state.meta.tick);
    expect(colony.stock['metals.t1']).toBe(500);

    step(state, [], 5, pipeline);
    expect(colony.stock['metals.t1']).toBe(500);
    expect(state.entities.cols.state[0]).toBe(ENTITY_STATE.offlineCapped);
    expect(colony.production.incomePerS['metals.t1']).toBe(0);
  });
});
