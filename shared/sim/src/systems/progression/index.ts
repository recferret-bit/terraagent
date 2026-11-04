import { getStageSpec, type StageRow } from '../../data';
import { defineCommandHandler } from '../../kernel/commands';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem, type SimSystem } from '../../kernel/system';
import { parseArgs } from '../command';
import { defineSimModule } from '../define';
import { getColonyGoalHistory, getColonyGoals } from '../goals/store';
import { ticksToRemainingSeconds } from './dwell';
import { getColonyProgression, saveColonyProgression } from './store';
import {
  countTotalExploredTiles,
  evaluateStageTrigger,
  isColonyLanded,
  resolveCompiledStageRow,
} from './triggers';
import { computeColonyThreatStage, syncColonyThreatStage } from './threatStage';
import {
  OVERRIDE_TARGET_STAGE,
  STAGE_EVAL_INTERVAL_TICKS,
  type ActiveStageSuggestion,
  type ColonyProgressionState,
  type StageOverride,
} from './types';

export * from './types';
export * from './dwell';
export * from './store';
export * from './triggers';
export * from './threatStage';
export * from './unlockStage';
export * from './threat';
export * from './validate';

function isS0SuggestionAccepted(state: PlanetState, colonyIndex: number): boolean {
  const col = state.colonies[colonyIndex];
  if (col?.suggestion === null) return true;
  if (getColonyGoals(state, colonyIndex).some((g) => g.goal === 'establish_colony')) return true;
  if (getColonyGoalHistory(state, colonyIndex).some((g) => g.goal === 'establish_colony')) return true;
  return false;
}

