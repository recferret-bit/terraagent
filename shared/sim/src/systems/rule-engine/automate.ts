import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import {
  enqueueQueueTask,
  getAllQueueEntries,
  getColonyQueue,
  saveQueueEntries,
  type QueueEntry,
  type QueueLane,
  type QueueTaskPayload,
} from '../queue';
import { evaluateColonyNeeds, type ColonyNeedsScore, type NeedKey, type NeedsEvalInput } from './needs';
import { selectDeterministicBuildSite, type BuildSiteSelection } from './site';
import {
  DEFAULT_PRIORITY_VALUE,
  readColonyPriorities,
  resolveColonyPriorities,
  weightColonyNeeds,
  type ColonyPriorities,
  type PriorityKey,
  type WeightNeedsOptions,
} from './weight';

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

function buildEffectiveNeedsForAutopilot(
  raw: ColonyNeedsScore,
  priorities: ColonyPriorities,
  stage: number,
): ColonyNeedsScore {
  if (
    stage <= 2 &&
    priorities.expansion > DEFAULT_PRIORITY_VALUE &&
    priorities.expansion > priorities.power
  ) {
    const targetExpand = Math.max(
      raw.expand,
      6500,
      raw.energy,
      raw.storage,
      raw.extraction,
      raw.supply,
      raw.defense,
      raw.repair,
    );
    if (targetExpand !== raw.expand) {
      const scores = { ...raw.scores, expand: targetExpand };
      return {
        ...raw,
        expand: targetExpand,
        scores,
      };
    }
  }
  if ((stage === 2 || stage === 3) && priorities.power >= DEFAULT_PRIORITY_VALUE) {
    const targetEnergy = Math.max(
      raw.energy,
      6800,
      raw.storage + 100,
      raw.extraction + 100,
      raw.supply + 100,
      raw.expand + 100,
      raw.defense + 100,
      raw.repair + 100,
    );
    if (targetEnergy !== raw.energy) {
      const scores = { ...raw.scores, energy: targetEnergy };
      return {
        ...raw,
        energy: targetEnergy,
        scores,
      };
    }
  }
  return raw;
}

function formatDecisionReason(
  spec: NeedAutomationSpec,
  stage: number,
  weightedBp: number,
  priorityKey: PriorityKey,
  priorityValue: number,
  mode: AutopilotMode,
): string {
  if (mode === 'idle') {
    return `top need ${spec.need} (${weightedBp} bp) below threshold ${ACTIONABLE_NEED_THRESHOLD_BP} bp`;
  }
  if (mode === 'suggestion') {
    return `${spec.need} (${weightedBp} bp, ${priorityKey}=${priorityValue}) at S${stage} -> suggest ${spec.target} (auto at S${spec.autoStage})`;
  }
  return `${spec.need} (${weightedBp} bp, ${priorityKey}=${priorityValue}) at S${stage} -> auto queue ${spec.target}`;
}

const FALLBACK_BUILD_SITE: BuildSiteSelection = {
  q: 2,
  r: 0,
  tileIndex: 0,
  score: 0,
  distanceToHub: 2,
  distanceToSupport: 2,
  depositRichnessBp: 0,
  preparedCount: 0,
  unpreparedCount: 0,
};

/**
 * Evaluates the colony's needs, applies the 5 canonical priority sliders and safety floors,
 * and determines whether the top need produces a suggestion, an `auto` order, or stays idle (`UO-LC-05`).
 */
export function evaluateAutopilotDecision(
  state: PlanetState,
  colonyIndex = 0,
  opts?: AutopilotEvalOptions,
): AutopilotDecision {
  const stage = resolveColonyStage(state, colonyIndex, opts?.stage);
  const priorities = opts?.priorities
    ? resolveColonyPriorities(opts.priorities)
    : readColonyPriorities(state, colonyIndex);
  const away = opts?.away ?? Boolean(state.colonies[colonyIndex]?.away);
  const raw = evaluateColonyNeeds(state, colonyIndex, opts);
  const effectiveRaw = buildEffectiveNeedsForAutopilot(raw, priorities, stage);
  const weighted = weightColonyNeeds(effectiveRaw, priorities, { ...opts, away });
  const top = weighted.top;
  const actionable = top.weightedBp >= ACTIONABLE_NEED_THRESHOLD_BP;
  const spec = getNeedAutomationSpec(top.need);
  const mode = resolveNeedMode(top.need, stage, actionable);

  const site =
    spec.taskKind === 'build'
      ? (selectDeterministicBuildSite(state, colonyIndex, spec.target, { data: opts?.data }) ?? FALLBACK_BUILD_SITE)
      : null;

  const suggestionId =
    mode === 'suggestion' ? `sug_auto_${colonyIndex}_s${stage}_${top.need}_${spec.target}` : undefined;

  return {
    colonyIndex,
    tick: state.meta.tick,
    stage,
    need: top.need,
    topNeed: top.need,
    rawNeedBp: top.rawNeedBp,
    weightedBp: top.weightedBp,
    scoreBp: top.weightedBp,
    priorityKey: top.priorityKey,
    priorityValue: top.priorityValue,
    floorApplied: top.floorApplied,
    actionable,
    mode,
    lane: spec.lane,
    target: spec.target,
    ...(spec.taskKind === 'build' ? { building: spec.target } : {}),
    introducedStage: spec.introducedStage,
    autoStage: spec.autoStage,
    title: spec.title,
    reason: formatDecisionReason(spec, stage, top.weightedBp, top.priorityKey, top.priorityValue, mode),
    site,
    ...(site ? { q: site.q, r: site.r } : {}),
    ...(suggestionId ? { suggestionId } : {}),
    orderQueued: false,
    suggestionEmitted: false,
    priorities: weighted.priorities,
    scores: { ...weighted.scores },
    rawScores: { ...raw.scores },
  };
}

