import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { seedStream } from '../../kernel/rng';
import type { PlanetState } from '../../kernel/state';
import { orderUnitAttackTarget, setUnitStance } from '../combat/stances';
import { isHostileTargetForAttacker } from '../combat/targeting';
import { getConstructionOrders } from '../construction/orders';
import { getAllHives } from '../fauna/state';
import { enqueueQueueTask, getColonyQueue, type QueueTaskPayload } from '../queue';
import { selectDeterministicBuildSite } from '../rule-engine/site';
import { completeColonyGoal } from './index';
import { ensureStarterGoalStock, findColonyAnchor } from './sites';
import { emitGoalProgress, saveColonyGoals } from './store';
import type { ColonyGoalEntry } from './types';

const W07_FALLBACK_FLAGS = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08']);
let cachedW07GoalData: CompiledDataLike | null = null;

function createFallbackGoalCtx(state: PlanetState, tick: number, data?: CompiledDataLike): StepContext {
  if (!cachedW07GoalData) cachedW07GoalData = compileData(W07_FALLBACK_FLAGS);
  return {
    dt: 1,
    tick,
    flags: W07_FALLBACK_FLAGS,
    data: data ?? cachedW07GoalData,
    rng: (s) => seedStream(String(state.meta.seed), `${s}:${tick}`),
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => {},
    events: [],
    record: () => {},
    postings: [],
  };
}

function enqueueGoalTask(
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

function hasColonyBuildingKind(
  state: PlanetState,
  colonyIndex: number,
  kind: number,
  completedOnly: boolean,
): boolean {
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== kind) continue;
    if (cols.hp[row]! <= 0 && cols.hpMax[row]! > 0) continue;
    if (!completedOnly) return true;
    if (cols.state[row] !== ENTITY_STATE.constructing && cols.state[row] !== ENTITY_STATE.waiting) {
      return true;
    }
  }
  return false;
}

function hasOpenConstructionFor(state: PlanetState, colonyIndex: number, buildings: readonly string[]): boolean {
  const set = new Set(buildings);
  for (const entry of getColonyQueue(state, colonyIndex, 'construction')) {
    if (entry.state === 'done' || entry.state === 'cancelled') continue;
    if (entry.task.kind === 'build' && set.has(entry.task.building)) return true;
  }
  for (const order of getConstructionOrders(state, colonyIndex)) {
    if (order.status === 'completed' || order.status === 'cancelled') continue;
    if (set.has(order.building)) return true;
  }
  return false;
}

function hasOpenUnitQueueFor(state: PlanetState, colonyIndex: number, unitKind: string): boolean {
  for (const entry of getColonyQueue(state, colonyIndex, 'units')) {
    if (entry.state === 'done' || entry.state === 'cancelled') continue;
    if (entry.task.kind === 'buildUnit' && entry.task.unit === unitKind) return true;
  }
  return false;
}

function collectColonyCombatUnits(state: PlanetState, colonyIndex: number): number[] {
  const { count, cols } = state.entities;
  const ids: number[] = [];
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row]! <= 0) continue;
    const st = cols.state[row]!;
    if (st === ENTITY_STATE.constructing || st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const k = cols.kind[row]!;
    if (k === ENTITY_KIND.recon || k === ENTITY_KIND.demoTank || k === ENTITY_KIND.demoArtillery) {
      ids.push(cols.id[row]!);
    }
  }
  return ids.sort((a, b) => a - b);
}

function countCompletedTurrets(state: PlanetState, colonyIndex: number): number {
  const { count, cols } = state.entities;
  let total = 0;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row]! <= 0) continue;
    const k = cols.kind[row]!;
    if (k !== ENTITY_KIND.autocannon && k !== ENTITY_KIND.laserTower) continue;
    if (cols.state[row] !== ENTITY_STATE.constructing && cols.state[row] !== ENTITY_STATE.waiting) {
      total++;
    }
  }
  return total;
}

function countHostilesInPerimeter(
  state: PlanetState,
  colonyIndex: number,
  anchor: { q: number; r: number },
  radius: number,
): number {
  const { count, cols } = state.entities;
  let refRow = -1;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex && cols.hp[r]! > 0) {
      refRow = r;
      break;
    }
  }
  let hostiles = 0;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    if (hexDistance(anchor.q, anchor.r, cols.q[r]!, cols.r[r]!) > radius) continue;
    if (refRow >= 0) {
      if (isHostileTargetForAttacker(state, refRow, r, { includePassiveFauna: false })) {
        hostiles++;
      }
    } else if (cols.owner[r]! < 0) {
      hostiles++;
    }
  }
  return hostiles;
}

function childProgress(state: PlanetState, colonyIndex: number, goal: ColonyGoalEntry): number {
  const childSet = new Set(goal.childTaskIds);
  const entries = [
    ...getColonyQueue(state, colonyIndex, 'construction'),
    ...getColonyQueue(state, colonyIndex, 'units'),
  ];
  let best = 0;
  for (const e of entries) {
    if (e.goalId !== goal.id && !childSet.has(e.taskId)) continue;
    if (e.state === 'done') {
      best = Math.max(best, 1);
      continue;
    }
    const p = e.progress ?? (e.state === 'in_progress' ? 0.35 : 0.15);
    if (p > best) best = p;
  }
  return best;
}

