import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { faceTowards } from '../../units/movement/locomotion';
import { clearEvasiveState } from './evasive';
import { canWeaponHitTarget } from './layers';
import {
  engageTargetInRangeOrApproach,
  findClosestHostileInAnchorLeash,
  findLeashChaseTile,
  getUnitContinuousCoords,
  haltCombatUnit,
  mirrorUnitStanceToView,
  orderCombatUnitMove,
  readStancesBlob,
  resolveAttackMoveGoalBand,
  stepAttackMoveGoal,
  tryFireUnitWeapon,
  writeStancesBlob,
} from './stanceHelpers';
import {
  acquireClosestTargetInRange,
  isHostileTargetForAttacker,
  resolveAttackerWeaponRow,
} from './targeting';
import { stepCombatTurrets } from './turrets';

export type CombatStance = 'hold' | 'defend' | 'hunt';

export const COMBAT_STANCES_BLOB = 'combatStances';
export const DEFAULT_DEFEND_LEASH_RADIUS = 8;
export const DEFAULT_HUNT_SEARCH_RADIUS = 15;

export interface UnitStanceRecord {
  entityId: number;
  stance: CombatStance;
  anchorQ: number;
  anchorR: number;
  targetId?: number | null;
  attackMoveGoal?: { q: number; r: number } | null;
  explicitTargetId?: number | null;
  lastFiredTick?: number;
  returningToAnchor?: boolean;
}

export interface CombatStancesBlob {
  byEntityId: Record<number, UnitStanceRecord>;
}

function getCombatConfigRow(data?: CompiledDataLike): CompiledRow | undefined {
  const table = data?.tables?.combatUnits as Record<string, CompiledRow | undefined> | undefined;
  return table?.combatConfig;
}

