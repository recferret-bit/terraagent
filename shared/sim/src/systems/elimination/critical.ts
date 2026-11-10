import { rowOf } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { ApplyDamageOptions } from '../combat/damage';
import { resolveColonyIdStr } from '../diplomacy/store';
import { colonyWho } from '../find';
import { completeColonyGoal } from '../goals';
import { emitGoalProgress, getColonyGoals, promoteOpenGoals, saveColonyGoals } from '../goals/store';
import { DEFAULT_GOAL_BUDGET_BP, type ColonyGoalEntry } from '../goals/types';
import {
  colonyHasAliveHq,
  colonyHasAliveHub,
  criticalTimerTicks,
  ensureColonyEliminationRecord,
  getColonyEliminationRecord,
  getEliminationStore,
  saveEliminationStore,
} from './store';

export function insertReestablishGoalAtTop(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  ctx?: StepContext,
): ColonyGoalEntry {
  const goals = getColonyGoals(state, colonyIndex);
  for (const g of goals) {
    if (g.status === 'active') {
      g.status = 'queued';
    }
  }

  const existingIdx = goals.findIndex(
    (g) => g.goal === 'establish_colony' && (g.status === 'queued' || g.status === 'active'),
  );
  if (existingIdx >= 0) {
    const [existing] = goals.splice(existingIdx, 1);
    existing.status = 'active';
    existing.startedAtTick ??= tick;
    (existing.params as Record<string, unknown>).reestablish = true;
    existing.detail = 'Re-establish: Place and complete a new Command Hub';
    goals.unshift(existing);
    promoteOpenGoals(goals, tick);
    saveColonyGoals(state, colonyIndex, goals, tick);
    emitGoalProgress(ctx, colonyIndex, existing, existing.detail);
    return existing;
  }

  const entry: ColonyGoalEntry = {
    id: `goal_${colonyIndex}_reestablish_${tick}`,
    goal: 'establish_colony',
    status: 'active',
    params: { reestablish: true } as ColonyGoalEntry['params'],
    progress: 0,
    stepsCompleted: 0,
    stepsTotal: 2,
    budgetBp: DEFAULT_GOAL_BUDGET_BP,
    spent: {},
    childTaskIds: [],
    createdAtTick: tick,
    startedAtTick: tick,
    detail: 'Re-establish: Place and complete a new Command Hub',
  };

  goals.unshift(entry);
  promoteOpenGoals(goals, tick);
  saveColonyGoals(state, colonyIndex, goals, tick);
  emitGoalProgress(ctx, colonyIndex, entry, entry.detail);
  return entry;
}

export function clearColonyCriticalOnHubRebuilt(
  state: PlanetState,
  colonyIndex: number,
  tick: number = state.meta.tick,
  ctx?: Partial<StepContext>,
): boolean {
  const rec = getColonyEliminationRecord(state, colonyIndex);
  const col = state.colonies[colonyIndex];
  const colRaw = col as Record<string, unknown> | undefined;
  const wasCritical =
    rec?.criticalDeadlineTick !== undefined ||
    col?.status === 'critical' ||
    colRaw?.criticalDeadlineTick !== undefined;
  if (!wasCritical) return false;

  const store = getEliminationStore(state);
  const targetRec = ensureColonyEliminationRecord(store, colonyIndex);
  delete targetRec.criticalDeadlineTick;
  saveEliminationStore(state, store, tick);

  const ensuredCol = ensureColonyRecord(state, colonyIndex, tick);
  if (ensuredCol.status === 'critical') {
    ensuredCol.status = 'active';
  }
  delete (ensuredCol as Record<string, unknown>).criticalDeadlineTick;
  ensuredCol.changedAt = tick;

  const goals = getColonyGoals(state, colonyIndex);
  const reestablish = goals.find(
    (g) =>
      g.goal === 'establish_colony' &&
      (g.status === 'active' || g.status === 'queued') &&
      (g.params as Record<string, unknown> | undefined)?.reestablish === true,
  );
  if (reestablish) {
    const fullCtx = typeof ctx?.emit === 'function' ? (ctx as StepContext) : undefined;
    completeColonyGoal(state, colonyIndex, reestablish.id, tick, fullCtx);
  }
  return true;
}

export function onHubDestroyed(
  state: PlanetState,
  colonyIndex: number,
  hubEntityId: number,
  tick: number,
  opts?: ApplyDamageOptions,
): void {
  if (colonyIndex < 0) return;
  if (colonyHasAliveHub(state, colonyIndex)) return;

  const data = opts?.data ?? opts?.ctx?.data;
  const store = getEliminationStore(state);
  const rec = ensureColonyEliminationRecord(store, colonyIndex);

  if (!colonyHasAliveHq(state, colonyIndex)) {
    rec.hqDown = true;
    rec.eliminatedAtTick = tick;
    delete rec.criticalDeadlineTick;
    const attackerOwner =
      opts?.attackerOwner !== undefined
        ? opts.attackerOwner
        : opts?.attackerId !== undefined && rowOf(state.entities, opts.attackerId) >= 0
          ? state.entities.cols.owner[rowOf(state.entities, opts.attackerId)]
          : undefined;
    if (typeof attackerOwner === 'number' && attackerOwner >= 0 && attackerOwner !== colonyIndex) {
      rec.eliminatedByColonyId = resolveColonyIdStr(state, attackerOwner);
    }
    saveEliminationStore(state, store, tick);

    const col = ensureColonyRecord(state, colonyIndex, tick);
    col.status = 'eliminated';
    delete (col as Record<string, unknown>).criticalDeadlineTick;
    col.changedAt = tick;

    if (opts?.ctx) {
      const { colonyIdStr, who } = colonyWho(state, colonyIndex);
      opts.ctx.emit({
        kind: 'colonyEliminated',
        severity: 'critical',
        colonyIds: rec.eliminatedByColonyId ? [colonyIdStr, rec.eliminatedByColonyId] : [colonyIdStr],
        data: {
          ...who,
          colonyIndex,
          reason: 'both_lost',
          ...(rec.eliminatedByColonyId ? { byColony: rec.eliminatedByColonyId, killerColonyId: rec.eliminatedByColonyId } : {}),
        },
      });
    }
    return;
  }

  const deadlineTick = tick + criticalTimerTicks(data);
  rec.criticalDeadlineTick = deadlineTick;
  saveEliminationStore(state, store, tick);

  const col = ensureColonyRecord(state, colonyIndex, tick);
  col.status = 'critical';
  (col as Record<string, unknown>).criticalDeadlineTick = deadlineTick;
  col.changedAt = tick;

  insertReestablishGoalAtTop(state, colonyIndex, tick, opts?.ctx);

  if (opts?.ctx) {
    const { colonyIdStr, who } = colonyWho(state, colonyIndex);
    const durationSeconds = Math.round((deadlineTick - tick) / TICKS_PER_SECOND);
    opts.ctx.emit({
      kind: 'colonyCritical',
      severity: 'critical',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex,
        hubEntityId,
        deadlineTick,
        remainingSeconds: durationSeconds,
        durationSeconds,
      },
    });
  }
}
