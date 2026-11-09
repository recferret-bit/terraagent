import {
  AI_MAX_ACTIONS,
  DirectiveProposalSchema,
  parseAiJson,
  parseWaves,
  type DirectiveAction,
  type DirectiveProposal,
  type DirectorOutcome,
  type DirectorRisk,
} from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';

/**
 * Deterministic fixtures for AI_ORCHESTRATOR §11.
 * A player `note` is untrusted and is never copied into a rationale or an action (AI-18).
 * Failure text is not a proposal: `parseAiJson` rejects it, and it carries no `apply` flag or command list.
 */

export const MOCK_FAULTS = [
  'none',
  'timeout',
  'invalid_json',
  'schema_violation',
  'http_429',
  'http_500',
  'slow',
  'prompt_injection',
  'cross_colony',
  'over_budget',
  'stale_revision',
  'raid_proposal',
] as const;

export type MockFault = (typeof MOCK_FAULTS)[number];

export type FailingFault = Exclude<MockFault, 'none' | 'slow' | 'prompt_injection'>;

type FailureOutcome = Extract<
  DirectorOutcome,
  'timeout' | 'invalid' | 'unauthorized' | 'provider_error' | 'budget_exhausted' | 'superseded'
>;

export interface MockDirectorInput {
  readonly risk: DirectorRisk;
  readonly note?: string;
  readonly fault?: MockFault;
}

export interface MockDirectorSuccess {
  readonly ok: true;
  readonly outcome: 'proposed';
  readonly proposal: DirectiveProposal;
  /** Reported only. Callers must not sleep for this hint. */
  readonly delayMs?: number;
}

export interface MockDirectorFailure {
  readonly ok: false;
  readonly outcome: FailureOutcome;
  readonly raw: string;
}

export type MockDirectorResult = MockDirectorSuccess | MockDirectorFailure;

/** Hint for the slow fixture. Not a sleep, and not a balance number. */
const SLOW_DELAY_MS = 25;

const DIRECTOR = compileData(parseWaves('..16'));

const RATIONALE: Record<DirectorRisk, string> = {
  conservative: 'Hold one grow_economy goal at the conservative commitment. Prefer redundant supply over specialization.',
  risky: 'Commit grow_economy at the risky ceiling and weight metals above minerals and bio. Player ceilings still bind.',
};

export function isMockFault(value: string): value is MockFault {
  return (MOCK_FAULTS as readonly string[]).includes(value);
}

export function mockDirectorPlan(input: MockDirectorInput): MockDirectorResult {
  const fault = input.fault ?? 'none';
  if (fault === 'slow') return { ...proposed(input.risk), delayMs: SLOW_DELAY_MS };
  if (fault === 'none' || fault === 'prompt_injection') return proposed(input.risk);
  return failedPlan(input.risk, fault);
}

function proposed(risk: DirectorRisk): MockDirectorSuccess {
  return { ok: true, outcome: 'proposed', proposal: legalProposal(risk) };
}

function profileInt(risk: DirectorRisk, field: 'commitBp' | 'maxCandidates', min: number, max: number): number {
  const value = dataRow(DIRECTOR, 'director', risk)[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`director.${risk}.${field} is not an integer in ${min}..${max}`);
  }
  return value;
}

function legalProposal(risk: DirectorRisk): DirectiveProposal {
  const cap = profileInt(risk, 'maxCandidates', 1, AI_MAX_ACTIONS);
  const budgetBp = profileInt(risk, 'commitBp', 0, 10_000);
  const actions: DirectiveAction[] = [
    { actionId: 'grow-economy', kind: 'queueGoal', args: { goal: 'grow_economy', budgetBp } },
  ];
  if (risk === 'risky' && actions.length < cap) {
    actions.push({ actionId: 'harvest-metals', kind: 'setHarvestWeights', args: { metals: 70, minerals: 20, bio: 10 } });
  }
  const parsed = DirectiveProposalSchema.safeParse({
    version: 2,
    skills: [{ id: 'resources', version: 1 }],
    rationale: RATIONALE[risk],
    observedDependencies: [],
    actions: actions.slice(0, cap),
  });
  if (!parsed.success) throw new Error('mock director proposal failed the directive schema');
  return parsed.data;
}

/** Shape failures are `invalid`. A foreign colony or a raid is `unauthorized`: risk does not grant either (AI-12, AI-17). */
function failedPlan(risk: DirectorRisk, fault: FailingFault): MockDirectorFailure {
  switch (fault) {
    case 'timeout':
      return refuse('timeout', '');
    case 'http_429':
    case 'http_500':
      return refuse('provider_error', '');
    case 'over_budget':
      return refuse('budget_exhausted', '');
    case 'stale_revision':
      return refuse('superseded', '');
    case 'invalid_json':
      return refuse('invalid', '{"version":2,');
    case 'schema_violation':
      return refuse('invalid', schemaViolationRaw());
    case 'cross_colony':
      return refuse('unauthorized', crossColonyRaw(risk));
    case 'raid_proposal':
      return refuse('unauthorized', raidRaw());
    default: {
      const neverFault: never = fault;
      return neverFault;
    }
  }
}

function refuse(outcome: FailureOutcome, raw: string): MockDirectorFailure {
  if (parseAiJson(DirectiveProposalSchema, raw).ok) throw new Error(`mock fault ${outcome} returned a directive`);
  if (/"apply"\s*:\s*true/.test(raw) || raw.includes('"commands"')) throw new Error(`mock fault ${outcome} includes an apply command`);
  return { ok: false, outcome, raw };
}

function schemaViolationRaw(): string {
  return JSON.stringify({
    version: 2,
    skills: [{ id: 'resources', version: 1 }],
    rationale: 'Unknown action kind is rejected.',
    observedDependencies: [],
    actions: [{ actionId: 'act-teleport', kind: 'teleport', args: { q: 0, r: 0 } }],
  });
}

function crossColonyRaw(risk: DirectorRisk): string {
  return JSON.stringify({ ...legalProposal(risk), colonyId: 'colony:other' });
}

function raidRaw(): string {
  return JSON.stringify({
    version: 2,
    skills: [{ id: 'resources', version: 1 }],
    rationale: 'Raid proposals are outside director authority.',
    observedDependencies: [],
    actions: [{ actionId: 'act-raid', kind: 'raid_target', args: { goal: 'raid_target' } }],
  });
}