function findOpenAutoOrder(state: PlanetState, colonyIndex: number, target: string): QueueEntry | undefined {
  return getColonyQueue(state, colonyIndex).find((e) => {
    const rec = e as QueueEntry & { tag?: string; source?: string };
    const isAuto =
      e.precedence === 'ai' || e.precedence === 'auto' || rec.tag === 'auto' || rec.source === 'auto';
    if (!isAuto) return false;
    if (e.task.kind === 'build') return e.task.building === target;
    if (e.task.kind === 'buildUnit') return e.task.unit === target;
    if (e.task.kind === 'terraform') return e.task.op === target;
    return false;
  });
}

function enqueueAutoOrder(
  state: PlanetState,
  colonyIndex: number,
  decision: AutopilotDecision,
  spec: NeedAutomationSpec,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): { taskId: string; newlyQueued: boolean } {
  const existing = findOpenAutoOrder(state, colonyIndex, decision.target);
  if (existing) {
    return { taskId: existing.taskId, newlyQueued: false };
  }

  const allBefore = getAllQueueEntries(state);
  const taskId = `auto-${colonyIndex}-${tick}-${allBefore.length + 1}`;
  const q = decision.q ?? 2;
  const r = decision.r ?? 0;
  const task: QueueTaskPayload =
    spec.taskKind === 'build'
      ? { kind: 'build', building: decision.target, q, r, tier: 1 }
      : spec.taskKind === 'buildUnit'
        ? { kind: 'buildUnit', unit: decision.target, count: 1 }
        : { kind: 'terraform', op: decision.target, q, r };

  const enq = enqueueQueueTask(
    state,
    { colonyIndex, task, precedence: 'ai', taskId, tick, data },
    ctx,
  );

  const entries = getAllQueueEntries(state);
  let targetEntry = entries.find((e) => e.taskId === taskId);
  if (!targetEntry && !enq.ok && enq.code !== 'queue_full') {
    targetEntry = {
      taskId,
      colonyIndex,
      lane: spec.lane,
      precedence: 'ai',
      state: 'waiting',
      waitReason: 'site',
      waitDetail: `waiting: site (${enq.detail ?? enq.code})`,
      task,
      cost: {},
      totalCost: {},
      spentCost: {},
      paid: false,
      progress: 0,
      buildTicks: 50,
      elapsedTicks: 0,
      workRate: 1.5,
      createdAt: tick,
    };
    entries.push(targetEntry);
  }

  if (targetEntry) {
    const tagged = targetEntry as QueueEntry & { tag?: string; source?: string; need?: NeedKey };
    tagged.tag = 'auto';
    tagged.source = 'auto';
    tagged.need = decision.need;
    saveQueueEntries(state, entries, tick);
    return { taskId: targetEntry.taskId, newlyQueued: true };
  }
  return { taskId, newlyQueued: false };
}

function storeAutopilotDecision(state: PlanetState, colonyIndex: number, decision: AutopilotDecision, tick: number): void {
  const colony = ensureColonyRecord(state, colonyIndex, tick);
  colony.lastAutopilotDecision = decision;
  colony.lastAutopilotEvalTick = tick;
  colony.lastAutopilotEvalStage = decision.stage;
  colony.changedAt = tick;

  const prevBlob = state.blobs.autopilot?.value as Record<string, unknown> | undefined;
  const prevByColony = (prevBlob?.byColony as Record<string, unknown> | undefined) ?? prevBlob ?? {};
  const map: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prevByColony)) {
    if (k !== 'byColony' && v && typeof v === 'object') map[k] = v;
  }
  map[String(colonyIndex)] = decision;
  setBlob(state, 'autopilot', { ...map, byColony: { ...map } }, tick);
  Object.assign(state.blobs.autopilot as unknown as Record<string, unknown>, map);
}

