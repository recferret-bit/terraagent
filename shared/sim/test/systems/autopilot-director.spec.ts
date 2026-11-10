import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { readAwaySettings } from '../../src/systems/away/store';
import { colonyDirector } from '../../src/systems/director';

function host(flags = '..16'): SimHost {
  const sim = new SimHost({ flags: parseWaves(flags) });
  sim.load(createPlanet({ type: 'flat', seed: 'w09-34', radius: 4 }));
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `ap${++seq}`, kind, args };
}

function view(sim: SimHost) {
  const row = colonyDirector(sim.state, 0);
  return { awayRaids: row?.awayRaids, autopilotMode: row?.autopilotMode };
}

describe('W09-34 setAutopilot writes the director record', () => {
  it('stores rules_only and away raids on the director record', () => {
    const sim = host();
    sim.submit(cmd('setAutopilot', { mode: 'rules_only', awayRaids: true }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(view(sim)).toEqual({ awayRaids: true, autopilotMode: 'rules_only' });
  });

  it('a following setDirectorPolicy does not clear away raids or the mode', () => {
    const sim = host();
    sim.submit(cmd('setAutopilot', { mode: 'rules_only', awayRaids: true }));
    sim.step(1);
    sim.submit(cmd('setDirectorPolicy', { risk: 'risky' }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(view(sim)).toEqual({ awayRaids: true, autopilotMode: 'rules_only' });
    expect(colonyDirector(sim.state, 0)?.policy.risk).toBe('risky');
  });

  it('a metals budget alone does not turn away raids off', () => {
    const sim = host();
    sim.submit(cmd('setAutopilot', { mode: 'rules_only', awayRaids: true }));
    sim.step(1);
    sim.submit(cmd('setAutopilot', { awayBudget: { metals: { perSessionPct: 30 } } }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(view(sim).awayRaids).toBe(true);
    expect(readAwaySettings(sim.state, 0)?.budget.metals.perSessionPct).toBe(30);
  });

  it('omitting mode keeps rules_only', () => {
    const sim = host();
    sim.submit(cmd('setAutopilot', { mode: 'rules_only', awayRaids: false }));
    sim.step(1);
    sim.submit(cmd('setAutopilot', { awayRaids: true }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(view(sim)).toEqual({ awayRaids: true, autopilotMode: 'rules_only' });
  });

  it('stores hire mercenaries and keeps the max when a later budget patch omits it', () => {
    const sim = host();
    sim.submit(cmd('setAutopilot', { hireMercenaries: true, mercenaryMaxSpend: 100 }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(readAwaySettings(sim.state, 0)).toMatchObject({ hireMercenaries: true, mercenaryMaxSpend: 100, awayRaids: false });
    sim.submit(cmd('setAutopilot', { awayBudget: { metals: { perSessionPct: 30 } } }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(readAwaySettings(sim.state, 0)?.hireMercenaries).toBe(true);
    expect(readAwaySettings(sim.state, 0)?.mercenaryMaxSpend).toBe(100);
    expect(readAwaySettings(sim.state, 0)?.budget.metals.perSessionPct).toBe(30);
  });

  it('still stores the away blob when W16 is off', () => {
    const sim = host('..09');
    sim.submit(cmd('setAutopilot', { mode: 'rules_only', awayRaids: true }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(readAwaySettings(sim.state, 0)?.mode).toBe('rules_only');
    expect(readAwaySettings(sim.state, 0)?.awayRaids).toBe(true);
    expect(view(sim)).toEqual({ awayRaids: true, autopilotMode: 'rules_only' });
  });
});
