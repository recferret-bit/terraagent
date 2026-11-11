import type { ResourceKey } from '@terra/contracts';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { resolveBuildingRow } from '../economy/construction';
import { hqReprintCost, hqReprintTicks } from '../elimination/store';
import { findColonyRoboticsFactories, resolveReconRow } from '../factories-hub';
import { resolveUnitRowForHub } from '../factories-hub/unit';
import { isWorker } from '../harvest/unit';
import { prestigeProjectRow } from '../prestige/rows';
import { getTerraformJobCost, getTerraformOpSpec, isTerraformOpKind, isW01TerraformOpKind } from '../terraform-basic/ops';
import {
  accumulateEntityIncome,
  enqueueAuthority,
  extractQueueTaskPayloadFromRaw,
  findOldestAutoIndex,
  isW03QueueActive,
  maxConcurrentInLane,
  nextAutoTaskId,
} from './parts/waitParts';
import type { QueueEntry, QueueLane, QueuePrecedence, QueueTaskPayload } from './types';

export {
  enqueueAuthority,
  findOldestAutoIndex,
  isW03QueueActive,
  maxConcurrentInLane,
  nextAutoTaskId,
};

export const CONSTRUCTION_LANE_LIMIT = 20;
export const TERRAFORM_LANE_LIMIT = 20;
export const UNITS_LANE_LIMIT = 10;
export const PRODUCER_BUFFER_LIMIT = 5;
export const HQ_GOALS_LANE_LIMIT = 20;

export function laneForTask(task: QueueTaskPayload): QueueLane {
  if (task.kind === 'buildUnit' || task.kind === 'project') return 'units';
  if (task.kind === 'terraform') return 'terraform';
  if (task.kind === 'hqGoal' || task.kind === 'raid') return 'hqGoals';
  return 'construction';
}

export function laneLimitFor(lane: QueueLane): number {
  if (lane === 'units') return UNITS_LANE_LIMIT;
  if (lane === 'terraform') return TERRAFORM_LANE_LIMIT;
  if (lane === 'hqGoals') return HQ_GOALS_LANE_LIMIT;
  return CONSTRUCTION_LANE_LIMIT;
}

export function resolveTaskCostAndTicks(
  task: QueueTaskPayload,
  data?: CompiledDataLike,
): { cost: Partial<Record<ResourceKey, number>>; buildTicks: number; workRate: number } {
  if (task.kind === 'build') {
    const res = resolveBuildingRow(task.building, data);
    if (!res) return { cost: {}, buildTicks: 50, workRate: 1.5 };
    return {
      cost: { ...((res.row.cost ?? {}) as Partial<Record<ResourceKey, number>>) },
      buildTicks: Math.max(1, Number(res.row.buildS ?? 50)),
      workRate: 1.5,
    };
  }
  if (task.kind === 'buildUnit') {
    if (task.unit === 'hq') {
      return {
        cost: hqReprintCost(data),
        buildTicks: hqReprintTicks(data, false),
        workRate: 1.0,
      };
    }
    if (task.unit === 'recon') {
      const reconRow = resolveReconRow(data);
      return {
        cost: { ...((reconRow.cost ?? { 'metals.t1': 35, 'minerals.t1': 15, 'bio.biomass': 0, 'bio.water': 5 }) as Partial<Record<ResourceKey, number>>) },
        buildTicks: Math.max(1, Number(reconRow.buildS ?? 50)),
        workRate: Number(reconRow.workRate ?? 1.0),
      };
    }
    const row = resolveUnitRowForHub(task.unit, data, task.tier); // only `worker` T1–T3 (enqueue rejects the rest)
    return {
      cost: { ...((row?.cost ?? {}) as Partial<Record<ResourceKey, number>>) },
      buildTicks: Math.max(1, Number(row?.buildS ?? 50)),
      workRate: Number(row?.workRate ?? 1.0),
    };
  }
  if (task.kind === 'hqGoal' || task.kind === 'raid') {
    return { cost: {}, buildTicks: 1, workRate: 1.0 };
  }
  if (task.kind === 'project') {
    const row = prestigeProjectRow(task.project, data);
    return { cost: row ? { ...row.cost } : {}, buildTicks: row ? row.buildTicks : 1, workRate: 1.0 };
  }
  if (
    task.kind === 'terraform' &&
    isTerraformOpKind(task.op) &&
    !isW01TerraformOpKind(task.op) &&
    task.op !== 'dismantle' &&
    task.op !== 'work'
  ) {
    const spec = getTerraformOpSpec(task.op, data);
    return {
      cost: getTerraformJobCost(task.op, data),
      buildTicks: Math.max(1, Math.round(spec.baseTimeS * 5)),
      workRate: 1.0,
    };
  }
  return { cost: {}, buildTicks: 25, workRate: 1.5 };
}

export const RESOURCE_DISPLAY_LABELS: Readonly<Record<ResourceKey, string>> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
  'metals.t2': 'Alloys',
  'minerals.t2': 'Crystals',
  'bio.t2': 'Nutrients',
  'metals.t3': 'Composites',
  'minerals.t3': 'Metamaterials',
  'bio.t3': 'Biopolymers',
};

/** Whether a Worker Drone of `colonyIndex` harvests now (the production ledger then holds the real per-key rates). */
function workersAtWork(state: PlanetState, colonyIndex: number): boolean {
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex && isWorker(cols.kind[r]) && cols.state[r] === ENTITY_STATE.harvesting) return true;
  }
  return false;
}

