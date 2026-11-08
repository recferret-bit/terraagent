import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { QueueLane } from '../queue';
import type { NeedKey, NeedsEvalInput } from './needs';
import type { BuildSiteSelection } from './site';
import type { ColonyPriorities, PriorityKey, WeightNeedsOptions } from './weight';

export const ACTIONABLE_NEED_THRESHOLD_BP = 5000;
export const RULE_ENGINE_STEP_TICKS = 25;

export type AutopilotMode = 'suggestion' | 'auto' | 'idle';

export interface NeedAutomationSpec {
  need: NeedKey;
  lane: QueueLane;
  target: string;
  introducedStage: number;
  autoStage: number;
  title: string;
  taskKind: 'build' | 'buildUnit' | 'terraform';
}

/**
 * Canonical "Learn by hand, then automate" (`UO-LC-05`) stage gating table.
 * Each lane/need is suggestion-only at `stage <= introducedStage` and automates at `autoStage = introducedStage + 1`.
 */
export const NEED_AUTOMATION_TABLE: Readonly<Record<NeedKey, NeedAutomationSpec>> = {
  extraction: { need: 'extraction', lane: 'construction', target: 'metalsExtractor', introducedStage: 1, autoStage: 2, title: 'Build Metals Extractor', taskKind: 'build' },
  energy: { need: 'energy', lane: 'construction', target: 'wind', introducedStage: 2, autoStage: 3, title: 'Build Wind Turbine', taskKind: 'build' },
  storage: { need: 'storage', lane: 'construction', target: 'depot', introducedStage: 2, autoStage: 3, title: 'Build Supply Depot', taskKind: 'build' },
  supply: { need: 'supply', lane: 'construction', target: 'depot', introducedStage: 2, autoStage: 3, title: 'Build Supply Depot', taskKind: 'build' },
  defense: { need: 'defense', lane: 'construction', target: 'turret', introducedStage: 3, autoStage: 4, title: 'Build Defense Turret', taskKind: 'build' },
  expand: { need: 'expand', lane: 'construction', target: 'outpostBeacon', introducedStage: 4, autoStage: 5, title: 'Build Outpost Beacon', taskKind: 'build' },
  repair: { need: 'repair', lane: 'construction', target: 'repair', introducedStage: 1, autoStage: 2, title: 'Repair Damaged Structures', taskKind: 'terraform' },
};

export interface AutopilotOrderSuggestion {
  suggestionId: string;
  colonyIndex: number;
  stage: number;
  kind: 'order';
  need: NeedKey;
  lane: QueueLane;
  target: string;
  title: string;
  reason: string;
  offeredAtTick: number;
}

export interface AutopilotDecision {
  colonyIndex: number;
  tick: number;
  stage: number;
  need: NeedKey;
  topNeed: NeedKey;
  rawNeedBp: number;
  weightedBp: number;
  scoreBp: number;
  priorityKey: PriorityKey;
  priorityValue: number;
  floorApplied: boolean;
  actionable: boolean;
  mode: AutopilotMode;
  lane: QueueLane;
  target: string;
  building?: string;
  introducedStage: number;
  autoStage: number;
  title: string;
  reason: string;
  site: BuildSiteSelection | null;
  q?: number;
  r?: number;
  suggestionId?: string;
  queuedTaskId?: string;
  orderQueued: boolean;
  suggestionEmitted: boolean;
  priorities: ColonyPriorities;
  scores: Record<NeedKey, number>;
  rawScores: Record<NeedKey, number>;
}

export interface AutopilotEvalOptions extends NeedsEvalInput, WeightNeedsOptions {
  stage?: number;
  priorities?: Partial<ColonyPriorities> | null;
}

export interface AutopilotStepContextLike {
  tick?: number;
  data?: CompiledDataLike;
  emit?: StepContext['emit'];
}

export type AutopilotStepOptions = AutopilotEvalOptions & AutopilotStepContextLike;

export function getNeedAutomationSpec(need: NeedKey): NeedAutomationSpec {
  return NEED_AUTOMATION_TABLE[need];
}

export function isNeedAutomatedAtStage(need: NeedKey, stage: number): boolean {
  return stage >= NEED_AUTOMATION_TABLE[need].autoStage;
}

export function resolveNeedMode(need: NeedKey, stage: number, actionable = true): AutopilotMode {
  if (!actionable) return 'idle';
  return stage >= NEED_AUTOMATION_TABLE[need].autoStage ? 'auto' : 'suggestion';
}

export function resolveColonyStage(state: PlanetState, colonyIndex = 0, explicitStage?: number): number {
  if (typeof explicitStage === 'number' && Number.isFinite(explicitStage)) {
    return Math.max(0, Math.trunc(explicitStage));
  }
  const col = state.colonies[colonyIndex];
  if (typeof col?.stage === 'number' && Number.isFinite(col.stage)) {
    return Math.max(0, Math.trunc(col.stage));
  }
  if (typeof col?.unlockStage === 'number' && Number.isFinite(col.unlockStage)) {
    return Math.max(0, Math.trunc(col.unlockStage));
  }
  const progBlob = (state.blobs.progression?.value ?? state.blobs.stages?.value) as Record<string, unknown> | undefined;
  const byColony = (progBlob?.byColony as Record<string, unknown> | undefined) ?? progBlob;
  const entry = byColony?.[String(colonyIndex)] as { stage?: number } | number | undefined;
  if (typeof entry === 'number' && Number.isFinite(entry)) return Math.max(0, Math.trunc(entry));
  if (entry && typeof entry === 'object' && typeof entry.stage === 'number' && Number.isFinite(entry.stage)) {
    return Math.max(0, Math.trunc(entry.stage));
  }
  return 0;
}
