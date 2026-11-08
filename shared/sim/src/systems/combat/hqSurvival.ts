import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { cancelMove, requestMove } from '../../units/movement/orchestrator';
import { syncHqView } from '../hq/view';
import { defaultW01Data, resolveHqT1Row, rowNum } from '../rows';
import { cancelWorkerJobs, hasActiveWorkJobForWorker } from '../terraform-basic/workJobs';
import { provokeHiveFromDamage } from '../fauna/provocation';
import { issueUnitCommand } from '../units/registry';

interface CombatDamageBlob {
  lastDamagedByEntity: Record<number, number>;
  lastAttackerOwnerByEntity?: Record<number, number>;
}

function getDamageMap(state: PlanetState): Record<number, number> {
  const raw = (state.blobs.combatDamage?.value as CombatDamageBlob | undefined)?.lastDamagedByEntity;
  return raw ? { ...raw } : {};
}

function getAttackerOwnerMap(state: PlanetState): Record<number, number> {
  const raw = (state.blobs.combatDamage?.value as CombatDamageBlob | undefined)?.lastAttackerOwnerByEntity;
  return raw ? { ...raw } : {};
}

function writeCombatDamageBlob(state: PlanetState, value: CombatDamageBlob, tick: number): void {
  setBlob(state, 'combatDamage', value, tick);
}

export function recordEntityDamaged(
  state: PlanetState,
  entityId: number,
  tick: number,
  attackerOwner?: number,
  attackerId?: number,
): void {
  const lastDamagedByEntity = getDamageMap(state);
  const lastAttackerOwnerByEntity = getAttackerOwnerMap(state);
  lastDamagedByEntity[entityId] = tick;
  let resolvedOwner = attackerOwner;
  if (resolvedOwner === undefined && attackerId !== undefined && attackerId > 0) {
    const aRow = rowOf(state.entities, attackerId);
    if (aRow >= 0) resolvedOwner = state.entities.cols.owner[aRow]!;
  }
  if (typeof resolvedOwner === 'number' && resolvedOwner >= 0) {
    lastAttackerOwnerByEntity[entityId] = resolvedOwner;
  }
  writeCombatDamageBlob(state, { lastDamagedByEntity, lastAttackerOwnerByEntity }, tick);
  provokeHiveFromDamage(state, entityId, resolvedOwner, attackerId, tick);
}

export function clearEntityDamaged(state: PlanetState, entityId: number, tick: number): void {
  const lastDamagedByEntity = getDamageMap(state);
  if (entityId in lastDamagedByEntity) {
    delete lastDamagedByEntity[entityId];
    writeCombatDamageBlob(state, { lastDamagedByEntity }, tick);
  }
}

export function getLastDamagedTick(state: PlanetState, entityId: number): number | undefined {
  return (state.blobs.combatDamage?.value as CombatDamageBlob | undefined)?.lastDamagedByEntity?.[entityId];
}

export function hqRetreatHpRatio(data?: CompiledDataLike): number {
  const cfg = (data?.tables?.combatUnits as Record<string, Record<string, unknown>> | undefined)?.combatConfig;
  if (typeof cfg?.hqRetreatHpRatio === 'number') return cfg.hqRetreatHpRatio;
  const hqRow = resolveHqT1Row(data);
  return typeof hqRow.selfPreservationHpRatio === 'number' ? hqRow.selfPreservationHpRatio : 0.4;
}

export function hqSelfRepairPctPerS(data?: CompiledDataLike): number {
  const cfg = (data?.tables?.combatUnits as Record<string, Record<string, unknown>> | undefined)?.combatConfig;
  return typeof cfg?.hqSelfRepairPctPerS === 'number' ? cfg.hqSelfRepairPctPerS : 0.01;
}

export function clearWorkerDispatch(state: PlanetState, workerId: number, tick: number): void {
  const raw = (state.blobs.dispatch?.value as { byWorker?: Record<number, unknown> } | undefined)?.byWorker;
  if (!raw || !(workerId in raw)) return;
  const byWorker = { ...raw };
  delete byWorker[workerId];
  setBlob(state, 'dispatch', { byWorker }, tick);
}

function findNearestSafeAnchor(state: PlanetState, owner: number, fromQ: number, fromR: number): { q: number; r: number } | null {
  const e = state.entities, cols = e.cols;
  let bestHub: { q: number; r: number; dist: number } | null = null;
  let bestFallback: { q: number; r: number; dist: number } | null = null;

  for (let r = 0; r < e.count; r++) {
    if (cols.owner[r] !== owner) continue;
    if (cols.hpMax[r] > 0 && cols.hp[r] <= 0) continue;
    const k = cols.kind[r];
    if (k !== ENTITY_KIND.hub && k !== ENTITY_KIND.pod) continue;
    const dist = hexDistance(fromQ, fromR, cols.q[r], cols.r[r]);
    if (k === ENTITY_KIND.hub && cols.state[r] !== ENTITY_STATE.constructing && cols.state[r] !== ENTITY_STATE.descending) {
      if (!bestHub || dist < bestHub.dist) bestHub = { q: cols.q[r], r: cols.r[r], dist };
    } else if (!bestFallback || dist < bestFallback.dist) {
      bestFallback = { q: cols.q[r], r: cols.r[r], dist };
    }
  }
  return bestHub ?? bestFallback;
}

