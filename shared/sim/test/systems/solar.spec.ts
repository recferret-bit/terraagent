import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluateColonySolar,
  evaluateSolarArrayOutput,
  getColonyPower,
  insertRow,
  setPlanetTime,
  step,
} from '../../src';

describe('W02-07 Solar T1 output: gross +14 * daylight * (desert ? 1.35 : 1.0), internal drain -1', () => {
  it('1 Solar on temperate at 12:00 -> net +13; at 00:00 -> net -1', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const solarRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
    state.entities.cols.owner[solarRow] = 0;
    state.entities.cols.q[solarRow] = 0;
    state.entities.cols.r[solarRow] = 0;
    state.entities.cols.footprintW[solarRow] = 2;
    state.entities.cols.footprintD[solarRow] = 2;
    state.entities.cols.hp[solarRow] = 400;
    state.entities.cols.state[solarRow] = ENTITY_STATE.active;

    // Set time to 12:00 (midday)
    setPlanetTime(state, { timeOfDay: 12 }, 0); // the environment follows the planet's solar clock
    step(state, [], 1, pipeline);

    const middaySolar = evaluateColonySolar(state, 0);
    expect(middaySolar.grossPerS).toBe(14);
    expect(middaySolar.internalDrainPerS).toBe(1);
    expect(middaySolar.netPerS).toBe(13);
    expect(getColonyPower(state, 0).solarNetPerS).toBe(13);

    // Set time to 00:00 (midnight)
    setPlanetTime(state, { timeOfDay: 0 }, state.meta.tick);
    step(state, [], 1, pipeline);

    const midnightSolar = evaluateColonySolar(state, 0);
    expect(midnightSolar.grossPerS).toBe(0);
    expect(midnightSolar.internalDrainPerS).toBe(1);
    expect(midnightSolar.netPerS).toBe(-1);
    const midnightPower = getColonyPower(state, 0);
    expect(midnightPower.solarNetPerS).toBe(-1);
    expect(midnightPower.offlineReasons[state.entities.cols.id[solarRow]]).toBe('offline: night');
  });

  it('applies desert 1.35x solar bonus (+18.9 gross, +17.9 net at midday)', () => {
    const out = evaluateSolarArrayOutput(1.0, 'desert');
    expect(out.gross).toBeCloseTo(18.9, 4);
    expect(out.internalDrain).toBe(1);
    expect(out.net).toBeCloseTo(17.9, 4);
  });
});