/** Returns the Defend stance leash radius in hex tiles (`combatUnits.combatConfig.defendLeashRadius ?? 8`). */
export function getDefendLeashRadius(data?: CompiledDataLike): number {
  const raw = Number(getCombatConfigRow(data)?.defendLeashRadius ?? DEFAULT_DEFEND_LEASH_RADIUS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEFEND_LEASH_RADIUS;
}

/** Returns the Hunt stance search radius in hex tiles (`combatUnits.combatConfig.huntSearchRadius ?? 15`). */
export function getHuntSearchRadius(data?: CompiledDataLike): number {
  const raw = Number(getCombatConfigRow(data)?.huntSearchRadius ?? DEFAULT_HUNT_SEARCH_RADIUS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HUNT_SEARCH_RADIUS;
}

/**
 * Returns the active combat stance (`'hold' | 'defend' | 'hunt'`) for `entityId` (defaults to `'defend'`).
 */
export function getUnitStance(state: PlanetState, entityId: number): CombatStance {
  const rec = readStancesBlob(state)[entityId];
  return rec?.stance ?? 'defend';
}

/**
 * Returns the `UnitStanceRecord` for entity `row` (or `entityId` if `row` is an entity ID).
 */
export function getUnitStanceRecord(state: PlanetState, row: number): UnitStanceRecord {
  const cols = state.entities.cols;
  const byEntityId = readStancesBlob(state);
  const resolvedRow =
    row >= 0 && row < state.entities.count ? row : rowOf(state.entities, row);
  if (resolvedRow >= 0) {
    const entityId = cols.id[resolvedRow]!;
    const existing = byEntityId[entityId];
    if (existing) return existing;
    return {
      entityId,
      stance: 'defend',
      anchorQ: cols.q[resolvedRow]!,
      anchorR: cols.r[resolvedRow]!,
      targetId: null,
      attackMoveGoal: null,
      explicitTargetId: null,
    };
  }
  return (
    byEntityId[row] ?? {
      entityId: row,
      stance: 'defend',
      anchorQ: 0,
      anchorR: 0,
      targetId: null,
      attackMoveGoal: null,
      explicitTargetId: null,
    }
  );
}

/**
 * Sets the combat stance and anchor for `entityId` in `state.blobs.combatStances` (`UO-C-09`, `W07-12`).
 */
export function setUnitStance(
  state: PlanetState,
  entityId: number,
  stance: CombatStance,
  anchor?: { q: number; r: number },
  tick = state.meta.tick,
): boolean {
  if (stance !== 'hold' && stance !== 'defend' && stance !== 'hunt') return false;
  const row = rowOf(state.entities, entityId);
  if (row < 0 || state.entities.cols.hp[row]! <= 0) return false;

  const cols = state.entities.cols;
  const byEntityId = readStancesBlob(state);
  const prev = byEntityId[entityId];
  const anchorQ = anchor?.q ?? cols.q[row]!;
  const anchorR = anchor?.r ?? cols.r[row]!;

  byEntityId[entityId] = {
    entityId,
    stance,
    anchorQ,
    anchorR,
    targetId: null,
    attackMoveGoal: null,
    explicitTargetId: null,
    lastFiredTick: prev?.lastFiredTick,
    returningToAnchor: false,
  };
  writeStancesBlob(state, byEntityId, tick);

  if (stance === 'hold') {
    haltCombatUnit(state, row, tick);
  }
  mirrorUnitStanceToView(state, row, stance, tick);
  return true;
}

function stepDefendStance(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  leashRadius: number,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const [ax, ay] = getUnitContinuousCoords(cols, row);
  const unitDistFromAnchor = hexDistance(ax, ay, rec.anchorQ, rec.anchorR);
  const minRange = Math.max(0, Number(weaponRow.minRange ?? 0));
  const weaponRange = Math.max(1, Number(weaponRow.range ?? 4));

  if (unitDistFromAnchor > leashRadius + 1e-4) {
    rec.targetId = null;
    rec.returningToAnchor = true;
    clearEvasiveState(state, cols.id[row]!, ctx.tick);
    orderCombatUnitMove(state, row, { q: rec.anchorQ, r: rec.anchorR, minDist: 0, maxDist: 0 }, ctx);
    return;
  }

  let targetRow = -1;
  if (rec.targetId && !rec.returningToAnchor) {
    const tRow = rowOf(state.entities, rec.targetId);
    if (
      tRow >= 0 &&
      isHostileTargetForAttacker(state, row, tRow, { includePassiveFauna: false }) &&
      canWeaponHitTarget(state, weaponRow, tRow, ctx.data)
    ) {
      targetRow = tRow;
    }
  }

  if (targetRow < 0) {
    targetRow = findClosestHostileInAnchorLeash(state, row, weaponRow, rec, leashRadius, ctx);
    if (targetRow >= 0) rec.returningToAnchor = false;
  }

  if (targetRow >= 0) {
    const [tx, ty] = getUnitContinuousCoords(cols, targetRow);
    const targetDistFromAnchor = hexDistance(rec.anchorQ, rec.anchorR, tx, ty);
    if (targetDistFromAnchor > leashRadius + 1e-5) {
      if (unitDistFromAnchor >= leashRadius - 1e-4) {
        rec.targetId = null;
        rec.returningToAnchor = true;
        clearEvasiveState(state, cols.id[row]!, ctx.tick);
        orderCombatUnitMove(state, row, { q: rec.anchorQ, r: rec.anchorR, minDist: 0, maxDist: 0 }, ctx);
        return;
      }
      const leashTile = findLeashChaseTile(
        state, row, rec.anchorQ, rec.anchorR, cols.q[targetRow]!, cols.r[targetRow]!, leashRadius, ctx.data,
      );
      const distToTarget = hexDistance(ax, ay, tx, ty);
      if (distToTarget >= minRange - 1e-5 && distToTarget <= weaponRange + 1e-5) {
        tryFireUnitWeapon(state, row, targetRow, weaponRow, rec, ctx);
      }
      clearEvasiveState(state, cols.id[row]!, ctx.tick);
      orderCombatUnitMove(state, row, { q: leashTile.q, r: leashTile.r, minDist: 0, maxDist: 0 }, ctx);
      return;
    }

    engageTargetInRangeOrApproach(state, row, targetRow, weaponRow, rec, ctx, {
      allowEvasive: true,
      maxLeashFromAnchor: leashRadius,
    });
    return;
  }

  rec.targetId = null;
  clearEvasiveState(state, cols.id[row]!, ctx.tick);
  if (cols.q[row] !== rec.anchorQ || cols.r[row] !== rec.anchorR || unitDistFromAnchor > 1e-3) {
    rec.returningToAnchor = true;
    orderCombatUnitMove(state, row, { q: rec.anchorQ, r: rec.anchorR, minDist: 0, maxDist: 0 }, ctx);
  } else if (rec.returningToAnchor || cols.state[row] === ENTITY_STATE.moving) {
    rec.returningToAnchor = false;
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
  }
}

function stepHoldStance(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const minRange = Math.max(0, Number(weaponRow.minRange ?? 0));
  const weaponRange = Math.max(1, Number(weaponRow.range ?? 4));
  rec.anchorQ = cols.q[row]!;
  rec.anchorR = cols.r[row]!;
  if (cols.state[row] === ENTITY_STATE.moving) {
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
  } else {
    clearEvasiveState(state, entityId, ctx.tick);
  }
  const tRow = acquireClosestTargetInRange(state, row, {
    weaponRow,
    minRange,
    maxRange: weaponRange,
    requireSpotting: true,
    includePassiveFauna: false,
    stickyTargetId: rec.targetId ?? undefined,
    data: ctx.data,
  });
  if (tRow >= 0) {
    rec.targetId = cols.id[tRow]!;
    faceTowards(state, row, cols.q[tRow]!, cols.r[tRow]!, ctx.tick);
    tryFireUnitWeapon(state, row, tRow, weaponRow, rec, ctx);
  } else {
    rec.targetId = null;
  }
}

function stepHuntStance(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  huntRadius: number,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const tRow = acquireClosestTargetInRange(state, row, {
    weaponRow,
    minRange: 0,
    maxRange: huntRadius,
    requireSpotting: false,
    includePassiveFauna: false,
    stickyTargetId: rec.targetId ?? undefined,
    data: ctx.data,
  });
  if (tRow >= 0) {
    engageTargetInRangeOrApproach(state, row, tRow, weaponRow, rec, ctx, { allowEvasive: true });
    return;
  }
  if (rec.targetId !== null && rec.targetId !== undefined) {
    rec.targetId = null;
    rec.anchorQ = cols.q[row]!;
    rec.anchorR = cols.r[row]!;
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
  }
}

function stepSingleCombatUnit(
  state: PlanetState,
  row: number,
  weaponRow: Record<string, unknown>,
  rec: UnitStanceRecord,
  leashRadius: number,
  huntRadius: number,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;

  const book = new UnitBook(state);
  const uRec = book.peek(entityId);
  if (uRec?.current?.kind === 'attack' && !rec.explicitTargetId) {
    rec.explicitTargetId = uRec.current.targetId;
  }
  if (
    uRec?.current?.kind === 'move' &&
    uRec.current.source === 'player' &&
    !rec.attackMoveGoal &&
    !rec.explicitTargetId
  ) {
    rec.anchorQ = uRec.current.q;
    rec.anchorR = uRec.current.r;
    rec.returningToAnchor = false;
    return;
  }

  if (rec.explicitTargetId) {
    const tRow = rowOf(state.entities, rec.explicitTargetId);
    if (
      tRow >= 0 &&
      isHostileTargetForAttacker(state, row, tRow, { includePassiveFauna: true }) &&
      canWeaponHitTarget(state, weaponRow, tRow, ctx.data)
    ) {
      engageTargetInRangeOrApproach(state, row, tRow, weaponRow, rec, ctx, { allowEvasive: true });
      return;
    }
    rec.explicitTargetId = null;
    rec.targetId = null;
    haltCombatUnit(state, row, ctx.tick, undefined, undefined, ctx.data);
  }

  if (rec.attackMoveGoal) {
    stepAttackMoveGoal(state, row, weaponRow, rec, leashRadius, ctx);
    return;
  }
  if (rec.stance === 'hold') {
    stepHoldStance(state, row, weaponRow, rec, ctx);
    return;
  }
  if (rec.stance === 'hunt') {
    stepHuntStance(state, row, weaponRow, rec, huntRadius, ctx);
    return;
  }
  stepDefendStance(state, row, weaponRow, rec, leashRadius, ctx);
}

/**
 * Orders unit `entityId` to `attackMove` toward `(goal.q, goal.r)`, engaging hostiles along the way.
 */
export function orderUnitAttackMove(
  state: PlanetState,
  entityId: number,
  goal: { q: number; r: number },
  ctx: StepContext,
): boolean {
  const row = rowOf(state.entities, entityId);
  if (row < 0 || state.entities.cols.hp[row]! <= 0) return false;
  const byEntityId = readStancesBlob(state);
  const prev = getUnitStanceRecord(state, row);
  byEntityId[entityId] = {
    ...prev,
    attackMoveGoal: { q: goal.q, r: goal.r },
    explicitTargetId: null,
    targetId: null,
    returningToAnchor: false,
  };
  writeStancesBlob(state, byEntityId, ctx.tick);
  orderCombatUnitMove(state, row, resolveAttackMoveGoalBand(state, row, goal, ctx.data), ctx);
  return true;
}

/**
 * Orders unit `entityId` to explicitly pursue and attack `targetId` (even if passive fauna/hive).
 */
export function orderUnitAttackTarget(
  state: PlanetState,
  entityId: number,
  targetId: number,
  ctx: StepContext,
): boolean {
  const row = rowOf(state.entities, entityId);
  const tRow = rowOf(state.entities, targetId);
  if (row < 0 || tRow < 0 || state.entities.cols.hp[row]! <= 0 || state.entities.cols.hp[tRow]! <= 0) {
    return false;
  }
  const weaponRow = resolveAttackerWeaponRow(state, row, ctx.data);
  if (!weaponRow || !canWeaponHitTarget(state, weaponRow, tRow, ctx.data)) return false;

  const byEntityId = readStancesBlob(state);
  const prev = getUnitStanceRecord(state, row);
  const rec: UnitStanceRecord = {
    ...prev,
    explicitTargetId: targetId,
    targetId,
    attackMoveGoal: null,
    returningToAnchor: false,
  };
  byEntityId[entityId] = rec;
  writeStancesBlob(state, byEntityId, ctx.tick);
  engageTargetInRangeOrApproach(state, row, tRow, weaponRow, rec, ctx, { allowEvasive: true });
  writeStancesBlob(state, { ...readStancesBlob(state), [entityId]: rec }, ctx.tick);
  return true;
}

/**
 * Steps all combat unit stances (`hold`, `defend`, `hunt`, `attackMove`, `attackTarget`) in the combat slot.
 */
export function stepCombatStances(state: PlanetState, ctx: StepContext): void {
  const cols = state.entities.cols;
  const byEntityId = readStancesBlob(state);
  const leashRadius = getDefendLeashRadius(ctx.data);
  const huntRadius = getHuntSearchRadius(ctx.data);

  const unitIds: number[] = [];
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0) continue;
    const s = cols.state[row]!;
    if (s === ENTITY_STATE.descending || s === ENTITY_STATE.inert || s === ENTITY_STATE.constructing) continue;
    const kind = cols.kind[row]!;
    const id = cols.id[row]!;
    if (cols.owner[row]! < 0 && !(id in byEntityId)) continue;
    if (kind === ENTITY_KIND.hq && !(id in byEntityId)) continue;
    if (kind === ENTITY_KIND.autocannon || kind === ENTITY_KIND.laserTower) continue;
    if (kind === ENTITY_KIND.recon || id in byEntityId || resolveAttackerWeaponRow(state, row, ctx.data)) {
      unitIds.push(id);
    }
  }

  for (const id of unitIds) {
    const row = rowOf(state.entities, id);
    if (row < 0 || cols.hp[row]! <= 0) continue;
    const weaponRow = resolveAttackerWeaponRow(state, row, ctx.data);
    if (!weaponRow) continue;

    const rec: UnitStanceRecord = byEntityId[id] ?? {
      entityId: id,
      stance: 'defend',
      anchorQ: cols.q[row]!,
      anchorR: cols.r[row]!,
      targetId: null,
      attackMoveGoal: null,
      explicitTargetId: null,
      returningToAnchor: false,
    };
    byEntityId[id] = rec;
    stepSingleCombatUnit(state, row, weaponRow, rec, leashRadius, huntRadius, ctx);
    mirrorUnitStanceToView(state, row, rec.stance, ctx.tick);
  }

  for (const idStr of Object.keys(byEntityId)) {
    const id = Number(idStr);
    if (rowOf(state.entities, id) < 0) {
      delete byEntityId[id];
    }
  }
  writeStancesBlob(state, byEntityId, ctx.tick);
}

/**
 * Steps both combat unit stances and stationary defense turrets / HQ auto-turrets in the combat slot (`slot: 10`).
 */
export function stepCombatStancesAndTurrets(state: PlanetState, ctx: StepContext): void {
  stepCombatStances(state, ctx);
  stepCombatTurrets(state, ctx);
}