function fallbackStepCtx(state: PlanetState, tick: number, data: CompiledDataLike): StepContext {
  return {
    dt: 1,
    tick,
    flags: new Set(['W00', 'W01', 'W07']),
    data,
    events: [],
    postings: [],
    rng: (s) => state.rng[s],
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => undefined,
    record: () => undefined,
  };
}

/**
 * Drops active work orders for an HQ below 40% HP and orders it to retreat to the nearest owned Hub or Pod (`UO-HQ-03`).
 */
export function retreatHqToSafety(
  state: PlanetState,
  hqRowOrId: number,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): boolean {
  const e = state.entities, cols = e.cols;
  const row = hqRowOrId >= 0 && hqRowOrId < e.count && cols.kind[hqRowOrId] === ENTITY_KIND.hq ? hqRowOrId : rowOf(e, hqRowOrId);
  if (row < 0 || cols.kind[row] !== ENTITY_KIND.hq) return false;

  const hqId = cols.id[row];
  const owner = cols.owner[row];
  const data = ctx?.data ?? defaultW01Data();

  cancelWorkerJobs(state, hqId, tick);
  clearWorkerDispatch(state, hqId, tick);

  const book = new UnitBook(state);
  const uRec = book.get(hqId);
  uRec.current = null;
  uRec.queue = [];
  uRec.holdUntil = Math.max(uRec.holdUntil, tick + 25);
  book.touch();
  book.flush(tick);

  if (cols.progress[row] !== 0) setField(e, row, 'progress', 0, tick);

  const safe = findNearestSafeAnchor(state, owner, cols.q[row], cols.r[row]);
  if (safe && hexDistance(cols.q[row], cols.r[row], safe.q, safe.r) > 2) {
    const stepCtx = ctx ?? fallbackStepCtx(state, tick, data);
    issueUnitCommand(state, row, { kind: 'move', source: 'auto', q: safe.q, r: safe.r, minDist: 1, maxDist: 2 }, stepCtx);
    requestMove(state, row, { q: safe.q, r: safe.r, minDist: 1, maxDist: 2 }, stepCtx);
    setField(e, row, 'state', ENTITY_STATE.moving, tick);
    setField(e, row, 'targetQ', safe.q, tick);
    setField(e, row, 'targetR', safe.r, tick);
  } else {
    cancelMove(state, hqId, tick);
    setField(e, row, 'state', ENTITY_STATE.idle, tick);
    setField(e, row, 'targetQ', safe ? safe.q : cols.q[row], tick);
    setField(e, row, 'targetR', safe ? safe.r : cols.r[row], tick);
  }

  syncHqView(state, row, tick, data);
  return true;
}

/**
 * Steps HQ combat survival & out-of-combat self-repair (`1%` max HP/s, `UO-HQ-03`).
 */
export function stepHqCombatSurvival(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const dt = ctx?.dt ?? 1;
  const data = ctx?.data;
  const e = state.entities, cols = e.cols;
  const defaultHpMax = Math.fround(rowNum(resolveHqT1Row(data), 'hp'));
  const retreatRatio = hqRetreatHpRatio(data);
  const repairPctPerS = hqSelfRepairPctPerS(data);

  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (cols.state[row] === ENTITY_STATE.descending) continue;

    if (cols.hp[row] < 1) {
      setField(e, row, 'hp', 1, tick);
    }

    const hpMax = cols.hpMax[row] > 0 ? cols.hpMax[row] : defaultHpMax;
    const hqId = cols.id[row];

    if (cols.hp[row] / Math.max(1, hpMax) < retreatRatio) {
      const book = new UnitBook(state);
      const cur = book.peek(hqId)?.current;
      const onWorkCmd = cur?.kind === 'build' || cur?.kind === 'terraform' || cur?.kind === 'attack';
      if (
        hasActiveWorkJobForWorker(state, hqId) ||
        onWorkCmd ||
        cols.state[row] === ENTITY_STATE.working ||
        cols.state[row] === ENTITY_STATE.constructing
      ) {
        retreatHqToSafety(state, row, tick, ctx as StepContext | undefined);
      }
    }

    if (cols.hp[row] < hpMax) {
      const lastDamaged = getLastDamagedTick(state, hqId);
      if (lastDamaged === undefined || tick > lastDamaged) {
        const heal = hpMax * repairPctPerS * (dt / TICKS_PER_SECOND);
        const nextHp = Math.fround(Math.min(hpMax, Math.max(1, cols.hp[row]) + heal));
        if (nextHp !== cols.hp[row]) {
          setField(e, row, 'hp', nextHp, tick);
          syncHqView(state, row, tick, data);
        }
      }
    }
  }
}

export const stepHqSelfRepair = stepHqCombatSurvival;
