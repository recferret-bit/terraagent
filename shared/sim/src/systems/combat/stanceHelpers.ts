import { combatApproachBand, footprintAttackRange } from './approachBand';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { OCCUPYING_BUILDING_KINDS } from '../construction/placement';
import { setField } from '../../ecs/store';
import { hexDistance, hexIndex, inHex } from '../../grid/hex';
import { pathBlockersFor } from '../../grid/pathProfiles';
import { isGroundPassable, isTileExplored } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { isUnitKind, movementProfile, notifyUnitChanged } from '../../units/mobility';
import { faceTowards } from '../../units/movement/locomotion';
import { cancelMove, getMotion, requestMove, type MoveGoal } from '../../units/movement/orchestrator';
import { ringCoords } from '../../units/movement/slots';
import { findNearestFreeStandTile, isHexStationaryOccupied } from '../../units/movement/unitOccupancy';
import { issueUnitCommand } from '../units/registry';
import { clearEvasiveState, getEvasiveState, isUnitEvasive, stepEvasiveUnit } from './evasive';
import { isTargetSpottedByColony } from './vision';
import type { UnitStanceRecord } from './stances';
import {
  acquireClosestTargetInRange,
  pickMinRangeBackoffNeighbor,
} from './targeting';
import { consumeWeaponShot, fireWeaponAtTarget } from './weaponFire';
import {
  canUnitMoveAndFire,
  findClosestHostileInAnchorLeash,
  findLeashChaseTile,
  getUnitContinuousCoords,
  mirrorUnitStanceToView,
  readStancesBlob,
  resolveAttackMoveGoalBand,
  writeStancesBlob,
} from './parts/stanceParts';

export {
  canUnitMoveAndFire,
  findClosestHostileInAnchorLeash,
  findLeashChaseTile,
  getUnitContinuousCoords,
  mirrorUnitStanceToView,
  readStancesBlob,
  resolveAttackMoveGoalBand,
  writeStancesBlob,
};

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
    const stamp = uRec.current.source !== 'auto';
    uRec.current = null;
    uRec.queue = [];
    book.touch(stamp);
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
  const goalDrift = cur?.kind === 'move' ? hexDistance(cur.q, cur.r, goal.q, goal.r) : Infinity;
  const allowedDrift = distToGoal > 4 ? 2 : 0;
  const alreadyMovingToGoal =
    cur?.kind === 'move' &&
    goalDrift <= allowedDrift &&
    (cur.minDist ?? 0) === goal.minDist &&
    (cur.maxDist ?? 0) === goal.maxDist &&
    (motion === null || motion.status !== 'failed');

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

function isCombatTestWorld(state: PlanetState): boolean {
  return (state.blobs.combatTest?.value as { enabled?: boolean } | undefined)?.enabled === true;
}

/**
 * True while `attackerRow` is allowed to continue pursuing/engaging an explicit `attackTarget` order:
 * always true for fauna, when spotted by colony vision, in combat-test sandbox, or for explored structures.
 */
export function canMaintainExplicitTargetPursuit(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  data?: CompiledDataLike,
): boolean {
  const cols = state.entities.cols;
  const attackerOwner = cols.owner[attackerRow]!;
  if (attackerOwner < 0) return true;
  if (isTargetSpottedByColony(state, attackerOwner, targetRow, data)) return true;
  if (isCombatTestWorld(state)) return true;
  if (OCCUPYING_BUILDING_KINDS.has(cols.kind[targetRow]!)) {
    const tileIdx = hexIndex(state.grid.radius).indexOf(cols.q[targetRow]!, cols.r[targetRow]!);
    if (tileIdx >= 0 && isTileExplored(state.grid, tileIdx, attackerOwner)) return true;
  }
  return false;
}

