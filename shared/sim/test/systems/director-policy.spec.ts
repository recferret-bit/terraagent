import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { colonyDirector, noteDirectorPlan } from '../../src/systems/director';

function host(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed: 'w16-director', radius: 8 }));
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `c${++seq}`, kind, args };
}

describe('W16-34 director policy', () => {
  it('keeps independent sliders and never enables away raids from risk', () => {
    const sim = host();
    sim.submit(cmd('setDirectorPolicy', {
      risk: 'risky',
      priorities: { economy: 100, expansion: 100, defense: 100, power: 100, terraform: 100 },
    }));
    const step = sim.step(1);
    expect(step.outcomes[0]?.code).toBeUndefined();
    const view = colonyDirector(sim.state, 0);
    expect(view?.awayRaids).toBe(false);
    expect(view?.policy.risk).toBe('risky');
    expect(view?.policy.priorities).toEqual({ economy: 100, expansion: 100, defense: 100, power: 100, terraform: 100 });
    expect(Object.values(view!.policy.priorities).reduce((sum, n) => sum + n, 0)).toBe(500);
  });

  it('rejects an away-raid field and a stale revision', () => {
    const sim = host();
    sim.submit(cmd('setDirectorPolicy', { risk: 'risky', awayRaids: true }));
    expect(sim.step(1).outcomes[0]?.code).toBe('invalid_args');
    expect(colonyDirector(sim.state, 0)?.awayRaids ?? false).toBe(false);

    sim.submit(cmd('setDirectorPolicy', { risk: 'risky', expectedRevision: 0 }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    sim.submit(cmd('setDirectorPolicy', { pause: true, expectedRevision: 0 }));
    expect(sim.step(1).outcomes[0]?.code).toBe('stale_revision');
    expect(colonyDirector(sim.state, 0)?.awayRaids).toBe(false);
  });
});

describe('W16-34 intent invalidation', () => {
  it('supersedes an open plan when the player changes policy or priorities', () => {
    const sim = host();
    sim.step(1);
    const plan = noteDirectorPlan(sim.state, 0, 'req_old', sim.tick);
    expect(plan.status).toBe('open');

    sim.submit(cmd('setDirectorPolicy', { risk: 'risky' }));
    sim.step(1);
    const afterRisk = colonyDirector(sim.state, 0);
    expect(afterRisk?.awayRaids).toBe(false);
    expect(afterRisk?.plans.find((row) => row.requestId === 'req_old')?.status).toBe('superseded');

    const fresh = noteDirectorPlan(sim.state, 0, 'req_new', sim.tick);
    sim.submit(cmd('setPriorities', { defense: 80 }));
    sim.step(1);
    const afterSliders = colonyDirector(sim.state, 0);
    expect(afterSliders?.plans.find((row) => row.requestId === 'req_new')?.status).toBe('superseded');
    expect(afterSliders?.policy.priorities.defense).toBe(80);
    expect(afterSliders?.policy.priorities.economy).toBe(50);
    expect(fresh.intentRevision).toBeLessThan(afterSliders!.intentRevision);
  });

  it('is disabled when W16 is off', () => {
    const sim = new SimHost({ flags: parseWaves('..15') });
    sim.load(createPlanet({ type: 'flat', seed: 'w16-off', radius: 8 }));
    sim.submit(cmd('setDirectorPolicy', { risk: 'risky' }));
    expect(sim.step(1).outcomes[0]?.code).toBe('wave_disabled');
  });
});
