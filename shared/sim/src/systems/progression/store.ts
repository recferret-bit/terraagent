import { getStageSpec } from '../../data';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { isW18PvpActive, syncColonyNewcomerShield } from '../pvp';
import { ticksToRemainingSeconds } from './dwell';
import { resolveCompiledStageRow } from './triggers';
import { computeColonyThreatStage } from './threatStage';
import type { ColonyProgressionState } from './types';

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

export function computeNextConditionText(stage: number, data?: CompiledDataLike): string {
  const nextRow =
    resolveCompiledStageRow(stage + 1, data) ??
    (data?.tables && 'stages' in data.tables ? undefined : getStageSpec(stage + 1));
  if (!nextRow) return '';
  return nextRow.unlockConditionText || nextRow.triggerText || '';
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
  const colDwellTicks = typeof col?.dwellRemainingTicks === 'number' ? col.dwellRemainingTicks : undefined;
  const colS2Tick = typeof col?.s2ReachedAtTick === 'number' ? col.s2ReachedAtTick : undefined;
  const colS3Tick = typeof col?.s3ReachedAtTick === 'number' ? col.s3ReachedAtTick : undefined;

  if (existing) {
    const synced = cloneProgressionState(existing);
    if (colStage !== undefined && colStage !== synced.stage) {
      synced.stage = colStage;
    }
    if (colUnlockStage !== undefined && colUnlockStage > synced.unlockStage) {
      synced.unlockStage = colUnlockStage;
    }
    synced.unlockStage = Math.max(synced.unlockStage, synced.stage);
    synced.threatStage = computeColonyThreatStage(state, colonyIndex, synced.stage);
    if (colS2Tick !== undefined) synced.s2ReachedAtTick = colS2Tick;
    else if (synced.stage >= 2 && synced.s2ReachedAtTick == null) synced.s2ReachedAtTick = synced.stageEnteredAtTick;
    if (colS3Tick !== undefined) synced.s3ReachedAtTick = colS3Tick;
    else if (synced.stage >= 3 && synced.s3ReachedAtTick == null) synced.s3ReachedAtTick = synced.stageEnteredAtTick;
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
  const threatStage = computeColonyThreatStage(state, colonyIndex, stage);
  const stageEnteredAtTick = typeof col?.stageEnteredAtTick === 'number' ? col.stageEnteredAtTick : state.meta.tick;
  const dwellRemainingTicks = colDwellTicks ?? null;
  return {
    colonyIndex,
    stage,
    unlockStage,
    threatStage,
    stageEnteredAtTick,
    s2ReachedAtTick: colS2Tick ?? (stage >= 2 ? stageEnteredAtTick : null),
    s3ReachedAtTick: colS3Tick ?? (stage >= 3 ? stageEnteredAtTick : null),
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
  prog.threatStage = computeColonyThreatStage(state, colonyIndex, prog.stage);
  if (prog.stage >= 2 && prog.s2ReachedAtTick == null) prog.s2ReachedAtTick = prog.stageEnteredAtTick;
  if (prog.stage >= 3 && prog.s3ReachedAtTick == null) prog.s3ReachedAtTick = prog.stageEnteredAtTick;
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
  colony.s2ReachedAtTick = prog.s2ReachedAtTick ?? null;
  colony.s3ReachedAtTick = prog.s3ReachedAtTick ?? null;
  colony.dwellRemainingTicks = prog.dwellRemainingTicks;
  colony.dwellRemainingS = prog.dwellRemainingS;
  colony.stageDwellRemainingS = prog.dwellRemainingS;
  colony.triggerSatisfiedForStage = prog.triggerSatisfiedForStage;
  colony.nextStageConditionText = prog.nextStageConditionText;
  colony.emittedStages = [...prog.emittedStages];
  colony.stageOverride = prog.stageOverride;
  colony.changedAt = tick;
  if (isW18PvpActive(data) && (state.blobs.pvp || typeof colony.raidProtectedUntil === 'number')) {
    syncColonyNewcomerShield(state, colonyIndex, tick, data);
  }
}
