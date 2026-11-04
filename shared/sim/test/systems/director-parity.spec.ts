import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { applyPriorityOverlay, awayGuardPoints, colonyDirector } from '../../src/systems/director';

function host(seed: string): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed, radius: 8 }));
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `p${++seq}`, kind, args };
}

function viewOf(sim: SimHost) {
  const view = colonyDirector(sim.state, 0);
  return {
    risk: view?.policy.risk,
    awayRaids: view?.awayRaids,
    priorities: view?.policy.priorities,
    intent: view?.intentRevision,
  };
}

describe('W16-49 local and server policy parity', () => {
  it('applies the same risk and overlay on two hosts', () => {
    const local = host('parity-a');
    const server = host('parity-a');
    const guard = awayGuardPoints();
    for (const sim of [local, server]) {
      sim.submit(cmd('setDirectorPolicy', { risk: 'risky', priorities: { defense: 40 } }));
      sim.step(1);
      applyPriorityOverlay(sim.state, 0, { defense: 50 }, sim.tick + 5, sim.tick, guard);
    }
    expect(viewOf(local)).toEqual(viewOf(server));
    expect(viewOf(local).awayRaids).toBe(false);
    expect(viewOf(local).risk).toBe('risky');
    expect(viewOf(local).priorities?.defense).toBe(50);
  });
});
