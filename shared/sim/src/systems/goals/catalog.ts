import { STAGE_TABLE_ROWS } from '../../data/stages';
import type { WaveId } from '../../kernel/types';
import { DEFAULT_GOAL_BUDGET_BP, type GoalKind } from './types';

export interface GoalCatalogEntry {
  id: GoalKind;
  label: string;
  unlockStage: number;
  defaultBudgetBp: number;
  defaultStepsTotal: number;
  wave: WaveId;
}

/**
 * Canonical HQ goal catalog (`docs/game/units-orders-and-progression-spec.md` §4.6, §6.2).
 */
export const GOAL_CATALOG: Readonly<Record<GoalKind, GoalCatalogEntry>> = {
  establish_colony: {
    id: 'establish_colony',
    label: 'Establish Colony',
    unlockStage: 0,
    defaultBudgetBp: 10_000,
    defaultStepsTotal: 4,
    wave: 'W08',
  },
  grow_economy: {
    id: 'grow_economy',
    label: 'Grow Economy',
    unlockStage: 1,
    defaultBudgetBp: DEFAULT_GOAL_BUDGET_BP,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  secure_power: {
    id: 'secure_power',
    label: 'Secure Power',
    unlockStage: 2,
    defaultBudgetBp: DEFAULT_GOAL_BUDGET_BP,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  defend_colony: {
    id: 'defend_colony',
    label: 'Defend Area',
    unlockStage: 3,
    defaultBudgetBp: 4000,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  clear_corridor: {
    id: 'clear_corridor',
    label: 'Clear Nest',
    unlockStage: 3,
    defaultBudgetBp: 3000,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  expand_territory: {
    id: 'expand_territory',
    label: 'Expand Toward',
    unlockStage: 4,
    defaultBudgetBp: 4000,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  terraform_zone: {
    id: 'terraform_zone',
    label: 'Terraform Zone',
    unlockStage: 4,
    defaultBudgetBp: 3000,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  tech_up: {
    id: 'tech_up',
    label: 'Tech Up',
    unlockStage: 4,
    defaultBudgetBp: 10_000,
    defaultStepsTotal: 1,
    wave: 'W08',
  },
  negotiate_supply: {
    id: 'negotiate_supply',
    label: 'Negotiate',
    unlockStage: 2,
    defaultBudgetBp: DEFAULT_GOAL_BUDGET_BP,
    defaultStepsTotal: 1,
    wave: 'W13',
  },
  build_army: {
    id: 'build_army',
    label: 'Build Army',
    unlockStage: 6,
    defaultBudgetBp: 4000,
    defaultStepsTotal: 1,
    wave: 'W17',
  },
  raid_target: {
    id: 'raid_target',
    label: 'Raid Colony',
    unlockStage: 4,
    defaultBudgetBp: 4000,
    defaultStepsTotal: 1,
    wave: 'W18',
  },
  build_rocket: {
    id: 'build_rocket',
    label: 'Prepare Rocket',
    unlockStage: 10,
    defaultBudgetBp: 10_000,
    defaultStepsTotal: 3,
    wave: 'W21',
  },
};

/** Default suggested HQ goal per stage S0..S10 (`UO-G-03`, §6.2 table). */
export const STAGE_SUGGESTED_GOAL: Readonly<Record<number, GoalKind>> = Object.fromEntries(
  STAGE_TABLE_ROWS.map((row) => [row.stage, row.suggestedGoal as GoalKind]),
);

export function getGoalCatalogEntry(goal: GoalKind): GoalCatalogEntry {
  return GOAL_CATALOG[goal];
}

export function getSuggestedGoalForStage(stage: number): GoalKind {
  return STAGE_SUGGESTED_GOAL[stage] ?? 'establish_colony';
}