export function tryFireUnitWeapon(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  ctx: StepContext,
): boolean {
  const owner = state.entities.cols.owner[attackerRow]!;
  const targetId = state.entities.cols.id[targetRow]!;
  const allowCombatTestFire =
    isCombatTestWorld(state) &&
    (rec.explicitTargetId === targetId || canUnitMoveAndFire(state.entities.cols.kind[attackerRow]!, ctx.data));
  if (owner >= 0 && !allowCombatTestFire && !isTargetSpottedByColony(state, owner, targetRow, ctx.data)) {
    return false;
  }
  if (!consumeWeaponShot(rec, weaponRow, ctx.tick)) {
    return false;
  }
  if (rec.explicitTargetId === targetId) {
    provokeFaunaIfPassive(state, targetId, ctx.tick);
  }
  fireWeaponAtTarget(state, attackerRow, targetRow, weaponRow, ctx);
  rec.lastFiredTick = ctx.tick;
  return true;
}

function pickFreeInRangeStandTile(
  state: PlanetState,
  row: number,
  targetRow: number,
  minRange: number,
  maxRange: number,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const curQ = cols.q[row]!;
  const curR = cols.r[row]!;
  const [tx, ty] = getUnitContinuousCoords(cols, targetRow);
  const profile = data ? movementProfile(cols.kind[row]!, data) : 'ground';
  const idx = hexIndex(state.grid.radius);
  const fromIdx = idx.indexOf(curQ, curR);
  const blockers = pathBlockersFor(state, profile, fromIdx, data, entityId);
  for (let ring = 1; ring <= 3; ring++) {
    for (const [q, r] of ringCoords(curQ, curR, ring)) {
      if (!inHex(q, r, state.grid.radius)) continue;
      const ti = idx.indexOf(q, r);
      if (ti < 0) continue;
      if (profile !== 'hover' && !isGroundPassable(state.grid, ti, data)) continue;
      if (blockers?.goalBlocked(ti)) continue;
      const d = hexDistance(q, r, tx, ty);
      if (d >= minRange - 1e-5 && d <= maxRange + 1e-5) return { q, r };
    }
  }
  return findNearestFreeStandTile(state, curQ, curR, profile, entityId, data, 2);
}

function tryPursueMovingTargetWhileFiring(
  state: PlanetState,
  row: number,
  targetRow: number,
  dist: number,
  minRange: number,
  effectiveMaxRange: number,
  rec: UnitStanceRecord,
  maxLeashFromAnchor: number | undefined,
  ctx: StepContext,
): boolean {
  const cols = state.entities.cols;
  if (!canUnitMoveAndFire(cols.kind[row]!, ctx.data) || isUnitEvasive(cols.kind[row]!, ctx.data)) {
    return false;
  }
  const targetMoving =
    cols.state[targetRow] === ENTITY_STATE.moving ||
    hexDistance(cols.x[targetRow]!, cols.y[targetRow]!, cols.targetQ[targetRow]!, cols.targetR[targetRow]!) > 0.15;
  if (!targetMoving || dist <= Math.max(minRange + 1, 1.8)) return false;
  if (rec.explicitTargetId === null && rec.stance === 'defend') {
    const [ax, ay] = getUnitContinuousCoords(cols, row);
    const targetGoalDist = hexDistance(ax, ay, cols.targetQ[targetRow]!, cols.targetR[targetRow]!);
    if (targetGoalDist <= dist + 0.5) return false;
  }

  const tq = cols.q[targetRow]!;
  const tr = cols.r[targetRow]!;
  const chaseGoal =
    maxLeashFromAnchor !== undefined && hexDistance(rec.anchorQ, rec.anchorR, tq, tr) > maxLeashFromAnchor + 1e-5
      ? findLeashChaseTile(state, row, rec.anchorQ, rec.anchorR, tq, tr, maxLeashFromAnchor, ctx.data)
      : { q: tq, r: tr };
  orderCombatUnitMove(
    state,
    row,
    {
      q: chaseGoal.q,
      r: chaseGoal.r,
      minDist: Math.max(1, Math.ceil(minRange)),
      maxDist: Math.max(1, Math.min(2, Math.floor(effectiveMaxRange - 1))),
    },
    ctx,
  );
  return true;
}

