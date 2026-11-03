import { getStageSpec, type StageRow } from '../../data';
import { defineCommandHandler } from '../../kernel/commands';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem, type SimSystem } from '../../kernel/system';
import { parseArgs } from '../command';
import { defineSimModule } from '../define';
import { getColonyGoalHistory, getColonyGoals } from '../goals/store';
import {
  countTotalExploredTiles,
  evaluateStageTrigger,
  isColonyLanded,
  resolveCompiledStageRow,
} from './triggers';
import {
  OVERRIDE_TARGET_STAGE,
  STAGE_EVAL_INTERVAL_TICKS,
  type ActiveStageSuggestion,
  type ColonyProgressionState,
  type StageOverride,
} from './types';

export * from './types';
export * from './triggers';

function cloneProgressionState(p: ColonyProgressionState): ColonyProgressionState {
  return {
    ...p,
    emittedStages: [...p.emittedStages],
    offeredSuggestionStages: [...p.offeredSuggestionStages],
  };
}

function readProgressionBlobMap(state: PlanetState): Record<string, ColonyProgressionState> {
  const raw = state.blobs.progression?.value;
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const source =
    obj.byColony && typeof obj.byColony === 'object' ? (obj.byColony as Record<string, unknown>) : obj;
  const out: Record<string, ColonyProgressionState> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && 'stage' in v) {
      const rec = v as ColonyProgressionState;
      out[k] = {
        ...rec,
        emittedStages: Array.isArray(rec.emittedStages) ? [...rec.emittedStages] : [],
        offeredSuggestionStages: Array.isArray(rec.offeredSuggestionStages) ? [...rec.offeredSuggestionStages] : [],
      };
    }
  }
  return out;
}

function computeNextConditionText(stage: number, data?: CompiledDataLike): string {
  const nextRow = resolveCompiledStageRow(stage + 1, data) ?? (data?.tables && 'stages' in data.tables ? undefined : getStageSpec(stage + 1));
  if (!nextRow) return '';
  return nextRow.unlockConditionText || nextRow.triggerText || '';
}

function ticksToRemainingSeconds(ticks: number | null): number | null {
  if (ticks === null || !Number.isFinite(ticks)) return null;
  return Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
}

export function getColonyProgression(
  state: PlanetState,
  colonyIndex = 0,
  data?: CompiledDataLike,
): ColonyProgressionState {
  const map = readProgressionBlobMap(state);
  const existing = map[String(colonyIndex)];
  const col = state.colonies[colonyIndex] as ColonyState | undefined;
  const colStage = typeof col?.stage === 'number' ? col.stage : undefined;
  const colUnlockStage = typeof col?.unlockStage === 'number' ? col.unlockStage : undefined;
  const colThreatStage = typeof col?.threatStage === 'number' ? col.threatStage : undefined;
  const colDwellTicks = typeof col?.dwellRemainingTicks === 'number' ? col.dwellRemainingTicks : undefined;

  if (existing) {
    const synced = cloneProgressionState(existing);
    if (colStage !== undefined && colStage !== synced.stage) {
      synced.stage = colStage;
    }
    if (colUnlockStage !== undefined && colUnlockStage > synced.unlockStage) {
      synced.unlockStage = colUnlockStage;
    }
    synced.unlockStage = Math.max(synced.unlockStage, synced.stage);
    if (colThreatStage !== undefined) {
      synced.threatStage = colThreatStage;
    }
    if (colDwellTicks !== undefined && synced.dwellRemainingTicks === null) {
      synced.dwellRemainingTicks = colDwellTicks;
      synced.triggerSatisfiedForStage = synced.stage + 1;
    }
    synced.dwellRemainingS = ticksToRemainingSeconds(synced.dwellRemainingTicks);
    synced.nextStageConditionText = computeNextConditionText(synced.stage, data);
    return synced;
  }

  const stage = colStage ?? 0;
  const unlockStage = Math.max(colUnlockStage ?? 0, stage);
  const threatStage = colThreatStage ?? 0;
  const dwellRemainingTicks = colDwellTicks ?? null;
  return {
    colonyIndex,
    stage,
    unlockStage,
    threatStage,
    stageEnteredAtTick: typeof col?.stageEnteredAtTick === 'number' ? col.stageEnteredAtTick : state.meta.tick,
    dwellRemainingTicks,
    dwellRemainingS: ticksToRemainingSeconds(dwellRemainingTicks),
    triggerSatisfiedForStage: dwellRemainingTicks !== null ? stage + 1 : null,
    nextStageConditionText: computeNextConditionText(stage, data),
    emittedStages: Array.isArray(col?.emittedStages) ? [...(col.emittedStages as number[])] : [0],
    offeredSuggestionStages: [],
    lastEvaluatedTick: null,
  };
}

export function saveColonyProgression(
  state: PlanetState,
  colonyIndex: number,
  prog: ColonyProgressionState,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): void {
  prog.unlockStage = Math.max(prog.unlockStage, prog.stage);
  prog.dwellRemainingS = ticksToRemainingSeconds(prog.dwellRemainingTicks);
  prog.nextStageConditionText = computeNextConditionText(prog.stage, data);

  const map = readProgressionBlobMap(state);
  map[String(colonyIndex)] = cloneProgressionState(prog);
  setBlob(state, 'progression', map, tick);

  const colony = ensureColonyRecord(state, colonyIndex, tick);
  colony.stage = prog.stage;
  colony.unlockStage = prog.unlockStage;
  colony.threatStage = prog.threatStage;
  colony.stageEnteredAtTick = prog.stageEnteredAtTick;
  colony.dwellRemainingTicks = prog.dwellRemainingTicks;
  colony.dwellRemainingS = prog.dwellRemainingS;
  colony.stageDwellRemainingS = prog.dwellRemainingS;
  colony.triggerSatisfiedForStage = prog.triggerSatisfiedForStage;
  colony.nextStageConditionText = prog.nextStageConditionText;
  colony.emittedStages = [...prog.emittedStages];
  colony.changedAt = tick;
}

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

function advanceColonyToStage(
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
  prog.dwellRemainingTicks = null;
  prog.dwellRemainingS = null;
  prog.triggerSatisfiedForStage = null;

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
  if (!isColonyLanded(state, colonyIndex)) return;
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

  const col = state.colonies[colonyIndex];
  if (changed || !col || col.stage !== prog.stage || col.stageDwellRemainingS !== ticksToRemainingSeconds(prog.dwellRemainingTicks)) {
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
