import { rowOf } from '../../../ecs/store';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { resolveColonyIndex } from '../../diplomacy/store';
import { completeColonyGoal } from '../../goals';
import { emitGoalProgress, saveColonyGoals } from '../../goals/store';
import type { ColonyGoalEntry } from '../../goals/types';
import { launchColonyRaid } from '../raidTask';
import {
  ensureColonyPvpRecord,
  getPvpState,
  savePvpState,
  type ActiveRaidGroupState,
} from '../store';

export function recordLaunchedRaid(
  state: PlanetState,
  attackerColony: number,
  targetColony: number,
  unitIds: readonly number[],
  groupId: number,
  dest: { q: number; r: number; targetEntityId?: number },
  tick: number,
  ctx?: StepContext,
): ActiveRaidGroupState {
  ensureColonyPvpRecord(state, attackerColony, tick, ctx?.data);
  const pvpState = getPvpState(state);
  const raidId = `raid_${attackerColony}_${targetColony}_${pvpState.nextRaidSeq++}`;
  const raid: ActiveRaidGroupState = {
    raidId,
    attackerColony,
    targetColony,
    startedAtTick: tick,
    unitIds: [...unitIds],
    groupId,
    currentTargetEntityId: dest.targetEntityId,
    currentTargetQ: dest.q,
    currentTargetR: dest.r,
    repelled: false,
  };
  pvpState.activeRaids[raidId] = raid;
  const colRec = pvpState.byColony[String(attackerColony)];
  if (colRec) {
    colRec.activeRaidId = raidId;
    colRec.activeRaidTargetColony = targetColony;
    colRec.raidGroupId = groupId;
    colRec.raiderUnitIds = [...unitIds];
  }
  savePvpState(state, pvpState, tick);

  if (ctx) {
    const attackerCol = state.colonies[attackerColony];
    const targetCol = state.colonies[targetColony];
    ctx.emit({
      kind: 'raidStarted',
      colonyIds: [attackerColony, targetColony],
      data: {
        raidId,
        colonyIndex: targetColony,
        ...(typeof targetCol?.id === 'string' ? { colonyId: targetCol.id, targetColonyId: targetCol.id } : {}),
        ...(typeof attackerCol?.id === 'string' ? { attackerColonyId: attackerCol.id } : {}),
        attackerColony,
        targetColony,
        count: unitIds.length,
        unitIds: [...unitIds],
        q: dest.q,
        r: dest.r,
      },
    });
  }
  return raid;
}

/** Goal executor for `raid_target` ("Raid Colony", `W18-02`). */
export function stepRaidTargetGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  const rawRef = goal.params.targetColonyId ?? goal.params.target;
  const targetColony = resolveColonyIndex(state, rawRef as string | number | undefined);
  if (targetColony < 0 || targetColony === colonyIndex || !state.colonies[targetColony]) {
    goal.detail = 'Invalid raid target colony.';
    saveColonyGoals(state, colonyIndex, goals, tick);
    return;
  }

  const targetCol = state.colonies[targetColony];
  if (targetCol?.status === 'eliminated') {
    goal.detail = `Target colony #${targetColony} eliminated.`;
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  const pvpState = getPvpState(state);
  const colRec = pvpState.byColony[String(colonyIndex)];
  const activeRaid =
    colRec?.activeRaidId ? pvpState.activeRaids[colRec.activeRaidId] : undefined;

  if (!activeRaid || activeRaid.targetColony !== targetColony || activeRaid.repelled) {
    const launched = launchColonyRaid(state, colonyIndex, targetColony, ctx, {
      q: goal.params.q,
      r: goal.params.r,
      data: ctx?.data,
    });
    if (!launched.ok) {
      goal.detail = `Raid blocked: ${launched.code}`;
      saveColonyGoals(state, colonyIndex, goals, tick);
      return;
    }
    goal.stepsTotal = 2;
    goal.stepsCompleted = 1;
    goal.progress = 0.5;
    goal.detail = `Raiding colony #${targetColony} (${launched.raid.unitIds.length} units).`;
    saveColonyGoals(state, colonyIndex, goals, tick);
    emitGoalProgress(ctx, colonyIndex, goal);
    return;
  }

  const aliveRaiders = activeRaid.unitIds.filter((id) => {
    const r = rowOf(state.entities, id);
    return r >= 0 && state.entities.cols.hp[r]! > 0;
  });
  goal.detail = `Raiding colony #${targetColony} (${aliveRaiders.length} units active).`;
  saveColonyGoals(state, colonyIndex, goals, tick);
}
