import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { readAwaySettings } from '../../src/systems/away/store';

function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: 'cm_away_1', kind, args };
}

describe('W09-09 setAutopilot in the sim host', () => {
  it('stores a metals budget of 30 and keeps the other families at the defaults', () => {
    const sim = new SimHost({ flags: parseWaves('..09') });
    sim.load(createPlanet({ type: 'flat', seed: 'w09-away', radius: 4 }));
    sim.submit(cmd('setAutopilot', {
      mode: 'rules_only',
      awayRaids: false,
      awayBudget: { metals: { perDirectivePct: 40, perSessionPct: 30 } },
    }));
    const step = sim.step(1);
    expect(step.outcomes[0]?.code).toBeUndefined();
    const stored = readAwaySettings(sim.state, 0);
    expect(stored?.mode).toBe('rules_only');
    expect(stored?.awayRaids).toBe(false);
    expect(stored?.budget.metals.perSessionPct).toBe(30);
    expect(stored?.budget.minerals.perDirectivePct).toBe(40);
    expect(stored?.budget.bio.perSessionPct).toBe(60);
    expect((sim.state.blobs.away?.value as { policyVersion?: number }).policyVersion).toBe(1);
  });

  it('rejects a budget over 100 before the handler, and wave_disabled below W09', () => {
    const on = new SimHost({ flags: parseWaves('..09') });
    on.load(createPlanet({ type: 'flat', seed: 'w09-bad', radius: 4 }));
    on.submit(cmd('setAutopilot', { awayBudget: { metals: { perSessionPct: 101 } } }));
    expect(on.step(1).outcomes[0]?.code).toBe('invalid_args');

    const off = new SimHost({ flags: parseWaves('..08') });
    off.load(createPlanet({ type: 'flat', seed: 'w09-off', radius: 4 }));
    off.submit(cmd('setAutopilot', { mode: 'director' }));
    expect(off.step(1).outcomes[0]?.code).toBe('wave_disabled');
  });

  it('rejects an empty patch and a command with no colony', () => {
    const sim = new SimHost({ flags: parseWaves('..09') });
    sim.load(createPlanet({ type: 'flat', seed: 'w09-empty', radius: 4 }));
    sim.submit(cmd('setAutopilot', {}));
    sim.submit({ colonyIndex: null, source: 'player', commandId: 'cm_away_2', kind: 'setAutopilot', args: { mode: 'director' } });
    const step = sim.step(1);
    expect(step.outcomes.map((o) => o.code)).toEqual(['invalid_args', 'not_own_colony']);
  });
});
