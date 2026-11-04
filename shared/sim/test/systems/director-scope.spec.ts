import { describe, expect, it } from 'vitest';
import { AI_RESPONSE_MAX_BYTES, type DirectiveV2 } from '@terra/contracts';
import { screenDirective, screenProposal, type ColonyScope } from '../../src/systems/director';

const scope: ColonyScope = { colonyId: 'co_1', planetId: 'pl_1', worldId: 'world_1', colonyIndex: 0 };

function envelope(actions: DirectiveV2['actions'], colonyId = 'co_1'): DirectiveV2 {
  return {
    version: 2,
    skills: [{ id: 'resources', version: 1 }],
    rationale: 'hold',
    observedDependencies: [],
    actions,
    requestId: 'req_1',
    jobId: 'job_1',
    fence: 1,
    colonyId,
    worldId: 'world_1',
    planetId: 'pl_1',
    epoch: 1,
    intentRevision: 1,
    permissionRevision: 1,
    contextRevision: 1,
    policyVersion: 1,
    deadlineAtMs: 5_000,
    maxContextAgeS: 60,
  };
}

const goal = {
  actionId: 'a1',
  kind: 'queueGoal' as const,
  args: { goal: 'grow_economy' as const },
};

describe('W16-10 scope and parse gates', () => {
  it('accepts a same-colony directive and rejects a foreign colony id', () => {
    const ok = screenDirective(JSON.stringify(envelope([goal])), scope);
    expect(ok.ok).toBe(true);
    const foreign = screenDirective(JSON.stringify(envelope([goal], 'co_2')), scope);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe('unauthorized');
  });

  it('rejects another colony index inside a goal before any command is built', () => {
    const raw = JSON.stringify({
      version: 2,
      skills: [],
      rationale: 'raid elsewhere',
      observedDependencies: [],
      actions: [{ actionId: 'a1', kind: 'queueGoal', args: { goal: 'raid_target', params: { targetColonyId: 9 } } }],
    });
    const screened = screenProposal(raw, scope);
    expect(screened.ok).toBe(false);
    if (!screened.ok) expect(screened.code).toBe('unauthorized');
  });

  it('rejects malformed, deep and oversized JSON with no directive', () => {
    expect(screenDirective('{', scope).ok).toBe(false);
    let nested: unknown = { leaf: true };
    for (let i = 0; i < 9; i++) nested = { child: nested };
    const deep = screenDirective(JSON.stringify(nested), scope);
    expect(deep.ok).toBe(false);
    if (!deep.ok) expect(deep.code).toBe('too_deep');
    const huge = screenDirective('x'.repeat(AI_RESPONSE_MAX_BYTES + 1), scope);
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.code).toBe('context_too_large');
  });
});
