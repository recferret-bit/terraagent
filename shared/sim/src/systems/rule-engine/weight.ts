import { PRIORITY_KEYS, type PriorityKey } from '@terra/contracts';
import type { PlanetState } from '../../kernel/state';
import {
  evaluateColonyNeeds,
  MAX_NEED_BP,
  NEED_KEYS,
  type ColonyNeedsDetail,
  type ColonyNeedsScore,
  type NeedKey,
  type NeedsEvalInput,
} from './needs';

export { PRIORITY_KEYS, type PriorityKey };

export const DEFAULT_PRIORITY_VALUE = 50;
export const MIN_PRIORITY_VALUE = 0;
export const MAX_PRIORITY_VALUE = 100;
export const MAX_WEIGHTED_NEED_BP = 15000;
export const SAFETY_FLOOR_BP = 8000;
export const REPAIR_FLOOR_BP = 8000;
export const DEFENSE_UNDER_ATTACK_FLOOR_BP = 8000;
export const AWAY_DEFENSE_FLOOR_BONUS_BP = 1000;

export interface ColonyPriorities {
  economy: number;
  expansion: number;
  defense: number;
  power: number;
  terraform: number;
}

export const DEFAULT_COLONY_PRIORITIES: Readonly<ColonyPriorities> = {
  economy: DEFAULT_PRIORITY_VALUE,
  expansion: DEFAULT_PRIORITY_VALUE,
  defense: DEFAULT_PRIORITY_VALUE,
  power: DEFAULT_PRIORITY_VALUE,
  terraform: DEFAULT_PRIORITY_VALUE,
};

/**
 * Canonical mapping from each of the 7 rule-engine needs (`NeedKey`) to its controlling priority slider (`SIM-R-02`, `SIM-R-03`).
 */
export const NEED_TO_PRIORITY_KEY: Readonly<Record<NeedKey, PriorityKey>> = {
  energy: 'power',
  storage: 'economy',
  supply: 'economy',
  extraction: 'economy',
  defense: 'defense',
  expand: 'expansion',
  repair: 'defense',
};

export interface WeightNeedsOptions {
  underAttack?: boolean;
  hostilesWithin15?: number;
  hasDamagedEntities?: boolean;
  underRepairNeed?: boolean;
  damagedEntities?: number;
  severedEntities?: number;
  away?: boolean;
}

export interface WeightedNeedEntry {
  need: NeedKey;
  rawNeedBp: number;
  priorityKey: PriorityKey;
  priorityValue: number;
  weightedBp: number;
  floorApplied: boolean;
}

export interface WeightedColonyNeedsResult {
  priorities: ColonyPriorities;
  energy: number;
  storage: number;
  supply: number;
  extraction: number;
  defense: number;
  expand: number;
  repair: number;
  scores: Record<NeedKey, number>;
  ranked: WeightedNeedEntry[];
  top: WeightedNeedEntry;
  topNeed: NeedKey;
  topScore: number;
}

function clampPriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PRIORITY_VALUE;
  return Math.max(MIN_PRIORITY_VALUE, Math.min(MAX_PRIORITY_VALUE, Math.round(value)));
}

function clampRawNeedBp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_NEED_BP, Math.round(value)));
}

/**
 * Normalizes a partial priority map into a complete `ColonyPriorities` record (`0..100`, default `50`).
 */
export function resolveColonyPriorities(priorities?: Partial<ColonyPriorities> | null): ColonyPriorities {
  return {
    economy: clampPriority(priorities?.economy),
    expansion: clampPriority(priorities?.expansion),
    defense: clampPriority(priorities?.defense),
    power: clampPriority(priorities?.power),
    terraform: clampPriority(priorities?.terraform),
  };
}

/**
 * Reads the colony's stored priority sliders from `state.colonies[colonyIndex]` or `state.blobs.priorities`,
 * falling back to `50` per slider.
 */
export function readColonyPriorities(state: PlanetState, colonyIndex = 0): ColonyPriorities {
  const col = state.colonies[colonyIndex];
  if (col?.priorities && typeof col.priorities === 'object') {
    return resolveColonyPriorities(col.priorities as Partial<ColonyPriorities>);
  }
  const blobVal = state.blobs.priorities?.value as Record<string, unknown> | undefined;
  const byColony = blobVal?.byColony as Record<string, Partial<ColonyPriorities>> | undefined;
  const fromBlob =
    byColony?.[String(colonyIndex)] ??
    (blobVal?.[String(colonyIndex)] as Partial<ColonyPriorities> | undefined) ??
    null;
  return resolveColonyPriorities(fromBlob);
}

/**
 * Pure slider weighting formula (`SIM-R-03`):
 * `score = Math.floor((needBp * (5000 + priority * 100)) / 10000)`.
 */
export function computeSliderWeightBp(needBp: number, priority: number): number {
  const n = clampRawNeedBp(needBp);
  const p = clampPriority(priority);
  const weighted = Math.floor((n * (5000 + p * 100)) / 10000);
  return Math.max(0, Math.min(MAX_WEIGHTED_NEED_BP, weighted));
}

