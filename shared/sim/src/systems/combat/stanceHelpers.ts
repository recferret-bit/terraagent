import { ENTITY_STATE } from '../../ecs/columns';
import { setField, type Columns } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { pathBlockersFor } from '../../grid/pathProfiles';
import { isGroundPassable } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { mobileStats, notifyUnitChanged } from '../../units/mobility';
import { faceTowards } from '../../units/movement/locomotion';
import { cancelMove, getMotion, requestMove, sameGoal, type MoveGoal } from '../../units/movement/orchestrator';
import { withoutUnitView } from '../harvest/unit';
import { issueUnitCommand } from '../units/registry';
import { clearEvasiveState, getEvasiveState, isUnitEvasive, stepEvasiveUnit } from './evasive';
import { canWeaponHitTarget } from './layers';
import type { CombatStance, CombatStancesBlob, UnitStanceRecord } from './stances';
import { COMBAT_STANCES_BLOB } from './stances';
import {
  acquireClosestTargetInRange,
  isHostileTargetForAttacker,
  pickMinRangeBackoffNeighbor,
} from './targeting';
import { fireWeaponAtTarget, weaponCooldownTicks } from './turrets';

export function readStancesBlob(state: PlanetState): Record<number, UnitStanceRecord> {
  const raw = state.blobs[COMBAT_STANCES_BLOB]?.value as Partial<CombatStancesBlob> | undefined;
  if (!raw?.byEntityId) return {};
  const out: Record<number, UnitStanceRecord> = {};
  for (const [k, v] of Object.entries(raw.byEntityId)) {
    if (v && typeof v === 'object') {
      out[Number(k)] = {
        ...v,
        attackMoveGoal: v.attackMoveGoal ? { ...v.attackMoveGoal } : null,
      };
    }
  }
  return out;
}

export function writeStancesBlob(
  state: PlanetState,
  byEntityId: Record<number, UnitStanceRecord>,
  tick: number,
): void {
  setBlob(state, COMBAT_STANCES_BLOB, { byEntityId }, tick);
}

export function mirrorUnitStanceToView(
  state: PlanetState,
  row: number,
  stance: CombatStance,
  tick: number,
): void {
  if (row < 0 || row >= state.entities.count) return;
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const owner = cols.owner[row]!;

  const unitsBlob = state.blobs.units?.value as Record<string, unknown> | undefined;
  if (unitsBlob && typeof unitsBlob[entityId] === 'object' && unitsBlob[entityId] !== null) {
    const updatedView = { ...(unitsBlob[entityId] as Record<string, unknown>), stance };
    setBlob(state, 'units', { ...unitsBlob, [entityId]: updatedView }, tick);
  }

  if (owner >= 0 && state.colonies[owner]?.units) {
    const col = state.colonies[owner]!;
    const existing = (col.units as Array<{ entityId?: number }> | undefined)?.find(
      (u) => u && u.entityId === entityId,
    );
    if (existing) {
      const updated = { ...(existing as Record<string, unknown>), stance };
      col.units = [...withoutUnitView(col.units, entityId), updated];
      col.changedAt = tick;
    }
  }
}

export function getUnitContinuousCoords(cols: Columns, row: number): [number, number] {
  const x = cols.x[row]!;
  const y = cols.y[row]!;
  const q = cols.q[row]!;
  const r = cols.r[row]!;
  if (x === 0 && y === 0 && (q !== 0 || r !== 0)) return [q, r];
  return [x, y];
}

export function haltCombatUnit(
  state: PlanetState,
  row: number,
  tick: number,
  faceQ?: number,
  faceR?: number,
  data?: CompiledDataLike,
): void {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  clearEvasiveState(state, entityId, tick);
  cancelMove(state, entityId, tick);

  const book = new UnitBook(state);
  const uRec = book.peek(entityId);
  if (uRec?.current) {
    uRec.current = null;
    uRec.queue = [];
    book.touch();
    book.flush(tick);
  }

  const q = cols.q[row]!;
  const r = cols.r[row]!;
  if (cols.state[row] !== ENTITY_STATE.idle) {
    setField(state.entities, row, 'state', ENTITY_STATE.idle, tick);
  }
  if (cols.targetQ[row] !== q || cols.targetR[row] !== r) {
    setField(state.entities, row, 'targetQ', q, tick);
    setField(state.entities, row, 'targetR', r, tick);
  }
  if (faceQ !== undefined && faceR !== undefined) {
    faceTowards(state, row, faceQ, faceR, tick);
  }
  if (data) notifyUnitChanged(state, row, tick, data);
}

