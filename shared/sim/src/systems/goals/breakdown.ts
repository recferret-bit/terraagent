import { RESOURCE_FAMILY_OF, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { isBuildablePrepared } from '../../grid/tileModel';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { getConstructionOrders } from '../construction/orders';
import { getFootprintTileIndices } from '../economy/buildingRows';
import { getBuildingJobs } from '../economy/buildJob';
import { recomputeFamilyCaps } from '../economy/ledger';
import { getEnvironment } from '../environment';
import { getColonyPower } from '../power-core';
import { enqueueQueueTask, getColonyQueue, type QueueTaskPayload } from '../queue';
import { completeColonyGoal } from './index';
import {
  ensureStarterGoalStock,
  findExtractorSiteForGoal,
  findGeneratorSiteForGoal,
  findHubSiteForGoal,
  hasAnyDepositOnGrid,
} from './sites';
import { emitGoalProgress, getColonyGoals, saveColonyGoals } from './store';
import type { ColonyGoalEntry } from './types';
import { getGoalExecutor, registerGoalExecutor } from './executors';
import { stepClearCorridorGoal, stepDefendColonyGoal } from './defendAndClear';
import { planGrowth } from './growth';

const SECURE_POWER_HOLD_TICKS_NIGHT = 5;

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

function enqueueGoalChildTask(
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

function hasAliveBuilding(
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

function hasOpenBuildTask(state: PlanetState, colonyIndex: number, building: string): boolean {
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

function isHubFootprintPrepared(state: PlanetState, colonyIndex: number): boolean {
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

function syncHubColonyActivation(state: PlanetState, colonyIndex: number, tick: number): void {
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

function getChildTaskProgress(state: PlanetState, colonyIndex: number, goal: ColonyGoalEntry): number {
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

function computeEffectivePowerNetPerS(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): { netPerS: number; brownout: boolean } {
  const power = getColonyPower(state, colonyIndex, data);
  return { netPerS: power.net, brownout: power.brownout };
}

function stepEstablishColonyGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  ensureStarterGoalStock(state, colonyIndex, tick, ctx?.data);

  const hasHubAny = hasAliveBuilding(state, colonyIndex, ENTITY_KIND.commandHub, false) || hasOpenBuildTask(state, colonyIndex, 'commandHub');
  if (!hasHubAny) {
    const hubSite = findHubSiteForGoal(state, colonyIndex, ctx?.data);
    if (hubSite) {
      enqueueGoalChildTask(state, colonyIndex, goal, { kind: 'build', building: 'commandHub', q: hubSite.q, r: hubSite.r }, tick, ctx);
    }
  }

  const hasExtAny = hasAliveBuilding(state, colonyIndex, ENTITY_KIND.metalsExtractor, false) || hasOpenBuildTask(state, colonyIndex, 'metalsExtractor');
  if (!hasExtAny) {
    const extSite = findExtractorSiteForGoal(state, colonyIndex, ctx?.data);
    if (extSite) {
      enqueueGoalChildTask(state, colonyIndex, goal, { kind: 'build', building: 'metalsExtractor', q: extSite.q, r: extSite.r }, tick, ctx);
    }
  }

  const hasSolarAny = hasAliveBuilding(state, colonyIndex, ENTITY_KIND.solar, false) || hasOpenBuildTask(state, colonyIndex, 'solar');
  if (!hasSolarAny) {
    const solarSite = findGeneratorSiteForGoal(state, colonyIndex, ctx?.data, 'solar');
    if (solarSite) {
      enqueueGoalChildTask(state, colonyIndex, goal, { kind: 'build', building: 'solar', q: solarSite.q, r: solarSite.r }, tick, ctx);
    }
  }

  const step1Prep = isHubFootprintPrepared(state, colonyIndex);
  const step2Hub = hasAliveBuilding(state, colonyIndex, ENTITY_KIND.commandHub, true);
  const step3Ext = hasAliveBuilding(state, colonyIndex, ENTITY_KIND.metalsExtractor, true);
  const step4Solar = hasAliveBuilding(state, colonyIndex, ENTITY_KIND.solar, true);

  if (step2Hub) syncHubColonyActivation(state, colonyIndex, tick);

  const isReestablish = (goal.params as Record<string, unknown> | undefined)?.reestablish === true;
  if (isReestablish && step2Hub) {
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  const stepsCompleted = (step1Prep ? 1 : 0) + (step2Hub ? 1 : 0) + (step3Ext ? 1 : 0) + (step4Solar ? 1 : 0);
  const stepsTotal = 4;
  if (step2Hub && step3Ext && step4Solar) {
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  const nextProgress = Number((stepsCompleted / stepsTotal).toFixed(2));
  const changed = nextProgress !== goal.progress || stepsCompleted !== goal.stepsCompleted || goal.stepsTotal !== stepsTotal;
  goal.stepsTotal = stepsTotal;
  goal.stepsCompleted = stepsCompleted;
  goal.progress = nextProgress;
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (changed) emitGoalProgress(ctx, colonyIndex, goal);
}

function stepGrowEconomyGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  const resourceKey = normalizeGoalResource(goal.params.resource);
  const targetRatePerMin = Math.max(1, Number(goal.params.targetRatePerMin ?? goal.params.target ?? 10));
  goal.params.resource = resourceKey;
  goal.params.targetRatePerMin = targetRatePerMin;

  const currentRatePerMin = computeColonyResourceRatePerMin(state, colonyIndex, resourceKey, ctx?.data);
  if (currentRatePerMin >= targetRatePerMin - 1e-6) {
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  ensureStarterGoalStock(state, colonyIndex, tick, ctx?.data);
  const orders = [...getColonyQueue(state, colonyIndex, 'construction'), ...getColonyQueue(state, colonyIndex, 'units')];
  const openChild = orders.find((e) => e.goalId === goal.id && e.state !== 'done' && e.state !== 'cancelled');
  goal.detail = `${currentRatePerMin.toFixed(1)} / ${targetRatePerMin} ${resourceKey}/min. `;
  if (openChild) {
    goal.detail += openChild.waitDetail || `Working: ${openChild.task.kind === 'build' ? openChild.task.building : 'worker'}`;
  } else {
    const plan = planGrowth(state, colonyIndex, resourceKey, tick, ctx?.data);
    goal.detail += plan.detail;
    if (plan.task) enqueueGoalChildTask(state, colonyIndex, goal, plan.task, tick, ctx);
  }

  const rateRatio = Math.max(0, Math.min(1, currentRatePerMin / targetRatePerMin));
  const buildProg = getChildTaskProgress(state, colonyIndex, goal);
  const nextProgress = Number(Math.min(0.95, Math.max(rateRatio, buildProg * 0.75)).toFixed(2));
  const stepsCompleted = nextProgress >= 0.5 ? 1 : 0;
  const changed = nextProgress !== goal.progress || stepsCompleted !== goal.stepsCompleted;
  goal.stepsTotal = 2;
  goal.stepsCompleted = stepsCompleted;
  goal.progress = nextProgress;
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (changed) emitGoalProgress(ctx, colonyIndex, goal);
}

function stepSecurePowerGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  const targetNetEnergyPerS = Number(goal.params.targetNetEnergyPerS ?? goal.params.target ?? 10);
  goal.params.targetNetEnergyPerS = targetNetEnergyPerS;
  ensureStarterGoalStock(state, colonyIndex, tick, ctx?.data);

  const { netPerS, brownout } = computeEffectivePowerNetPerS(state, colonyIndex, ctx?.data);
  goal.detail = `${netPerS.toFixed(1)} / ${targetNetEnergyPerS} E/s. ${getEnvironment(state).phase === 'night' ? 'Night power: solar cannot meet a night deficit; night generators arrive in W03.' : 'Building daytime power, then verifying at night.'}`;
  const hasOpenSolar =
    hasOpenBuildTask(state, colonyIndex, 'solar') ||
    (hasAliveBuilding(state, colonyIndex, ENTITY_KIND.solar, false) &&
      !hasAliveBuilding(state, colonyIndex, ENTITY_KIND.solar, true));

  if (netPerS < targetNetEnergyPerS - 1e-6 || brownout) {
    goal.nightHeldTicks = 0;
    if (!hasOpenSolar && getEnvironment(state).phase !== 'night') {
      const solarSite = findGeneratorSiteForGoal(state, colonyIndex, ctx?.data, 'solar');
      if (solarSite) {
        enqueueGoalChildTask(state, colonyIndex, goal, { kind: 'build', building: 'solar', q: solarSite.q, r: solarSite.r }, tick, ctx);
      }
    }
    const buildProg = getChildTaskProgress(state, colonyIndex, goal);
    const ratio = targetNetEnergyPerS > 0 ? Math.max(0, netPerS / targetNetEnergyPerS) : 0;
    const nextProgress = Number(Math.min(0.5, Math.max(ratio, buildProg) * 0.5).toFixed(2));
    const stepsCompleted = buildProg >= 0.5 ? 1 : 0;
    const changed = nextProgress !== goal.progress || stepsCompleted !== goal.stepsCompleted;
    goal.stepsTotal = 2;
    goal.stepsCompleted = stepsCompleted;
    goal.progress = nextProgress;
    saveColonyGoals(state, colonyIndex, goals, tick);
    if (changed) emitGoalProgress(ctx, colonyIndex, goal);
    return;
  }

  if (getEnvironment(state).phase !== 'night') {
    goal.detail = 'Daytime power ready. Waiting for night to verify the target.';
    goal.nightHeldTicks = 0;
    saveColonyGoals(state, colonyIndex, goals, tick);
    return;
  }
  const dt = Math.max(1, ctx?.dt ?? 1);
  goal.nightHeldTicks = (goal.nightHeldTicks ?? 0) + dt;
  const holdTarget = SECURE_POWER_HOLD_TICKS_NIGHT;
  if (goal.nightHeldTicks >= holdTarget) {
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  const nextProgress = Number(Math.min(0.95, 0.5 + 0.5 * (goal.nightHeldTicks / holdTarget)).toFixed(2));
  const stepsCompleted = 1;
  const changed = nextProgress !== goal.progress || stepsCompleted !== goal.stepsCompleted;
  goal.stepsTotal = 2;
  goal.stepsCompleted = stepsCompleted;
  goal.progress = nextProgress;
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (changed) emitGoalProgress(ctx, colonyIndex, goal);
}

/**
 * Steps active goal breakdown and progress evaluation for `colonyIndex`.
 */
export function stepColonyGoalsBreakdown(
  state: PlanetState,
  colonyIndex: number,
  ctx?: StepContext,
  force = false,
): void {
  const tick = ctx?.tick ?? state.meta.tick;
  if (!force && !shouldRunGoalBreakdown(state, colonyIndex, tick)) return;
  const goals = getColonyGoals(state, colonyIndex);
  const active = goals.find((g) => g.status === 'active');
  if (!active) return;

  const executor = getGoalExecutor(active.goal, ctx?.flags);
  if (executor) executor(state, colonyIndex, active, goals, tick, ctx);
  else {
    active.detail = 'Unavailable: this goal requires its owning feature wave. Cancel to continue.';
    saveColonyGoals(state, colonyIndex, goals, tick);
  }
}

registerGoalExecutor('establish_colony', stepEstablishColonyGoal);
registerGoalExecutor('grow_economy', stepGrowEconomyGoal);
registerGoalExecutor('secure_power', stepSecurePowerGoal);
registerGoalExecutor('defend_colony', stepDefendColonyGoal, { wave: 'W07' });
registerGoalExecutor('clear_corridor', stepClearCorridorGoal, { wave: 'W07' });