function maybeOfferS0Suggestion(
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

function emitStageTransition(
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

export function advanceColonyToStage(
  colonyIndex: number,
  prog: ColonyProgressionState,
  targetStage: number,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
  override?: string,
  forceEmit = false,
): void {
  const previousStage = prog.stage;
  const previousUnlockStage = prog.unlockStage;
  prog.stage = targetStage;
  prog.unlockStage = Math.max(prog.unlockStage, targetStage);
  prog.stageEnteredAtTick = tick;
  if (targetStage >= 2 && prog.s2ReachedAtTick == null) prog.s2ReachedAtTick = tick;
  if (targetStage >= 3 && prog.s3ReachedAtTick == null) prog.s3ReachedAtTick = tick;
  prog.dwellRemainingTicks = null;
  prog.dwellRemainingS = null;
  prog.triggerSatisfiedForStage = null;
  prog.stageOverride = override;

  for (let s = 0; s < targetStage; s++) {
    if (!prog.emittedStages.includes(s)) prog.emittedStages.push(s);
  }
  const stageRow = resolveCompiledStageRow(targetStage, data) ?? getStageSpec(targetStage);
  emitStageTransition(colonyIndex, prog, previousStage, previousUnlockStage, stageRow, ctx, override, forceEmit);
}

function advanceDwellAndStages(
  state: PlanetState,
  colonyIndex: number,
  prog: ColonyProgressionState,
  elapsedTicks: number,
  ctx: StepContext,
): void {
  let remaining = elapsedTicks;
  while (remaining >= 0) {
    const nextStage = prog.stage + 1;
    const nextRow = resolveCompiledStageRow(nextStage, ctx.data);
    if (!nextRow) {
      prog.dwellRemainingTicks = null;
      prog.triggerSatisfiedForStage = null;
      break;
    }
    if (prog.triggerSatisfiedForStage !== null && prog.triggerSatisfiedForStage !== nextStage) {
      prog.dwellRemainingTicks = null;
      prog.triggerSatisfiedForStage = null;
    }
    const triggerMet =
      (prog.dwellRemainingTicks !== null && prog.triggerSatisfiedForStage === nextStage) ||
      evaluateStageTrigger(state, colonyIndex, nextStage, ctx.data, prog.initialExploredCount);
    if (!triggerMet) {
      prog.dwellRemainingTicks = null;
      prog.triggerSatisfiedForStage = null;
      break;
    }
    if (prog.dwellRemainingTicks === null) {
      prog.dwellRemainingTicks = Math.max(0, Number(nextRow.dwellS ?? 0));
      prog.triggerSatisfiedForStage = nextStage;
    }
    if (remaining === 0 && prog.dwellRemainingTicks > 0) {
      break;
    }
    if (prog.dwellRemainingTicks <= remaining) {
      const consumed = Math.max(0, prog.dwellRemainingTicks);
      remaining -= consumed;
      advanceColonyToStage(colonyIndex, prog, nextStage, ctx.tick, ctx.data, ctx);
      if (remaining === 0) {
        const afterRow = resolveCompiledStageRow(prog.stage + 1, ctx.data);
        if (afterRow && evaluateStageTrigger(state, colonyIndex, prog.stage + 1, ctx.data, prog.initialExploredCount)) {
          prog.dwellRemainingTicks = Math.max(0, Number(afterRow.dwellS ?? 0));
          prog.triggerSatisfiedForStage = prog.stage + 1;
        }
        break;
      }
    } else {
      prog.dwellRemainingTicks -= remaining;
      break;
    }
  }
}

/**
 * Evaluates and advances progression for `colonyIndex` on a 1 Hz cadence (`TICKS_PER_SECOND = 5` ticks).
 */
export function stepColonyProgression(state: PlanetState, colonyIndex: number, ctx: StepContext): void {
  if (!isColonyLanded(state, colonyIndex)) {
    syncColonyThreatStage(state, colonyIndex, ctx.tick);
    return;
  }
  const prog = getColonyProgression(state, colonyIndex, ctx.data);
  let changed = false;

  if (prog.initialExploredCount === undefined) {
    prog.initialExploredCount = countTotalExploredTiles(state, colonyIndex);
    changed = true;
  }
  if (maybeOfferS0Suggestion(state, colonyIndex, prog, ctx)) {
    changed = true;
  }

  const startTick = Math.max(0, ctx.tick - ctx.dt);
  if (prog.lastEvaluatedTick === null) {
    prog.lastEvaluatedTick = startTick;
    changed = true;
    const nextStage = prog.stage + 1;
    const nextRow = resolveCompiledStageRow(nextStage, ctx.data);
    if (prog.dwellRemainingTicks === null && nextRow && evaluateStageTrigger(state, colonyIndex, nextStage, ctx.data, prog.initialExploredCount)) {
      prog.dwellRemainingTicks = Math.max(0, Number(nextRow.dwellS ?? 0));
      prog.triggerSatisfiedForStage = nextStage;
    }
  }

  const elapsedTicks = ctx.tick - prog.lastEvaluatedTick;
  if (elapsedTicks >= STAGE_EVAL_INTERVAL_TICKS) {
    prog.lastEvaluatedTick = ctx.tick;
    advanceDwellAndStages(state, colonyIndex, prog, elapsedTicks, ctx);
    changed = true;
  }

  const nextThreatStage = computeColonyThreatStage(state, colonyIndex, prog.stage);
  if (prog.threatStage !== nextThreatStage) {
    prog.threatStage = nextThreatStage;
    changed = true;
  }

  const col = state.colonies[colonyIndex];
  if (
    changed ||
    !col ||
    col.stage !== prog.stage ||
    col.threatStage !== prog.threatStage ||
    col.stageDwellRemainingS !== ticksToRemainingSeconds(prog.dwellRemainingTicks)
  ) {
    saveColonyProgression(state, colonyIndex, prog, ctx.tick, ctx.data);
  }
}

/** Triggers a safety override (`fauna` → S3, `storage` → S2, `rival`/`resource` → S4, `power` → S5). */
export function triggerStageOverride(
  state: PlanetState,
  colonyIndex: number,
  override: StageOverride,
  ctx?: StepContext,
): ColonyProgressionState {
  const tick = ctx?.tick ?? state.meta.tick;
  const data = ctx?.data;
  const col = ensureColonyRecord(state, colonyIndex, tick);
  if (col.status === 'founding') col.status = 'active';
  const prog = getColonyProgression(state, colonyIndex, data);
  const targetStage = OVERRIDE_TARGET_STAGE[override];
  advanceColonyToStage(colonyIndex, prog, targetStage, tick, data, ctx, override, true);
  prog.lastEvaluatedTick = tick;
  saveColonyProgression(state, colonyIndex, prog, tick, data);
  return prog;
}

/**
 * Advances an S0 colony to `S1 First Light` immediately when its Command Hub T1 completes construction (`UO-LC-02`, §6.2).
 */
export function onCommandHubCompleted(
  state: PlanetState,
  colonyIndex: number,
  ctx?: Partial<StepContext>,
): void {
  if (!ctx?.flags || !ctx.flags.has('W08')) return;
  const tick = ctx.tick ?? state.meta.tick;
  const data = ctx.data;
  const prog = getColonyProgression(state, colonyIndex, data);
  if (prog.stage > 0) return;
  advanceColonyToStage(colonyIndex, prog, 1, tick, data, ctx as StepContext | undefined);
  prog.lastEvaluatedTick = tick;
  saveColonyProgression(state, colonyIndex, prog, tick, data);
}

export const devStageHandler = defineCommandHandler({
  kind: 'dev.stage',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.stage', cmd.args);
    if (!parsed) return 'invalid_args';
    const colIdx =
      parsed.colonyIndex ?? (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0 ? cmd.colonyIndex : 0);
    const col = ensureColonyRecord(state, colIdx, ctx.tick);
    if (col.status === 'founding') col.status = 'active';
    const prog = getColonyProgression(state, colIdx, ctx.data);

    if (parsed.op === 'set') {
      advanceColonyToStage(colIdx, prog, parsed.stage, ctx.tick, ctx.data, ctx, undefined, true);
      prog.lastEvaluatedTick = ctx.tick;
      saveColonyProgression(state, colIdx, prog, ctx.tick, ctx.data);
      return;
    }

    if (parsed.op === 'skip-dwell') {
      const nextStage = prog.stage + 1;
      const nextRow = resolveCompiledStageRow(nextStage, ctx.data) ?? getStageSpec(nextStage);
      if (!nextRow) return;
      const hasDwell = prog.dwellRemainingTicks !== null && prog.dwellRemainingTicks > 0;
      const triggerMet = evaluateStageTrigger(state, colIdx, nextStage, ctx.data, prog.initialExploredCount);
      if (hasDwell || triggerMet) {
        advanceColonyToStage(colIdx, prog, nextStage, ctx.tick, ctx.data, ctx);
        prog.lastEvaluatedTick = ctx.tick;
        saveColonyProgression(state, colIdx, prog, ctx.tick, ctx.data);
      }
      return;
    }

    if (parsed.op === 'trigger') {
      triggerStageOverride(state, colIdx, parsed.override, ctx);
    }
  },
});

export const progressionSystem: SimSystem & { readonly name: string } = defineSystem({
  id: 'progression',
  slot: 12,
  wave: 'W08',
  run(state, ctx) {
    for (const col of state.colonies) {
      if (!col) continue;
      stepColonyProgression(state, col.index, ctx);
    }
  },
}) as SimSystem & { readonly name: string };
(progressionSystem as { name?: string }).name = 'progression';

export const progression = defineSimModule({
  id: 'progression',
  wave: 'W08',
  systems: [progressionSystem],
  handlers: [devStageHandler],
});

export default progression;