export function orderCombatUnitMove(
  state: PlanetState,
  row: number,
  goal: MoveGoal,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const distToGoal = hexDistance(ax, ay, goal.q, goal.r);
  if (
    cols.q[row] === goal.q &&
    cols.r[row] === goal.r &&
    goal.minDist === 0 &&
    distToGoal <= 1e-3
  ) {
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
    return;
  }

  const book = new UnitBook(state);
  const rec = book.get(entityId);
  const cur = rec.current;
  const motion = getMotion(state, entityId);
  const alreadyMovingToGoal =
    cur?.kind === 'move' &&
    cur.q === goal.q &&
    cur.r === goal.r &&
    (cur.minDist ?? 0) === goal.minDist &&
    (cur.maxDist ?? 0) === goal.maxDist &&
    motion !== null &&
    sameGoal(motion.goal, goal) &&
    motion.status !== 'failed';

  if (alreadyMovingToGoal) return;

  issueUnitCommand(
    state,
    row,
    { kind: 'move', source: 'auto', q: goal.q, r: goal.r, minDist: goal.minDist, maxDist: goal.maxDist },
    ctx,
  );
  requestMove(state, row, goal, ctx);
  setField(state.entities, row, 'state', ENTITY_STATE.moving, ctx.tick);
  setField(state.entities, row, 'targetQ', goal.q, ctx.tick);
  setField(state.entities, row, 'targetR', goal.r, ctx.tick);
  notifyUnitChanged(state, row, ctx.tick, ctx.data);
}

function provokeFaunaIfPassive(state: PlanetState, targetId: number, tick: number): void {
  const modeBlob = state.blobs.faunaMode?.value as
    | { byEntityId?: Record<number, unknown> }
    | undefined;
  const entry = modeBlob?.byEntityId?.[targetId];
  if (entry === 'passive') {
    setBlob(
      state,
      'faunaMode',
      { byEntityId: { ...modeBlob!.byEntityId, [targetId]: 'aggressive' } },
      tick,
    );
  } else if (entry && typeof entry === 'object' && (entry as { mode?: string }).mode === 'passive') {
    setBlob(
      state,
      'faunaMode',
      {
        byEntityId: {
          ...modeBlob!.byEntityId,
          [targetId]: { ...(entry as Record<string, unknown>), mode: 'aggressive' },
        },
      },
      tick,
    );
  }
}

export function tryFireUnitWeapon(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  ctx: StepContext,
): boolean {
  const cooldown = weaponCooldownTicks(weaponRow);
  if (rec.lastFiredTick !== undefined && ctx.tick - rec.lastFiredTick < cooldown) {
    return false;
  }
  const targetId = state.entities.cols.id[targetRow]!;
  if (rec.explicitTargetId === targetId) {
    provokeFaunaIfPassive(state, targetId, ctx.tick);
  }
  fireWeaponAtTarget(state, attackerRow, targetRow, weaponRow, ctx);
  rec.lastFiredTick = ctx.tick;
  return true;
}

export function engageTargetInRangeOrApproach(
  state: PlanetState,
  row: number,
  targetRow: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  ctx: StepContext,
  opts?: { allowEvasive?: boolean; maxLeashFromAnchor?: number },
): void {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const targetId = cols.id[targetRow]!;
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const [tx, ty] = getUnitContinuousCoords(cols, targetRow);
  const dist = hexDistance(ax, ay, tx, ty);
  const minRange = Math.max(0, Number(weaponRow.minRange ?? 0));
  const maxRange = Math.max(1, Number(weaponRow.range ?? 4));

  rec.targetId = targetId;

  if (dist < minRange - 1e-5) {
    const backoff = pickMinRangeBackoffNeighbor(state, row, targetRow);
    if (backoff) {
      orderCombatUnitMove(state, row, { q: backoff[0], r: backoff[1], minDist: 0, maxDist: 0 }, ctx);
    }
    return;
  }

  if (dist <= maxRange + 1e-5) {
    tryFireUnitWeapon(state, row, targetRow, weaponRow, rec, ctx);
    if (opts?.allowEvasive !== false && isUnitEvasive(cols.kind[row]!, ctx.data)) {
      const book = new UnitBook(state);
      const uRec = book.peek(entityId);
      if (uRec?.current) {
        uRec.current = null;
        book.touch();
        book.flush(ctx.tick);
      }
      stepEvasiveUnit(state, row, targetId, ctx, maxRange);
      if (opts?.maxLeashFromAnchor !== undefined) {
        const ev = getEvasiveState(state, entityId);
        if (ev && hexDistance(ev.headingQ, ev.headingR, rec.anchorQ, rec.anchorR) > opts.maxLeashFromAnchor) {
          orderCombatUnitMove(state, row, { q: rec.anchorQ, r: rec.anchorR, minDist: 0, maxDist: 0 }, ctx);
        }
      }
    } else {
      haltCombatUnit(state, row, ctx.tick, cols.q[targetRow]!, cols.r[targetRow]!, ctx.data);
    }
    return;
  }

  clearEvasiveState(state, entityId, ctx.tick);
  const tileDist = hexDistance(cols.q[row]!, cols.r[row]!, cols.q[targetRow]!, cols.r[targetRow]!);
  const minBand = Math.ceil(minRange);
  const maxBand =
    tileDist <= Math.floor(maxRange)
      ? Math.max(minBand, Math.floor(maxRange) - 1)
      : Math.max(minBand, Math.floor(maxRange));
  orderCombatUnitMove(
    state,
    row,
    { q: cols.q[targetRow]!, r: cols.r[targetRow]!, minDist: minBand, maxDist: maxBand },
    ctx,
  );
}

