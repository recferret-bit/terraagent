import { combatApproachBand, footprintAttackRange } from './approachBand';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { notifyUnitChanged } from '../../units/mobility';
import { faceTowards } from '../../units/movement/locomotion';
import { cancelMove, getMotion, requestMove, type MoveGoal } from '../../units/movement/orchestrator';
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
  findClosestHostileInAnchorLeash,
  findLeashChaseTile,
  getUnitContinuousCoords,
  mirrorUnitStanceToView,
  readStancesBlob,
  resolveAttackMoveGoalBand,
  writeStancesBlob,
} from './parts/stanceParts';

export {
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

export function tryFireUnitWeapon(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  ctx: StepContext,
): boolean {
  const owner = state.entities.cols.owner[attackerRow];
  if (owner >= 0 && !isTargetSpottedByColony(state, owner, targetRow, ctx.data)) return false;
  if (!consumeWeaponShot(rec, weaponRow, ctx.tick)) {
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
    const backoff = pickMinRangeBackoffNeighbor(state, row, targetRow);
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
    } else {
      haltCombatUnit(state, row, ctx.tick, cols.q[targetRow]!, cols.r[targetRow]!, ctx.data);
    }
    return;
  }

  clearEvasiveState(state, entityId, ctx.tick);
  const tileDist = hexDistance(cols.q[row]!, cols.r[row]!, cols.q[targetRow]!, cols.r[targetRow]!);
  const band = combatApproachBand(effectiveMaxRange, minRange, tileDist, hexDistance(tx, ty, cols.q[targetRow], cols.r[targetRow]));
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
  clearEvasiveState(state, entityId, ctx.tick);
  const moveGoal = resolveAttackMoveGoalBand(state, row, goal, ctx.data);
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const atGoal =
    hexDistance(ax, ay, goal.q, goal.r) <= moveGoal.maxDist + 1e-3 &&
    hexDistance(cols.q[row]!, cols.r[row]!, goal.q, goal.r) <= moveGoal.maxDist;
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
