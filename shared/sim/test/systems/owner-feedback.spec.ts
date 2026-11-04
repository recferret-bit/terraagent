import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createState, createRegistryPipeline, step, insertRow, ENTITY_KIND, ENTITY_STATE, DEPOSIT, hexIndex, setTileDeposit, placeMetalsExtractor, ensureColonyLedger, creditResource } from '../../src';
import { evaluateWindOutput } from '../../src/systems/power-core/windAndCap';

describe('owner feedback: extraction and stable wind', () => {
  it('keeps each wind level for three minutes, with identical weather for every colony', () => {
    const state = createState({ planetId: 'wind', planetType: 'temperate', seed: 'wind', radius: 6 });
    const levels = new Set<number>();
    for (let tick = 0; tick < 9000; tick += 900) {
      const a = evaluateWindOutput(state, 0, tick);
      levels.add(a.windFactor);
      expect(evaluateWindOutput(state, 0, tick + 899).windFactor).toBe(a.windFactor);
      expect(evaluateWindOutput(state, 1, tick).windFactor).toBe(a.windFactor);
      expect(a.netPerS).toBeCloseTo(12 * a.windFactor);
    }
    expect([...levels].sort()).toEqual([0.25, 1, 1.5]);
  });

  it('credits repeated fractional yield all the way to exactly 500', () => {
    const state = createState({ planetId: 'cap', planetType: 'temperate', seed: 'cap', radius: 6 });
    state.colonies.push({ index: 0, id: 'c', name: 'c', color: 0, status: 'active', changedAt: 0 });
    const colony = ensureColonyLedger(state.colonies[0]);
    colony.caps.metals = 500;
    for (let i = 0; i < 5000; i++) creditResource(colony, 'metals.t1', 0.1, i);
    expect(colony.stock['metals.t1']).toBe(500);
  });

  it('one extractor entity produces crystals when placed over minerals', () => {
    const state = createState({ planetId: 'mine', planetType: 'temperate', seed: 'mine', radius: 6 });
    setTileDeposit(state, hexIndex(6).indexOf(2, 1), DEPOSIT.minerals, 10000, 0);
    const result = placeMetalsExtractor(state, { owner: 0, q: 1, r: 1 });
    expect(result.ok).toBe(true);
    const solar = insertRow(state.entities, state.meta.nextEntityId++, 0);
    Object.entries({kind: ENTITY_KIND.solar, owner: 0, hp: 200, hpMax: 200, state: ENTITY_STATE.active}).forEach(([key, val]) => {
      state.entities.cols[key as 'kind'][solar] = val;
    });
    step(state, [], 5, createRegistryPipeline({ flags: parseWaves('..02') }));
    expect(state.entities.cols.kind[0]).toBe(ENTITY_KIND.metalsExtractor);
    expect(ensureColonyLedger(state.colonies[0]).stock['minerals.t1']).toBeGreaterThan(0);
  });
});
