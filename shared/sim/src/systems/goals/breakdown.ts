import { ENTITY_KIND } from '../../ecs/columns';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { getEnvironment } from '../environment';
import { getColonyQueue } from '../queue';
import { stepClearCorridorGoal, stepDefendColonyGoal } from './defendAndClear';
import { getGoalExecutor, registerGoalExecutor } from './executors';
import { planGrowth } from './growth';
import { completeColonyGoal } from './index';
import {
  computeColonyResourceRatePerMin,
  computeEffectivePowerNetPerS,
  enqueueGoalChildTask,
  getChildTaskProgress,
  hasAliveBuilding,
  hasOpenBuildTask,
  isHubFootprintPrepared,
  normalizeGoalResource,
  shouldRunGoalBreakdown,
  syncHubColonyActivation,
} from './parts/breakdownParts';
import {
  ensureStarterGoalStock,
  findExtractorSiteForGoal,
  findGeneratorSiteForGoal,
  findHubSiteForGoal,
} from './sites';
import { emitGoalProgress, getColonyGoals, saveColonyGoals } from './store';
import type { ColonyGoalEntry } from './types';

export {
  computeColonyResourceRatePerMin,
  normalizeGoalResource,
  shouldRunGoalBreakdown,
};

const SECURE_POWER_HOLD_TICKS_NIGHT = 5;

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
