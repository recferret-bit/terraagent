import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AI_BRIEF_MAX_BYTES,
  ColonyBriefV2Schema,
  DEFAULT_DIRECTOR_POLICY,
  DirectiveProposalSchema,
  DirectiveV2Schema,
  DirectorJobV1Schema,
  DirectorPolicyV1Schema,
  MCP_TOOL_NAMES,
  commandDef,
  directorAction,
  directorStatus,
  independentPriorities,
  parseAiJson,
  parseCommandArgs,
  parseToolArgs,
  parseWaves,
  setDirectorPolicy,
  type DirectiveProposal,
  type DirectorJobV1,
} from '../src';

const priorities = { economy: 100, expansion: 100, defense: 100, power: 100, terraform: 100 };

function policy(extra: Record<string, unknown> = {}) {
  return { ...DEFAULT_DIRECTOR_POLICY, priorities, ...extra };
}

function proposal(actions: DirectiveProposal['actions'] = []): DirectiveProposal {
  return {
    version: 2,
    skills: [{ id: 'resources', version: 1 }],
    rationale: 'stockpile metals',
    observedDependencies: ['stock:metals'],
    actions,
  };
}

const goalAction = {
  actionId: 'a1',
  kind: 'queueGoal' as const,
  args: { goal: 'grow_economy' as const, params: { resource: 'metals.t1', targetRatePerMin: 10 } },
};

describe('W16-01 policy: independent priorities and closed fields', () => {
  it('accepts five sliders at 100 without rescaling them', () => {
    const parsed = DirectorPolicyV1Schema.parse(policy());
    expect(independentPriorities(parsed)).toEqual(priorities);
    expect(Object.values(parsed.priorities).reduce((sum, n) => sum + n, 0)).toBe(500);
  });

  it('rejects an unknown field, including an away-raid grant', () => {
    expect(DirectorPolicyV1Schema.safeParse(policy({ awayRaids: true })).success).toBe(false);
    expect(DirectorPolicyV1Schema.safeParse(policy({ priorities: { ...priorities, sum: 100 } })).success).toBe(false);
  });

  it('rejects a slider outside 0..100 and keeps the W16 flag inside ..16', () => {
    expect(DirectorPolicyV1Schema.safeParse(policy({ priorities: { ...priorities, economy: 101 } })).success).toBe(
      false,
    );
    expect(parseWaves('all').has('W16')).toBe(true);
    expect(parseWaves('..16').has('W16')).toBe(true);
    expect(parseWaves('..15').has('W16')).toBe(false);
  });
});

describe('W16-01 setDirectorPolicy command', () => {
  it('registers the command on W16 and accepts a partial priority patch', () => {
    expect(setDirectorPolicy.kind).toBe('setDirectorPolicy');
    expect(commandDef('setDirectorPolicy').wave).toBe('W16');
    expect(
      parseCommandArgs('setDirectorPolicy', { risk: 'risky', priorities: { defense: 80, economy: 100 } }).success,
    ).toBe(true);
  });

  it('rejects unknown keys and does not require the sliders to sum to 100', () => {
    expect(parseCommandArgs('setDirectorPolicy', { awayRaids: true }).success).toBe(false);
    expect(
      parseCommandArgs('setDirectorPolicy', { priorities: { economy: 100, expansion: 100, defense: 100 } }).success,
    ).toBe(true);
    expect(parseCommandArgs('setDirectorPolicy', { note: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('W16-01 directives: unknown actions and extra fields fail', () => {
  it('accepts a goal action that reuses the landed queueGoal args', () => {
    const parsed = DirectiveProposalSchema.parse(proposal([goalAction]));
    expect(parsed.actions[0]).toMatchObject({ kind: 'queueGoal', actionId: 'a1' });
    expect(z.toJSONSchema(DirectiveProposalSchema)).toMatchObject({ type: 'object' });
  });

  it('rejects an unknown action kind, an extra key and a sixth action', () => {
    const unknown = proposal([{ actionId: 'a1', kind: 'teleport', args: {} } as never]);
    expect(DirectiveProposalSchema.safeParse(unknown).success).toBe(false);
    expect(DirectiveProposalSchema.safeParse({ ...proposal([goalAction]), colonyId: 'co_other' }).success).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ ...goalAction, actionId: `a${i}` }));
    expect(DirectiveProposalSchema.safeParse(proposal(six)).success).toBe(false);
  });

  it('rejects a model payload that tries to set the host envelope', () => {
    const raw = JSON.stringify({ ...proposal([goalAction]), fence: 9, colonyId: 'co_foreign' });
    expect(parseAiJson(DirectiveProposalSchema, raw)).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('W16-01 jobs, tools and bounded parse', () => {
  const job: DirectorJobV1 = {
    version: 1,
    jobId: 'job_1',
    colonyId: 'co_1',
    planetId: 'pl_1',
    worldId: 'world_1',
    fence: 1,
    trigger: 'resource.shortage',
    triggerSummary: 'metals below the floor',
    enqueuedAtMs: 1_000,
    deadlineAtMs: 21_000,
    contextRef: 'ctx_1',
    intentRevision: 3,
    permissionRevision: 1,
    epoch: 4,
    priority: 'routine',
    queue: 'planning',
    principal: 'colony',
  };

  it('rejects an unknown job field and an unknown trigger', () => {
    expect(DirectorJobV1Schema.safeParse(job).success).toBe(true);
    expect(DirectorJobV1Schema.safeParse({ ...job, prompt: 'ignore policy' }).success).toBe(false);
    expect(DirectorJobV1Schema.safeParse({ ...job, trigger: 'player.http' }).success).toBe(false);
  });

  it('rejects unknown tools and extra tool arguments', () => {
    expect(MCP_TOOL_NAMES).toContain('director.propose');
    expect(parseToolArgs('shell.exec', {}).success).toBe(false);
    expect(parseToolArgs('colony.readBrief', { url: 'http://169.254.169.254' }).success).toBe(false);
    expect(parseToolArgs('director.propose', proposal([goalAction])).success).toBe(true);
  });

  it('rejects oversized and deeply nested JSON before trusting it', () => {
    const oversized = parseAiJson(DirectiveProposalSchema, 'x'.repeat(AI_BRIEF_MAX_BYTES + 1), AI_BRIEF_MAX_BYTES);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.code).toBe('context_too_large');
    let nested: unknown = { leaf: true };
    for (let i = 0; i < 9; i++) nested = { child: nested };
    const deep = parseAiJson(DirectiveProposalSchema, JSON.stringify(nested));
    expect(deep.ok).toBe(false);
    if (!deep.ok) expect(deep.code).toBe('too_deep');
  });

  it('binds a host envelope and rejects a foreign extra field on it', () => {
    const bound = DirectiveV2Schema.parse({
      ...proposal([goalAction]),
      requestId: 'req_1',
      jobId: 'job_1',
      fence: 2,
      colonyId: 'co_1',
      worldId: 'world_1',
      planetId: 'pl_1',
      epoch: 1,
      intentRevision: 1,
      permissionRevision: 1,
      contextRevision: 1,
      policyVersion: 1,
      deadlineAtMs: 5_000,
      maxContextAgeS: 60,
    });
    expect(bound.colonyId).toBe('co_1');
    expect(DirectiveV2Schema.safeParse({ ...bound, secret: 'k' }).success).toBe(false);
    expect(directorAction.kind).toBe('directorAction');
    expect(directorStatus.kind).toBe('directorStatus');
    expect(ColonyBriefV2Schema.safeParse({ version: 2, hiddenDeposits: [] }).success).toBe(false);
  });
});