function handleSuggestionDecision(
  state: PlanetState,
  colonyIndex: number,
  decision: AutopilotDecision,
  tick: number,
  emit?: StepContext['emit'],
): void {
  const colony = ensureColonyRecord(state, colonyIndex, tick);
  const suggestionId =
    decision.suggestionId ?? `sug_auto_${colonyIndex}_s${decision.stage}_${decision.need}_${decision.target}`;
  decision.suggestionId = suggestionId;
  const suggestionObj: AutopilotOrderSuggestion = {
    suggestionId,
    colonyIndex,
    stage: decision.stage,
    kind: 'order',
    need: decision.need,
    lane: decision.lane,
    target: decision.target,
    title: decision.title,
    reason: decision.reason,
    offeredAtTick: tick,
  };
  colony.activeSuggestion = suggestionObj;

  const dedupKey = `${decision.stage}:${decision.need}:${decision.target}`;
  const isNewKey = colony.lastAutopilotSuggestionKey !== dedupKey;
  if (isNewKey) {
    colony.lastAutopilotSuggestionKey = dedupKey;
    colony.lastAutopilotSuggestionEmittedToBus = false;
    decision.suggestionEmitted = true;
  }
  if (emit && (isNewKey || !colony.lastAutopilotSuggestionEmittedToBus)) {
    colony.lastAutopilotSuggestionEmittedToBus = true;
    decision.suggestionEmitted = true;
    emit({
      kind: 'suggestionOffered',
      colonyIds: [colonyIndex],
      data: {
        colonyIndex,
        suggestionId,
        stage: Math.max(0, Math.min(10, decision.stage)),
        kind: 'order',
        need: decision.need,
        lane: decision.lane,
        target: decision.target,
        title: decision.title.slice(0, 96),
        reason: decision.reason.slice(0, 160),
      },
    });
  }
}

/**
 * Evaluates and executes one rule-engine autopilot step for `colonyIndex`:
 * - When `mode === 'suggestion'`, emits `suggestionOffered` once per distinct `(stage, need, target)` and queues 0 orders.
 * - When `mode === 'auto'`, queues an `auto`-tagged (`precedence: 'ai'`) order in the colony's queue if not already open.
 */
export function applyAutopilotStep(
  state: PlanetState,
  colonyIndex = 0,
  ctxOrOpts?: StepContext | AutopilotStepOptions,
  maybeOpts?: AutopilotStepOptions,
): AutopilotDecision {
  const merged: AutopilotStepOptions = {
    ...(ctxOrOpts && typeof ctxOrOpts === 'object' ? (ctxOrOpts as AutopilotStepOptions) : {}),
    ...(maybeOpts ?? {}),
  };
  const tick = merged.tick ?? state.meta.tick;
  const decision = evaluateAutopilotDecision(state, colonyIndex, merged);
  decision.tick = tick;
  const spec = getNeedAutomationSpec(decision.need);

  if (decision.actionable && decision.mode === 'suggestion') {
    handleSuggestionDecision(state, colonyIndex, decision, tick, merged.emit);
  } else if (decision.actionable && decision.mode === 'auto') {
    const stepCtx =
      ctxOrOpts && typeof ctxOrOpts === 'object' && 'flags' in ctxOrOpts ? (ctxOrOpts as StepContext) : undefined;
    const queued = enqueueAutoOrder(state, colonyIndex, decision, spec, tick, merged.data, stepCtx);
    decision.queuedTaskId = queued.taskId;
    decision.orderQueued = queued.newlyQueued;
  }

  storeAutopilotDecision(state, colonyIndex, decision, tick);
  return decision;
}

export function getLastAutopilotDecision(state: PlanetState, colonyIndex = 0): AutopilotDecision | null {
  const fromColony = state.colonies[colonyIndex]?.lastAutopilotDecision as AutopilotDecision | undefined;
  if (fromColony && typeof fromColony === 'object') return fromColony;
  const blob = state.blobs.autopilot as unknown as (Record<string, unknown> & { value?: Record<string, unknown> }) | undefined;
  const fromBlob =
    (blob?.[String(colonyIndex)] as AutopilotDecision | undefined) ??
    (blob?.value?.[String(colonyIndex)] as AutopilotDecision | undefined);
  return fromBlob && typeof fromBlob === 'object' ? fromBlob : null;
}