/** Handles combat targeting during an active player `move` order (move-and-fire units keep driving and shoot in range). */
export function stepPlayerMoveUnitCombat(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  moveCmd: { q: number; r: number },
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const motion = getMotion(state, cols.id[row]!);
  rec.anchorQ = motion?.reseated ? motion.goal.q : moveCmd.q;
  rec.anchorR = motion?.reseated ? motion.goal.r : moveCmd.r;
  rec.returningToAnchor = false;
  if (!canUnitMoveAndFire(cols.kind[row]!, ctx.data)) {
    rec.targetId = null;
    return;
  }
  const tRow = acquireClosestTargetInRange(state, row, {
    weaponRow,
    minRange: Math.max(0, Number(weaponRow.minRange ?? 0)),
    maxRange: Math.max(1, Number(weaponRow.range ?? 4)),
    requireSpotting: !isCombatTestWorld(state),
    includePassiveFauna: false,
    stickyTargetId: rec.targetId ?? undefined,
    data: ctx.data,
  });
  if (tRow >= 0) {
    rec.targetId = cols.id[tRow]!;
    tryFireUnitWeapon(state, row, tRow, weaponRow, rec, ctx);
  } else {
    rec.targetId = null;
  }
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
  const isForeignSiphonTarget =
    ctx.flags.has('W18') &&
    cols.owner[targetRow]! >= 0 &&
    cols.owner[targetRow]! !== cols.owner[row]! &&
    (cols.kind[targetRow] === ENTITY_KIND.supplyDepot ||
      cols.kind[targetRow] === ENTITY_KIND.commandHub ||
      cols.kind[targetRow] === ENTITY_KIND.hub);
  const minRange = isForeignSiphonTarget ? 0 : Math.max(0, Number(weaponRow.minRange ?? 0));
  const maxRange = isForeignSiphonTarget ? 1 : Math.max(1, Number(weaponRow.range ?? 4));
  const targetFootprintW = Math.max(
    1,
    cols.footprintW[targetRow] || cols.footprintD[targetRow] || 1,
  );
  const effectiveMaxRange = footprintAttackRange(maxRange, targetFootprintW);

  rec.targetId = targetId;

  if (dist < minRange - 1e-5) {
    const backoff = pickMinRangeBackoffNeighbor(state, row, targetRow, ctx.data);
    if (backoff) {
      orderCombatUnitMove(state, row, { q: backoff[0], r: backoff[1], minDist: 0, maxDist: 0 }, ctx);
    }
    return;
  }

  if (dist <= effectiveMaxRange + 1e-5) {
    tryFireUnitWeapon(state, row, targetRow, weaponRow, rec, ctx);
    if (!isForeignSiphonTarget && opts?.allowEvasive !== false && isUnitEvasive(cols.kind[row]!, ctx.data)) {
      const book = new UnitBook(state);
      const uRec = book.peek(entityId);
      if (uRec?.current) {
        const stamp = uRec.current.source !== 'auto';
        uRec.current = null;
        book.touch(stamp);
        book.flush(ctx.tick);
      }
      stepEvasiveUnit(state, row, targetId, ctx, effectiveMaxRange);
      if (opts?.maxLeashFromAnchor !== undefined) {
        const ev = getEvasiveState(state, entityId);
        if (ev && hexDistance(ev.headingQ, ev.headingR, rec.anchorQ, rec.anchorR) > opts.maxLeashFromAnchor) {
          orderCombatUnitMove(state, row, { q: rec.anchorQ, r: rec.anchorR, minDist: 0, maxDist: 0 }, ctx);
        }
      }
    } else if (
      isForeignSiphonTarget ||
      !tryPursueMovingTargetWhileFiring(state, row, targetRow, dist, minRange, effectiveMaxRange, rec, opts?.maxLeashFromAnchor, ctx)
    ) {
      const curQ = cols.q[row]!;
      const curR = cols.r[row]!;
      const curIdx = hexIndex(state.grid.radius).indexOf(curQ, curR);
      const prevMotion = getMotion(state, entityId);
      const wasStationary = !prevMotion || prevMotion.status !== 'following';
      if (isHexStationaryOccupied(state, curIdx, entityId, ctx.data, wasStationary)) {
        const alt = pickFreeInRangeStandTile(state, row, targetRow, minRange, effectiveMaxRange, ctx.data);
        if (alt && (alt.q !== curQ || alt.r !== curR)) {
          orderCombatUnitMove(state, row, { q: alt.q, r: alt.r, minDist: 0, maxDist: 0 }, ctx);
          return;
        }
      }
      const rotateChassisToTarget = !canUnitMoveAndFire(cols.kind[row]!, ctx.data);
      haltCombatUnit(
        state,
        row,
        ctx.tick,
        rotateChassisToTarget ? cols.q[targetRow]! : undefined,
        rotateChassisToTarget ? cols.r[targetRow]! : undefined,
        ctx.data,
      );
    }
    return;
  }

  clearEvasiveState(state, entityId, ctx.tick);
  const tileDist = hexDistance(cols.q[row]!, cols.r[row]!, cols.q[targetRow]!, cols.r[targetRow]!);
  const approachMinRange = isForeignSiphonTarget ? 0 : isUnitKind(cols.kind[targetRow]!) ? Math.max(1, minRange) : minRange;
  const band = combatApproachBand(effectiveMaxRange, approachMinRange, tileDist, hexDistance(tx, ty, cols.q[targetRow], cols.r[targetRow]));
  orderCombatUnitMove(
    state,
    row,
    { q: cols.q[targetRow]!, r: cols.r[targetRow]!, ...band },
    ctx,
  );
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
  const moveAndFire = canUnitMoveAndFire(cols.kind[row]!, ctx.data);

  if (moveAndFire) {
    const inRangeRow = acquireClosestTargetInRange(state, row, {
      weaponRow,
      minRange: Math.max(0, Number(weaponRow.minRange ?? 0)),
      maxRange: weaponRange,
      requireSpotting: !isCombatTestWorld(state),
      includePassiveFauna: false,
      stickyTargetId: rec.targetId ?? undefined,
      data: ctx.data,
    });
    if (inRangeRow >= 0) {
      rec.targetId = cols.id[inRangeRow]!;
      tryFireUnitWeapon(state, row, inRangeRow, weaponRow, rec, ctx);
    } else {
      rec.targetId = null;
    }
  } else {
    const tRow = acquireClosestTargetInRange(state, row, {
      weaponRow,
      minRange: 0,
      maxRange: Math.max(weaponRange, leashRadius),
      requireSpotting: true,
      includePassiveFauna: false,
      stickyTargetId: rec.targetId ?? undefined,
      data: ctx.data,
    });
    if (tRow >= 0) {
      engageTargetInRangeOrApproach(state, row, tRow, weaponRow, rec, ctx, { allowEvasive: true });
      return;
    }
    rec.targetId = null;
  }

  clearEvasiveState(state, entityId, ctx.tick);
  const moveGoal = resolveAttackMoveGoalBand(state, row, goal, ctx.data);
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const curIdx = hexIndex(state.grid.radius).indexOf(cols.q[row]!, cols.r[row]!);
  const atGoal =
    hexDistance(ax, ay, goal.q, goal.r) <= moveGoal.maxDist + 1e-3 &&
    hexDistance(cols.q[row]!, cols.r[row]!, goal.q, goal.r) <= moveGoal.maxDist &&
    !isHexStationaryOccupied(state, curIdx, entityId, ctx.data);
  const motion = getMotion(state, entityId);
  if (atGoal || motion?.status === 'failed') {
    rec.anchorQ = cols.q[row]!;
    rec.anchorR = cols.r[row]!;
    rec.attackMoveGoal = null;
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
  } else {
    orderCombatUnitMove(state, row, moveGoal, ctx);
  }
}