/**
 * Executor for `defend_colony` ("Defend Area", `W07`):
 * - Ensures the colony has active defense coverage (a completed `autocannon`/`laserTower` turret or
 *   `recon` combat unit), queueing an `autocannon` or `recon` if none exists.
 * - Sets own combat units to `defend` stance anchored at the colony perimeter.
 * - Completes when active defense is in place and no hostile raiders remain inside the perimeter.
 */
export function stepDefendColonyGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  ensureStarterGoalStock(state, colonyIndex, tick, ctx?.data);
  const anchor = findColonyAnchor(state, colonyIndex);
  const combatUnitIds = collectColonyCombatUnits(state, colonyIndex);
  const completedTurrets = countCompletedTurrets(state, colonyIndex);

  for (const unitId of combatUnitIds) {
    setUnitStance(state, unitId, 'defend', anchor, tick);
  }

  const hasPendingTurret =
    hasColonyBuildingKind(state, colonyIndex, ENTITY_KIND.autocannon, false) ||
    hasColonyBuildingKind(state, colonyIndex, ENTITY_KIND.laserTower, false) ||
    hasOpenConstructionFor(state, colonyIndex, ['autocannon', 'laserTower', 'turret']);
  const hasPendingUnit = hasOpenUnitQueueFor(state, colonyIndex, 'recon');

  if (completedTurrets === 0 && combatUnitIds.length === 0 && !hasPendingTurret && !hasPendingUnit) {
    const hasFactory = hasColonyBuildingKind(state, colonyIndex, ENTITY_KIND.roboticsFactory, true);
    let queued = false;
    if (hasFactory) {
      queued = enqueueGoalTask(
        state,
        colonyIndex,
        goal,
        { kind: 'buildUnit', unit: 'recon', count: 1 },
        tick,
        ctx,
      );
    }
    if (!queued) {
      const site = selectDeterministicBuildSite(state, colonyIndex, 'autocannon', {
        requireOwned: false,
        data: ctx?.data,
      });
      if (site) {
        enqueueGoalTask(
          state,
          colonyIndex,
          goal,
          { kind: 'build', building: 'autocannon', q: site.q, r: site.r },
          tick,
          ctx,
        );
      } else {
        goal.detail = 'Waiting: no valid site for defense turret.';
      }
    }
  }

  const hostilesNear = countHostilesInPerimeter(state, colonyIndex, anchor, 15);
  const hasActiveDefense = completedTurrets > 0 || combatUnitIds.length > 0;
  if (hasActiveDefense && hostilesNear === 0) {
    goal.detail = 'Area defended: perimeter secure.';
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  const buildProg = childProgress(state, colonyIndex, goal);
  const nextProgress = hasActiveDefense
    ? 0.75
    : Number(Math.min(0.7, Math.max(0.1, buildProg * 0.7)).toFixed(2));
  const stepsCompleted = hasActiveDefense || buildProg >= 0.5 ? 1 : 0;
  if (hasActiveDefense && hostilesNear > 0) {
    goal.detail = `Defending perimeter (${hostilesNear} hostile${hostilesNear === 1 ? '' : 's'} remaining).`;
  } else if (!goal.detail) {
    goal.detail = 'Establishing colony perimeter defense.';
  }

  const changed = nextProgress !== goal.progress || stepsCompleted !== goal.stepsCompleted;
  goal.stepsTotal = 2;
  goal.stepsCompleted = stepsCompleted;
  goal.progress = nextProgress;
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (changed) emitGoalProgress(ctx, colonyIndex, goal);
}

interface TargetHiveInfo {
  hiveId: number;
  q: number;
  r: number;
  hp: number;
  hpMax: number;
  destroyed: boolean;
}

function findTargetHiveForClearGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
): { target: TargetHiveInfo | null; explicitTargetDestroyed: boolean } {
  const cols = state.entities.cols;
  const anchor = findColonyAnchor(state, colonyIndex);
  const explicitId = Number(goal.params.target);

  if (Number.isInteger(explicitId) && explicitId > 0) {
    const eRow = rowOf(state.entities, explicitId);
    if (eRow < 0 || cols.hp[eRow]! <= 0) {
      return { target: null, explicitTargetDestroyed: true };
    }
    return {
      target: {
        hiveId: explicitId,
        q: cols.q[eRow]!,
        r: cols.r[eRow]!,
        hp: cols.hp[eRow]!,
        hpMax: Math.max(1, cols.hpMax[eRow]!),
        destroyed: false,
      },
      explicitTargetDestroyed: false,
    };
  }

  const candidates: TargetHiveInfo[] = [];
  for (const h of getAllHives(state)) {
    const r = rowOf(state.entities, h.hiveId);
    const hp = r >= 0 ? cols.hp[r]! : 0;
    if (h.destroyed || hp <= 0) continue;
    candidates.push({
      hiveId: h.hiveId,
      q: h.q,
      r: h.r,
      hp,
      hpMax: Math.max(1, h.hpMax),
      destroyed: false,
    });
  }

  for (let r = 0; r < state.entities.count; r++) {
    if (cols.hp[r]! <= 0) continue;
    const k = cols.kind[r]!;
    if (
      k !== ENTITY_KIND.hiveBlackAnt &&
      k !== ENTITY_KIND.hiveBlueBeetle &&
      k !== ENTITY_KIND.hiveGreenSpitter
    ) {
      continue;
    }
    const id = cols.id[r]!;
    if (candidates.some((c) => c.hiveId === id)) continue;
    candidates.push({
      hiveId: id,
      q: cols.q[r]!,
      r: cols.r[r]!,
      hp: cols.hp[r]!,
      hpMax: Math.max(1, cols.hpMax[r]!),
      destroyed: false,
    });
  }

  if (candidates.length === 0) {
    return { target: null, explicitTargetDestroyed: false };
  }

  candidates.sort((a, b) => {
    const da = hexDistance(anchor.q, anchor.r, a.q, a.r);
    const db = hexDistance(anchor.q, anchor.r, b.q, b.r);
    return da !== db ? da - db : a.hiveId - b.hiveId;
  });
  return { target: candidates[0]!, explicitTargetDestroyed: false };
}

/**
 * Executor for `clear_corridor` ("Clear Nest", `W07`):
 * - Selects the target hive (`goal.params.target` or nearest live fauna hive).
 * - Completes immediately when no live hive remains or the target hive is destroyed.
 * - Queues `roboticsFactory` / `recon` if the colony has no combat units, and orders all own
 *   combat units to `orderUnitAttackTarget` the hive, tracking HP reduction until destroyed.
 */
export function stepClearCorridorGoal(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[],
  tick: number,
  ctx?: StepContext,
): void {
  ensureStarterGoalStock(state, colonyIndex, tick, ctx?.data);
  const { target, explicitTargetDestroyed } = findTargetHiveForClearGoal(state, colonyIndex, goal);
  if (!target || explicitTargetDestroyed) {
    goal.detail = 'Nest cleared.';
    saveColonyGoals(state, colonyIndex, goals, tick);
    completeColonyGoal(state, colonyIndex, goal.id, tick, ctx);
    return;
  }

  goal.params.target = target.hiveId;
  const combatUnitIds = collectColonyCombatUnits(state, colonyIndex);
  const stepCtx = ctx ?? createFallbackGoalCtx(state, tick, undefined);

  if (combatUnitIds.length === 0) {
    const hasFactoryAny =
      hasColonyBuildingKind(state, colonyIndex, ENTITY_KIND.roboticsFactory, false) ||
      hasOpenConstructionFor(state, colonyIndex, ['roboticsFactory']);
    if (!hasFactoryAny) {
      const site = selectDeterministicBuildSite(state, colonyIndex, 'roboticsFactory', {
        requireOwned: false,
        data: ctx?.data,
      });
      if (site) {
        enqueueGoalTask(
          state,
          colonyIndex,
          goal,
          { kind: 'build', building: 'roboticsFactory', q: site.q, r: site.r },
          tick,
          ctx,
        );
      }
    } else if (
      hasColonyBuildingKind(state, colonyIndex, ENTITY_KIND.roboticsFactory, true) &&
      !hasOpenUnitQueueFor(state, colonyIndex, 'recon')
    ) {
      enqueueGoalTask(
        state,
        colonyIndex,
        goal,
        { kind: 'buildUnit', unit: 'recon', count: 1 },
        tick,
        ctx,
      );
    }
  } else {
    for (const unitId of combatUnitIds) {
      orderUnitAttackTarget(state, unitId, target.hiveId, stepCtx);
    }
  }

  const hpDamageRatio = Math.max(0, Math.min(1, 1 - target.hp / target.hpMax));
  const prepProg = combatUnitIds.length > 0 ? 0.3 : childProgress(state, colonyIndex, goal) * 0.25;
  const nextProgress = Number(Math.min(0.95, Math.max(prepProg, 0.3 + hpDamageRatio * 0.65)).toFixed(2));
  const stepsCompleted = combatUnitIds.length > 0 ? (hpDamageRatio >= 0.5 ? 2 : 1) : 0;
  goal.detail =
    combatUnitIds.length > 0
      ? `Attacking nest #${target.hiveId} (${Math.ceil(target.hp)}/${target.hpMax} HP).`
      : goal.detail || 'Preparing combat units to clear nest.';

  const changed = nextProgress !== goal.progress || stepsCompleted !== goal.stepsCompleted;
  goal.stepsTotal = 3;
  goal.stepsCompleted = stepsCompleted;
  goal.progress = nextProgress;
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (changed) emitGoalProgress(ctx, colonyIndex, goal);
}