/**
 * Estimates current colony income per second (`amount/s`) for a given `ResourceKey`.
 * Uses explicit `colony.incomePerS`, else the production ledger (`colony.production.incomePerS`, written each step by
 * `production.extractors` / `production.harvest`: the real per-key rate, so a Worker Drone mining metals adds nothing
 * to Minerals). Without a ledger rate it guesses: active extractors (`1.0 * richness`/s) and idle / moving workers.
 */
export function estimateResourceIncomePerS(
  state: PlanetState,
  colony: ColonyState,
  key: ResourceKey,
): number {
  const explicitColony = (colony as { incomePerS?: Partial<Record<ResourceKey, number>> }).incomePerS?.[key];
  if (typeof explicitColony === 'number' && explicitColony > 0) {
    return explicitColony;
  }
  const production = (colony as { production?: { incomePerS?: Partial<Record<ResourceKey, number>> } }).production;
  const ledgerRate = production?.incomePerS?.[key];
  if (typeof ledgerRate === 'number' && ledgerRate > 0) return ledgerRate;
  if (production?.incomePerS && workersAtWork(state, colony.index)) return 0; // the ledger knows: nothing comes in

  let rate = 0;
  let idleOrMovingWorkers = 0;
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colony.index) continue;
    const contrib = accumulateEntityIncome(state, r, key);
    rate += contrib.rateDelta;
    idleOrMovingWorkers += contrib.idleWorkerDelta;
  }

  if (rate === 0 && idleOrMovingWorkers > 0 && (key === 'metals.t1' || key === 'minerals.t1' || key === 'bio.biomass')) {
    rate = 0.5 * idleOrMovingWorkers;
  }
  return rate;
}

export function computeResourceWaitState(
  state: PlanetState,
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
  missing: Partial<Record<ResourceKey, number>>,
): { etaSeconds: number | null; waitDetail: string } {
  const keys = Object.keys(missing) as ResourceKey[];
  if (keys.length === 0) {
    return { etaSeconds: 0, waitDetail: 'waiting: resources' };
  }

  let maxEta: number | null = 0;
  let bottleneckKey: ResourceKey = keys[0];
  let bottleneckEta = -1;

  for (const k of keys) {
    const missAmt = missing[k] ?? 0;
    if (missAmt <= 0) continue;
    const income = estimateResourceIncomePerS(state, colony, k);
    if (income <= 0) {
      maxEta = null;
      if (bottleneckEta < Number.POSITIVE_INFINITY) {
        bottleneckEta = Number.POSITIVE_INFINITY;
        bottleneckKey = k;
      }
    } else {
      const kEta = Math.ceil(missAmt / income);
      if (maxEta !== null && kEta > maxEta) {
        maxEta = kEta;
      }
      if (kEta > bottleneckEta) {
        bottleneckEta = kEta;
        bottleneckKey = k;
      }
    }
  }

  const label = RESOURCE_DISPLAY_LABELS[bottleneckKey] ?? bottleneckKey;
  const stockMap = (colony.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const haveAmt = Math.floor(stockMap[bottleneckKey] ?? 0);
  const needAmt = cost[bottleneckKey] ?? 0;
  const waitDetail =
    maxEta !== null
      ? `waiting: ${label} ${haveAmt}/${needAmt} · ~${maxEta} s`
      : `waiting: ${label} ${haveAmt}/${needAmt} (no ETA)`;

  return { etaSeconds: maxEta, waitDetail };
}

export function isBlockedByPower(state: PlanetState, colony: ColonyState, entry: QueueEntry): boolean {
  const taskAny = entry.task as { requiresPower?: boolean; producerId?: number };
  const pwr = (colony.power ?? {}) as { status?: string; brownout?: boolean; net?: number };
  const inBrownout = pwr.status === 'brownout' || Boolean(pwr.brownout) || (pwr.net ?? 0) < 0;
  if (taskAny.requiresPower && inBrownout) {
    return true;
  }
  if (entry.task.kind === 'buildUnit') {
    if (typeof entry.task.producerId === 'number') {
      const pRow = rowOf(state.entities, entry.task.producerId);
      if (pRow >= 0) {
        const st = state.entities.cols.state[pRow];
        if (
          st === ENTITY_STATE.offlineBrownout ||
          st === ENTITY_STATE.offlineUnpowered ||
          st === ENTITY_STATE.offlineOverload ||
          st === ENTITY_STATE.offlineNoGrid ||
          st === ENTITY_STATE.constructing
        ) {
          return true;
        }
      }
    }
    if (entry.task.unit === 'recon') {
      const factories = findColonyRoboticsFactories(state, entry.colonyIndex);
      if (factories.length > 0) {
        const anyOnline = factories.some((r) => {
          const st = state.entities.cols.state[r];
          return st === ENTITY_STATE.active || st === ENTITY_STATE.idle;
        });
        if (!anyOnline) return true;
      } else if (inBrownout) {
        return true;
      }
    }
  }
  return false;
}

export function normalizeEnqueueArgs(raw: Record<string, unknown>): {
  task?: QueueTaskPayload;
  precedence?: QueuePrecedence;
  taskId?: string;
  costOverride?: Partial<Record<ResourceKey, number>>;
} {
  const task = extractQueueTaskPayloadFromRaw(raw);
  if (!task) return {};
  return {
    taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
    precedence: typeof raw.precedence === 'string' ? (raw.precedence as QueuePrecedence) : undefined,
    costOverride: raw.costOverride as Partial<Record<ResourceKey, number>> | undefined,
    task,
  };
}