function extractNeedsDetail(
  needs: ColonyNeedsScore | Partial<Record<NeedKey, number>>,
): ColonyNeedsDetail | null {
  if ('detail' in needs && needs.detail && typeof needs.detail === 'object') {
    return needs.detail as ColonyNeedsDetail;
  }
  return null;
}

function readRawNeedScore(
  needs: ColonyNeedsScore | Partial<Record<NeedKey, number>>,
  key: NeedKey,
): number {
  if ('scores' in needs && needs.scores && typeof needs.scores === 'object') {
    const fromScores = (needs.scores as Partial<Record<NeedKey, number>>)[key];
    if (typeof fromScores === 'number') return clampRawNeedBp(fromScores);
  }
  const direct = (needs as Partial<Record<NeedKey, number>>)[key];
  return clampRawNeedBp(direct);
}

function isRepairFloorActive(
  rawRepairBp: number,
  detail: ColonyNeedsDetail | null,
  opts?: WeightNeedsOptions,
): boolean {
  if (rawRepairBp > 0) return true;
  if (opts?.hasDamagedEntities || opts?.underRepairNeed) return true;
  if ((opts?.damagedEntities ?? 0) > 0 || (opts?.severedEntities ?? 0) > 0) return true;
  if (detail && (detail.damagedEntityCount > 0 || detail.severedEntityCount > 0)) return true;
  return false;
}

function isDefenseFloorActive(
  rawDefenseBp: number,
  detail: ColonyNeedsDetail | null,
  opts?: WeightNeedsOptions,
): boolean {
  if (rawDefenseBp >= DEFENSE_UNDER_ATTACK_FLOOR_BP) return true;
  if (opts?.underAttack || (opts?.hostilesWithin15 ?? 0) > 0) return true;
  if (detail && (detail.underAttack || detail.hostilesWithin15 > 0)) return true;
  return false;
}

/**
 * Applies colony priority sliders (`SIM-R-03`) and non-negotiable safety floors (`8000` bp for active `repair`
 * and `defense` under attack regardless of slider settings; `+1000` bp defense floor when `away = true` per `SIM-R-06`).
 */
export function weightColonyNeeds(
  needs: ColonyNeedsScore | Partial<Record<NeedKey, number>>,
  priorities?: Partial<ColonyPriorities> | null,
  opts?: WeightNeedsOptions,
): WeightedColonyNeedsResult {
  const resolvedPriorities = resolveColonyPriorities(priorities);
  const detail = extractNeedsDetail(needs);
  const scores = {} as Record<NeedKey, number>;
  const entries: WeightedNeedEntry[] = [];

  const defenseFloor = DEFENSE_UNDER_ATTACK_FLOOR_BP + (opts?.away ? AWAY_DEFENSE_FLOOR_BONUS_BP : 0);

  for (const key of NEED_KEYS) {
    const rawNeedBp = readRawNeedScore(needs, key);
    const priorityKey = NEED_TO_PRIORITY_KEY[key];
    const priorityValue = resolvedPriorities[priorityKey];
    const baseWeighted = computeSliderWeightBp(rawNeedBp, priorityValue);

    let weightedBp = baseWeighted;
    let floorApplied = false;

    if (key === 'repair' && isRepairFloorActive(rawNeedBp, detail, opts)) {
      if (weightedBp < REPAIR_FLOOR_BP) {
        weightedBp = REPAIR_FLOOR_BP;
        floorApplied = true;
      }
    } else if (key === 'defense' && isDefenseFloorActive(rawNeedBp, detail, opts)) {
      if (weightedBp < defenseFloor) {
        weightedBp = defenseFloor;
        floorApplied = true;
      }
    }

    scores[key] = weightedBp;
    entries.push({
      need: key,
      rawNeedBp,
      priorityKey,
      priorityValue,
      weightedBp,
      floorApplied,
    });
  }

  const orderIndex: Record<NeedKey, number> = {
    energy: 0,
    storage: 1,
    supply: 2,
    extraction: 3,
    defense: 4,
    expand: 5,
    repair: 6,
  };

  const ranked = [...entries].sort(
    (a, b) => b.weightedBp - a.weightedBp || orderIndex[a.need] - orderIndex[b.need],
  );
  const top = ranked[0]!;

  return {
    priorities: resolvedPriorities,
    energy: scores.energy,
    storage: scores.storage,
    supply: scores.supply,
    extraction: scores.extraction,
    defense: scores.defense,
    expand: scores.expand,
    repair: scores.repair,
    scores,
    ranked,
    top,
    topNeed: top.need,
    topScore: top.weightedBp,
  };
}

/**
 * Evaluates raw colony needs and weights them with the colony's priority sliders and safety floors.
 */
export function evaluateWeightedColonyNeeds(
  state: PlanetState,
  colonyIndex = 0,
  priorities?: Partial<ColonyPriorities> | null,
  opts?: NeedsEvalInput & WeightNeedsOptions,
): WeightedColonyNeedsResult & { raw: ColonyNeedsScore } {
  const raw = evaluateColonyNeeds(state, colonyIndex, opts);
  const resolvedPriorities = priorities ?? readColonyPriorities(state, colonyIndex);
  const away = opts?.away ?? Boolean(state.colonies[colonyIndex]?.away);
  const weighted = weightColonyNeeds(raw, resolvedPriorities, { ...opts, away });
  return { ...weighted, raw };
}
