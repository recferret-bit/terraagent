import type { DirectiveActionKind, DirectorSkillFamily, DirectorSkillSpec, GoalKind } from '@terra/contracts';
import { isGoalExecutable } from '../goals/executors';

interface SkillRow {
  readonly id: string;
  readonly family: DirectorSkillFamily;
  readonly purpose: string;
  readonly goal: GoalKind;
  readonly requiredWaves: readonly string[];
  readonly minStage: number;
  readonly actions: readonly DirectiveActionKind[];
}

/** Superset. A request only receives rows whose goal executor is registered and whose waves are on. */
const ROWS: readonly SkillRow[] = [
  { id: 'recovery', family: 'recovery', purpose: 'Restore the colony and its power.', goal: 'establish_colony', requiredWaves: ['W08'], minStage: 0, actions: ['queueGoal'] },
  { id: 'resources', family: 'resources', purpose: 'Grow extraction inside the commitment cap.', goal: 'grow_economy', requiredWaves: ['W08'], minStage: 1, actions: ['queueGoal', 'setHarvestWeights'] },
  { id: 'power', family: 'recovery', purpose: 'Restore net power before new industry.', goal: 'secure_power', requiredWaves: ['W08'], minStage: 2, actions: ['queueGoal'] },
  { id: 'defence', family: 'defence', purpose: 'Hold a protected approach.', goal: 'defend_colony', requiredWaves: ['W07'], minStage: 3, actions: ['queueGoal'] },
  { id: 'scouting', family: 'scouting', purpose: 'Clear a corridor that was already observed.', goal: 'clear_corridor', requiredWaves: ['W08'], minStage: 2, actions: ['queueGoal', 'moveUnit'] },
  { id: 'expansion', family: 'expansion', purpose: 'Extend along an observed route.', goal: 'expand_territory', requiredWaves: ['W08'], minStage: 3, actions: ['queueGoal'] },
  { id: 'terraforming', family: 'terraforming', purpose: 'Prepare ground inside a protected area.', goal: 'terraform_zone', requiredWaves: ['W05'], minStage: 2, actions: ['queueGoal', 'enqueueTask'] },
  { id: 'logistics', family: 'logistics', purpose: 'Trade inside stock and price caps.', goal: 'negotiate_supply', requiredWaves: ['W10'], minStage: 3, actions: ['queueGoal'] },
  { id: 'technology', family: 'technology', purpose: 'Queue an upgrade the player already allowed.', goal: 'tech_up', requiredWaves: ['W17'], minStage: 4, actions: ['queueGoal'] },
  { id: 'diplomacy', family: 'diplomacy', purpose: 'Raid only an eligible target when raids are permitted.', goal: 'raid_target', requiredWaves: ['W18'], minStage: 4, actions: ['queueGoal'] },
  { id: 'settlement', family: 'settlement', purpose: 'Prepare a launch the player still has to authorise.', goal: 'build_rocket', requiredWaves: ['W21'], minStage: 5, actions: ['queueGoal'] },
];

export interface SkillSelectInput {
  readonly waves: ReadonlySet<string>;
  readonly stage: number;
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  readonly raidsPermitted?: boolean;
}

function eligible(row: SkillRow, input: SkillSelectInput): boolean {
  if (input.stage < row.minStage) return false;
  if (row.requiredWaves.some((wave) => !input.waves.has(wave))) return false;
  if (row.id === 'diplomacy' && !input.raidsPermitted) return false;
  if (!isGoalExecutable(row.goal, input.waves)) return false;
  if (input.deny?.includes(row.id)) return false;
  if (input.allow && input.allow.length > 0 && !input.allow.includes(row.id)) return false;
  return true;
}

function toSpec(row: SkillRow): DirectorSkillSpec {
  return {
    id: row.id,
    version: 1,
    family: row.family,
    purpose: row.purpose,
    requiredWaves: [...row.requiredWaves],
    minStage: row.minStage,
    tools: ['colony.readBrief', 'goals.list', 'actions.preview', 'director.propose'],
    actions: [...row.actions],
    fixtures: [`${row.id}-conservative`, `${row.id}-risky`],
  };
}

/** At most six skills. Missing executors are omitted, not advertised (AI §6). */
export function selectDirectorSkills(input: SkillSelectInput): DirectorSkillSpec[] {
  const matched = ROWS.filter((row) => eligible(row, input));
  if (matched.length > 6 && input.raidsPermitted && matched.some((r) => r.id === 'diplomacy')) {
    return matched.filter((r) => r.id !== 'scouting').slice(0, 6).map(toSpec);
  }
  return matched.slice(0, 6).map(toSpec);
}

export function directorSkillIds(): readonly string[] {
  return ROWS.map((row) => row.id);
}
