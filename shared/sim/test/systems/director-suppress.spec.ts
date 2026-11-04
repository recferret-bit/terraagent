import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { TICK_MS, compileData, createPlanet, dataRow, goalSuppressed, SimHost, suppressGoal } from '@terra/sim';

function suppressWindowTicks(): number {
  const seconds = dataRow(compileData(parseWaves('..16')), 'director', 'cadence').cancelSuppressS;
  if (typeof seconds !== 'number') throw new Error('director.cadence.cancelSuppressS is not a number');
  return Math.round((seconds * 1000) / TICK_MS);
}

describe('W16-39 cancel suppression', () => {
  it('suppresses an equivalent re-proposal and not a different goal', () => {
    const sim = new SimHost({ flags: parseWaves('..16') });
    sim.load(createPlanet({ type: 'flat', seed: 'w16-suppress', radius: 8 }));
    sim.step(1);

    const tick = sim.tick;
    const window = suppressWindowTicks();
    suppressGoal(sim.state, 0, 'grow_economy', tick + window, tick);

    expect(goalSuppressed(sim.state, 0, 'grow_economy', tick + 1)).toBe(true);
    expect(goalSuppressed(sim.state, 0, 'secure_power', tick + 1)).toBe(false);
    expect(goalSuppressed(sim.state, 0, 'grow_economy', tick + window)).toBe(false);
  });
});
