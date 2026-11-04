import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, applyDirectiveBatch, screenDirective, type SimCommand } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { DirectorKillSwitch } from '../../src/ai/audit/kill.js';
import { ProposalOutbox } from '../../src/ai/audit/outbox.js';
import { callTool } from '../../../director/src/tools.js';

function host(waves: string): SimHost {
  const sim = new SimHost({ flags: parseWaves(waves) });
  sim.load(createPlanet({ type: 'flat', seed: 'w16-reg', radius: 8 }));
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `r${++seq}`, kind, args };
}

describe('W16-24 hostile input and disabled wave', () => {
  it('rejects a shell tool and a foreign colony directive', () => {
    const tool = callTool('shell.exec', {});
    expect(tool.ok).toBe(false);
    const foreign = screenDirective(JSON.stringify({
      version: 2, skills: [], rationale: 'x', observedDependencies: [], actions: [],
      requestId: 'req_1', jobId: 'job_1', fence: 1, colonyId: 'co_2', worldId: 'world_1', planetId: 'pl_1',
      epoch: 1, intentRevision: 1, permissionRevision: 1, contextRevision: 1, policyVersion: 1,
      deadlineAtMs: 5, maxContextAgeS: 60,
    }), { colonyId: 'co_1', planetId: 'pl_1', worldId: 'world_1', colonyIndex: 0 });
    expect(foreign.ok).toBe(false);
  });

  it('rejects director policy when W16 is off', () => {
    const sim = host('..15');
    sim.submit(cmd('setDirectorPolicy', { risk: 'risky' }));
    expect(sim.step(1).outcomes[0]?.code).toBe('wave_disabled');
  });
});

describe('W16-24 partial failure, replay, and shutdown', () => {
  it('keeps a manual goal when one action in the batch is rejected', () => {
    const sim = host('..16');
    sim.submit(cmd('queueGoal', { goal: 'establish_colony' }));
    sim.step(1);
    const acks = applyDirectiveBatch(sim.state, 0, [
      { actionId: 'sliders', kind: 'setPriorities', args: { defense: 0 } },
      { actionId: 'grow', kind: 'queueGoal', args: { goal: 'grow_economy', budgetBp: 1000, params: { resource: 'metals.t1' } } },
    ], [{ id: 'metals.t1', unearmarked: 1000 }], { reserveFloorBp: 4000, commitBp: 1500, openGoalSlots: 2, awayRaids: false }, sim.tick);
    expect(acks.find((row) => row.actionId === 'sliders')?.state).toBe('rejected');
    expect(acks.find((row) => row.actionId === 'grow')?.state).toBe('applied');
  });

  it('dedupes a replay and rejects a result after shutdown', () => {
    const box = new ProposalOutbox();
    expect(box.accept({ requestId: 'req_1', colonyId: 'co_1', fence: 1, intentRevision: 1, actions: [{ actionId: 'a' }] }).ok).toBe(true);
    expect(box.accept({ requestId: 'req_1', colonyId: 'co_1', fence: 1, intentRevision: 1, actions: [{ actionId: 'b' }] })).toEqual({ ok: true, duplicate: true });
    expect(box.results('req_1')).toEqual([{ actionId: 'a' }]);
    const kill = new DirectorKillSwitch('admin-token');
    kill.kill('colony:co_1', 'admin-token', 1);
    expect(kill.acceptResult('colony:co_1', 'worker').ok).toBe(false);
  });
});