export function findLeashChaseTile(
  state: PlanetState,
  unitRow: number,
  anchorQ: number,
  anchorR: number,
  targetQ: number,
  targetR: number,
  leashRadius: number,
  data?: CompiledDataLike,
): { q: number; r: number } {
  const cols = state.entities.cols;
  const idx = hexIndex(state.grid.radius);
  const here = idx.indexOf(cols.q[unitRow]!, cols.r[unitRow]!);
  const profile = (data ? mobileStats(cols.kind[unitRow]!, data)?.profile : undefined) ?? 'hover';
  const blockers = pathBlockersFor(state, profile, here, data);

  let bestQ = anchorQ;
  let bestR = anchorR;
  let bestDistToTarget = Infinity;
  let bestDistFromAnchor = -1;
  let bestAxisDiff = Infinity;

  const rMax = Math.floor(leashRadius);
  for (let dr = -rMax; dr <= rMax; dr++) {
    const dqMin = Math.max(-rMax, -dr - rMax);
    const dqMax = Math.min(rMax, -dr + rMax);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      const cq = anchorQ + dq;
      const cr = anchorR + dr;
      const tileIdx = idx.indexOf(cq, cr);
      if (tileIdx < 0) continue;
      if (profile !== 'hover' && !isGroundPassable(state.grid, tileIdx, data)) continue;
      if (blockers?.goalBlocked(tileIdx)) continue;

      const dTarget = hexDistance(cq, cr, targetQ, targetR);
      const dAnchor = hexDistance(anchorQ, anchorR, cq, cr);
      const axisDiff = Math.abs(cq - targetQ) + Math.abs(cr - targetR);
      if (
        dTarget < bestDistToTarget - 1e-5 ||
        (Math.abs(dTarget - bestDistToTarget) <= 1e-5 &&
          (dAnchor > bestDistFromAnchor ||
            (dAnchor === bestDistFromAnchor && axisDiff < bestAxisDiff)))
      ) {
        bestDistToTarget = dTarget;
        bestDistFromAnchor = dAnchor;
        bestAxisDiff = axisDiff;
        bestQ = cq;
        bestR = cr;
      }
    }
  }
  return { q: bestQ, r: bestR };
}

export function findClosestHostileInAnchorLeash(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  leashRadius: number,
  ctx: StepContext,
): number {
  const cols = state.entities.cols;
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const minRange = Math.max(0, Number(weaponRow.minRange ?? 0));
  let bestRow = -1;
  let bestDist = Infinity;
  let bestId = Infinity;

  for (let r = 0; r < state.entities.count; r++) {
    if (r === row) continue;
    if (!isHostileTargetForAttacker(state, row, r, { includePassiveFauna: false })) continue;
    if (!canWeaponHitTarget(state, weaponRow, r, ctx.data)) continue;
    const [tx, ty] = getUnitContinuousCoords(cols, r);
    const dAnchor = hexDistance(rec.anchorQ, rec.anchorR, tx, ty);
    if (dAnchor > leashRadius + 1e-5) continue;
    const dUnit = hexDistance(ax, ay, tx, ty);
    if (dUnit < minRange - 1e-5) continue;
    const id = cols.id[r]!;
    if (dUnit < bestDist - 1e-5 || (Math.abs(dUnit - bestDist) <= 1e-5 && id < bestId)) {
      bestDist = dUnit;
      bestId = id;
      bestRow = r;
    }
  }
  return bestRow;
}

export function stepAttackMoveGoal(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  leashRadius: number,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const weaponRange = Math.max(1, Number(weaponRow.range ?? 4));
  const goal = rec.attackMoveGoal!;

  const tRow = acquireClosestTargetInRange(state, row, {
    weaponRow,
    minRange: 0,
    maxRange: Math.max(weaponRange, leashRadius),
    requireSpotting: false,
    includePassiveFauna: false,
    stickyTargetId: rec.targetId ?? undefined,
    data: ctx.data,
  });
  if (tRow >= 0) {
    engageTargetInRangeOrApproach(state, row, tRow, weaponRow, rec, ctx, { allowEvasive: true });
    return;
  }

  rec.targetId = null;
  clearEvasiveState(state, entityId, ctx.tick);
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const atGoal =
    cols.q[row] === goal.q &&
    cols.r[row] === goal.r &&
    hexDistance(ax, ay, goal.q, goal.r) <= 1e-3;
  const motion = getMotion(state, entityId);
  if (atGoal || motion?.status === 'failed') {
    rec.anchorQ = cols.q[row]!;
    rec.anchorR = cols.r[row]!;
    rec.attackMoveGoal = null;
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
  } else {
    orderCombatUnitMove(state, row, { q: goal.q, r: goal.r, minDist: 0, maxDist: 0 }, ctx);
  }
}
