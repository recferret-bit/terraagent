import type { StageRow } from '../../../data';
import { ensureColonyRecord } from '../../../kernel/colonies';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { getColonyGoalHistory, getColonyGoals } from '../../goals/store';
import type { ActiveStageSuggestion, ColonyProgressionState } from '../types';

function isS0SuggestionAccepted(state: PlanetState, colonyIndex: number): boolean {
  const col = state.colonies[colonyIndex];
  if (col?.suggestion === null) return true;
  if (getColonyGoals(state, colonyIndex).some((g) => g.goal === 'establish_colony')) return true;
  if (getColonyGoalHistory(state, colonyIndex).some((g) => g.goal === 'establish_colony')) return true;
  return false;
}

export function maybeOfferS0Suggestion(
  state: PlanetState,
  colonyIndex: number,
  prog: ColonyProgressionState,
  ctx: StepContext,
): boolean {
  const col = ensureColonyRecord(state, colonyIndex, ctx.tick);
  const accepted = isS0SuggestionAccepted(state, colonyIndex);
  if (accepted && (col.activeSuggestion as ActiveStageSuggestion | null | undefined)?.stage === 0) {
    col.activeSuggestion = null;
    col.changedAt = ctx.tick;
  }
  if (prog.offeredSuggestionStages.includes(0)) return false;

  prog.offeredSuggestionStages.push(0);
  if (!prog.emittedStages.includes(0)) prog.emittedStages.push(0);

  const suggestionId = `sug_s0_${colonyIndex}`;
  const title = 'Establish Colony';
  const reason = 'Prepare site, place Command Hub, and build 1 extractor + 1 generator';
  ctx.emit({
    kind: 'suggestionOffered',
    colonyIds: [colonyIndex],
    data: {
      colonyIndex,
      suggestionId,
      stage: 0,
      kind: 'goal',
      goal: 'establish_colony',
      title,
      reason,
    },
  });

  if (!accepted) {
    const sug: ActiveStageSuggestion = {
      suggestionId,
      stage: 0,
      kind: 'goal',
      goal: 'establish_colony',
      title,
      reason,
      offeredAtTick: ctx.tick,
    };
    col.activeSuggestion = sug;
    if (col.suggestion === undefined) col.suggestion = sug;
  } else {
    col.activeSuggestion = null;
  }
  col.changedAt = ctx.tick;
  return true;
}

export function emitStageTransition(
  colonyIndex: number,
  prog: ColonyProgressionState,
  previousStage: number,
  previousUnlockStage: number,
  stageRow: StageRow | undefined,
  ctx?: StepContext,
  override?: string,
  forceEmit = false,
): void {
  const targetStage = prog.stage;
  const alreadyEmitted = prog.emittedStages.includes(targetStage);
  if (!alreadyEmitted) {
    prog.emittedStages.push(targetStage);
  }
  if (ctx && (!alreadyEmitted || forceEmit)) {
    ctx.emit({
      kind: 'stageReached',
      colonyIds: [colonyIndex],
      data: {
        colonyIndex,
        stage: targetStage,
        previousStage,
        ...(stageRow
          ? {
              title: stageRow.label,
              teaches: stageRow.teaches,
              units: [...stageRow.units],
              buildings: [...stageRow.buildings],
              orders: [...stageRow.orders],
            }
          : {}),
        ...(override ? { override } : {}),
      },
    });
  }
  if (ctx && (prog.unlockStage > previousUnlockStage || forceEmit)) {
    ctx.emit({
      kind: 'stageUnlocked',
      colonyIds: [colonyIndex],
      data: {
        colonyIndex,
        unlockStage: prog.unlockStage,
        previousUnlockStage,
        ...(stageRow
          ? {
              units: [...stageRow.units],
              buildings: [...stageRow.buildings],
              orders: [...stageRow.orders],
            }
          : {}),
      },
    });
  }
}
