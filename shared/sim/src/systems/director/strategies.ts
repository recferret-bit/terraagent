import type { DirectiveAction, DirectorRisk, GoalKind } from '@terra/contracts';
import { dataRow, type CompiledData } from '../../data';

export type CoreSkill = 'recovery' | 'resources' | 'power';

const GOAL: Record<CoreSkill, GoalKind> = {
  recovery: 'establish_colony',
  resources: 'grow_economy',
  power: 'secure_power',
};

/** One legal action for a core skill. Commitment comes from that risk's data row. */
export function coreSkillAction(skill: CoreSkill, risk: DirectorRisk, data: CompiledData): DirectiveAction {
  const row = dataRow(data, 'director', risk);
  const budgetBp = row.commitBp as number;
  const resource = skill === 'power' ? undefined : 'metals.t1';
  return {
    actionId: `${skill}-${risk}`,
    kind: 'queueGoal',
    args: {
      goal: GOAL[skill],
      budgetBp,
      ...(resource ? { params: { resource } } : {}),
    },
  };
}

export function coreSkillLimits(risk: DirectorRisk, data: CompiledData) {
  const row = dataRow(data, 'director', risk);
  return {
    reserveFloorBp: row.reserveFloorBp as number,
    commitBp: row.commitBp as number,
    openGoalSlots: 2,
    awayRaids: false,
  };
}
