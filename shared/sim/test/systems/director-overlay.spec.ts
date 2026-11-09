import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, createPlanet, SimHost, type SimCommand } from '../../src';
import { applyPriorityOverlay, awayGuardPoints, colonyDirector } from '../../src/systems/director';
import { getColonyPriorities } from '../../src/systems/goals/priorities';
import { directorRecord } from '../../src/systems/director/store';

function host(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed: 'w16-overlay', radius: 8 }));
  sim.step(1);
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `o${++seq}`, kind, args };
}

describe('W16-43 priority overlay', () => {
  it('uses a 10-point guard from the budget row and will not ratchet', () => {
    expect(awayGuardPoints(compileData(parseWaves('..16')))).toBe(10);
    const sim = host();
    sim.submit(cmd('setDirectorPolicy', { priorities: { defense: 50 } }));
    sim.step(1);
    const guard = awayGuardPoints();
    expect(applyPriorityOverlay(sim.state, 0, { defense: 60 }, sim.tick + 5, sim.tick, guard).ok).toBe(true);
    expect(applyPriorityOverlay(sim.state, 0, { defense: 70 }, sim.tick + 5, sim.tick, guard)).toEqual({ ok: false, code: 'guard_band' });
    expect(getColonyPriorities(sim.state, 0).defense).toBe(60);
    expect(colonyDirector(sim.state, 0)?.policy.priorities.economy).toBe(50);
  });

  it('restores the player baseline when the overlay expires', () => {
    const sim = host();
    const guard = awayGuardPoints();
    const until = sim.tick + 2;
    applyPriorityOverlay(sim.state, 0, { defense: 58 }, until, sim.tick, guard);
    expect(getColonyPriorities(sim.state, 0).defense).toBe(58);
    sim.step(until - sim.tick + 1);
    expect(sim.tick).toBeGreaterThanOrEqual(until);
    expect(directorRecord(sim.state, 0)?.overlayUntilTick).toBeNull();
    expect(getColonyPriorities(sim.state, 0).defense).toBe(50);
  });
});
