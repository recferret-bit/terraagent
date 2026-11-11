import { RESOURCE_FAMILY_OF, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import { rowOf } from '../../../ecs/store';
import { isBuildablePrepared } from '../../../grid/tileModel';
import { ensureColonyRecord } from '../../../kernel/colonies';
import type { CompiledDataLike } from '../../../kernel/config';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { getConstructionOrders } from '../../construction/orders';
import { getBuildingJobs } from '../../economy/buildJob';
import { getFootprintTileIndices } from '../../economy/buildingRows';
import { recomputeFamilyCaps } from '../../economy/ledger';
import { getColonyPower } from '../../power-core';
import { enqueueQueueTask, getColonyQueue, type QueueTaskPayload } from '../../queue';
import { hasAnyDepositOnGrid } from '../sites';
import type { ColonyGoalEntry } from '../types';

export function normalizeGoalResource(raw?: string): ResourceKey {
  if (!raw || raw === 'metals' || raw === 'metals.t1') return 'metals.t1';
  if (raw === 'minerals' || raw === 'minerals.t1') return 'minerals.t1';
  if (raw === 'water' || raw === 'bio.water') return 'bio.water';
  if (raw === 'biomass' || raw === 'bio.biomass') return 'bio.biomass';
  if (raw in RESOURCE_FAMILY_OF) return raw as ResourceKey;
  return 'metals.t1';
}

function hasColonyBuildingOrPod(state: PlanetState, colonyIndex: number): boolean {
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    const k = cols.kind[row];
    if (
      k === ENTITY_KIND.commandHub ||
      k === ENTITY_KIND.pod ||
      k === ENTITY_KIND.metalsExtractor ||
      k === ENTITY_KIND.solar
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether goal breakdown should run on the current step:
 * runs immediately on tick 1 whenever the colony has stock, deposits, or buildings/pods,
 * and on every step once `tick >= 5` (1 game second).
 */
export function shouldRunGoalBreakdown(state: PlanetState, colonyIndex: number, tick: number): boolean {
  if (tick >= 5) return true;
  const colony = state.colonies[colonyIndex];
  if (colony?.stock !== undefined || colony?.production !== undefined || colony?.power !== undefined) return true;
  if (hasColonyBuildingOrPod(state, colonyIndex)) return true;
  if (hasAnyDepositOnGrid(state)) return true;
  return false;
}

export function enqueueGoalChildTask(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  task: QueueTaskPayload,
  tick: number,
  ctx?: StepContext,
): boolean {
  const res = enqueueQueueTask(
    state,
    {
      colonyIndex,
      precedence: 'hq',
      goalId: goal.id,
      task,
      tick,
      data: ctx?.data,
    },
    ctx,
  );
  if (!res.ok) {
    goal.detail = `Waiting: ${res.detail ?? res.code}`;
    return false;
  }
  if (!goal.childTaskIds.includes(res.entry.taskId)) {
    goal.childTaskIds.push(res.entry.taskId);
  }
  return true;
}

export function hasAliveBuilding(
  state: PlanetState,
  colonyIndex: number,
  entityKind: number,
  completedOnly: boolean,
): boolean {
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== entityKind) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    if (!completedOnly) return true;
    if (cols.state[row] !== ENTITY_STATE.constructing && cols.state[row] !== ENTITY_STATE.waiting) {
      return true;
    }
  }
  return false;
}

export function hasOpenBuildTask(state: PlanetState, colonyIndex: number, building: string): boolean {
  const qEntries = getColonyQueue(state, colonyIndex, 'construction');
  for (const entry of qEntries) {
    if (entry.state === 'done' || entry.state === 'cancelled') continue;
    if (entry.task.kind === 'build' && entry.task.building === building) return true;
  }
  for (const order of getConstructionOrders(state, colonyIndex)) {
    if (order.status === 'completed' || order.status === 'cancelled') continue;
    if (order.building === building) return true;
  }
  return false;
}

export function isHubFootprintPrepared(state: PlanetState, colonyIndex: number): boolean {
  if (hasAliveBuilding(state, colonyIndex, ENTITY_KIND.commandHub, true)) return true;
  const jobs = getBuildingJobs(state);
  for (const job of Object.values(jobs)) {
    if (job.owner === colonyIndex && job.building === 'commandHub') {
      const fp = getFootprintTileIndices(state, job.q, job.r, job.footprintW, job.footprintD, job.rot);
      if (fp.valid && fp.indices.length > 0 && fp.indices.every((i) => isBuildablePrepared(state.grid, i))) {
        return true;
      }
    }
  }
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== ENTITY_KIND.commandHub) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    const fp = getFootprintTileIndices(state, cols.q[row], cols.r[row], cols.footprintW[row] || 3, cols.footprintD[row] || 3, cols.rot[row]);
    if (fp.valid && fp.indices.length > 0 && fp.indices.every((i) => isBuildablePrepared(state.grid, i))) {
      return true;
    }
  }
  return false;
}

export function syncHubColonyActivation(state: PlanetState, colonyIndex: number, tick: number): void {
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== ENTITY_KIND.commandHub) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    if (cols.state[row] === ENTITY_STATE.constructing || cols.state[row] === ENTITY_STATE.waiting) continue;
    const colony = ensureColonyRecord(state, colonyIndex, tick);
    colony.status = 'active';
    colony.hubEntityId = cols.id[row];
    colony.supplyCap = Math.max(Number(colony.supplyCap ?? 0), 12);
    colony.founderCoreGenPerS = Math.max(Number(colony.founderCoreGenPerS ?? 0), 8);
    recomputeFamilyCaps(colony, true, 0, tick);
    return;
  }
}

export function getChildTaskProgress(state: PlanetState, colonyIndex: number, goal: ColonyGoalEntry): number {
  const childSet = new Set(goal.childTaskIds);
  const allEntries = [...getColonyQueue(state, colonyIndex, 'construction'), ...getColonyQueue(state, colonyIndex, 'units')];
  let best = 0;
  for (const entry of allEntries) {
    if (entry.goalId !== goal.id && !childSet.has(entry.taskId)) continue;
    if (entry.state === 'done') {
      best = Math.max(best, 1);
      continue;
    }
    let prog = entry.progress ?? 0;
    if (typeof entry.entityId === 'number') {
      const eRow = rowOf(state.entities, entry.entityId);
      if (eRow >= 0) {
        if (state.entities.cols.state[eRow] === ENTITY_STATE.active) prog = 1;
        else prog = Math.max(prog, state.entities.cols.progress[eRow] || 0);
      }
    }
    if (entry.state === 'in_progress' && prog < 0.25) prog = 0.25;
    else if (prog >= 0.5) prog = 0.75;
    else if (prog > 0) prog = 0.5;
    best = Math.max(best, prog);
  }
  return best;
}

export function computeColonyResourceRatePerMin(
  state: PlanetState,
  colonyIndex: number,
  resourceKey: ResourceKey,
  data?: CompiledDataLike,
): number {
  // Read actual production. Idle workers, depleted deposits and unpowered extractors yield zero.
  const colony = state.colonies[colonyIndex];
  const production = colony?.production as { incomePerS?: Partial<Record<ResourceKey, number>> } | undefined;
  void data;
  return Math.max(0, Number(production?.incomePerS?.[resourceKey] ?? 0)) * 60;
}

export function computeEffectivePowerNetPerS(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): { netPerS: number; brownout: boolean } {
  const power = getColonyPower(state, colonyIndex, data);
  return { netPerS: power.net, brownout: power.brownout };
}
