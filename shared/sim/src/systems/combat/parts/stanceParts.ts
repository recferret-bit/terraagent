import type { Columns } from '../../../ecs/store';
import { ENTITY_KIND } from '../../../ecs/columns';
import { hexDistance, hexIndex } from '../../../grid/hex';
import { pathBlockersFor } from '../../../grid/pathProfiles';
import { isGroundPassable } from '../../../grid/tileModel';
import type { CompiledDataLike } from '../../../kernel/config';
import type { StepContext } from '../../../kernel/context';
import { setBlob, type PlanetState } from '../../../kernel/state';
import { mobileStats, movementProfile } from '../../../units/mobility';
import { getMotion, type MoveGoal } from '../../../units/movement/orchestrator';
import {
  findNearestFreeStandTile,
  isHexClaimedByOtherUnit,
  isHexStationaryOccupied,
} from '../../../units/movement/unitOccupancy';
import { withoutUnitView } from '../../harvest/unit';
import { canWeaponHitTarget } from '../layers';
import { recordStanceChanges } from '../stanceChanges';
import type { CombatStance, CombatStancesBlob, UnitStanceRecord } from '../stances';
import { COMBAT_STANCES_BLOB } from '../stances';
import { isHostileTargetForAttacker } from '../targeting';
import { isTargetSpottedByColony } from '../vision';

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
  const existing = state.blobs[COMBAT_STANCES_BLOB];
  const prevMap = (existing?.value as Partial<CombatStancesBlob> | undefined)?.byEntityId;
  const changed = recordStanceChanges(state, prevMap, byEntityId, tick);
  if (existing && !changed) {
    existing.value = { byEntityId };
    return;
  }
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
  const curUnitView = unitsBlob?.[entityId] as Record<string, unknown> | undefined;
  if (unitsBlob && curUnitView && typeof curUnitView === 'object' && curUnitView.stance !== stance) {
    const updatedView = { ...curUnitView, stance };
    setBlob(state, 'units', { ...unitsBlob, [entityId]: updatedView }, tick);
  }

  if (owner >= 0 && state.colonies[owner]?.units) {
    const col = state.colonies[owner]!;
    const existing = (col.units as Array<{ entityId?: number; stance?: CombatStance }> | undefined)?.find(
      (u) => u && u.entityId === entityId,
    );
    if (existing && existing.stance !== stance) {
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
  const profile = (data ? mobileStats(cols.kind[unitRow]!, data)?.profile : undefined) ?? 'ground';
  const blockers = pathBlockersFor(state, profile, here, data, cols.id[unitRow]!);

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
      if (blockers?.bandGoalBlocked ? blockers.bandGoalBlocked(tileIdx) : blockers?.goalBlocked(tileIdx)) continue;

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
    if (cols.owner[row] >= 0 && !isTargetSpottedByColony(state, cols.owner[row], r, ctx.data)) continue;
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

export function canUnitMoveAndFire(kind: number, data?: CompiledDataLike): boolean {
  const combatUnits = data?.tables?.combatUnits as Record<string, { moveAndFire?: unknown } | undefined> | undefined;
  if (kind === ENTITY_KIND.recon) {
    const reconRow = combatUnits?.recon;
    if (reconRow && 'moveAndFire' in reconRow) return Boolean(reconRow.moveAndFire);
    return true;
  }
  return false;
}

export function resolveAttackMoveGoalBand(
  state: PlanetState,
  row: number,
  goal: { q: number; r: number },
  data?: CompiledDataLike,
): MoveGoal {
  const cols = state.entities.cols;
  const idx = hexIndex(state.grid.radius);
  const here = idx.indexOf(cols.q[row]!, cols.r[row]!);
  const goalIdx = idx.indexOf(goal.q, goal.r);
  const profile = (data ? mobileStats(cols.kind[row]!, data)?.profile : undefined) ?? 'ground';
  const blockers = pathBlockersFor(state, profile, here, data, cols.id[row]!);
  const maxDist = goalIdx >= 0 && blockers?.goalBlocked(goalIdx) ? 2 : 0;
  return { q: goal.q, r: goal.r, minDist: 0, maxDist };
}

export function refreshBlockedDefendAnchor(
  state: PlanetState,
  row: number,
  rec: UnitStanceRecord,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const cols = state.entities.cols;
  const id = cols.id[row]!;
  if (cols.q[row] === rec.anchorQ && cols.r[row] === rec.anchorR) {
    const deoverlap = resolveHoldDeoverlapTile(state, row, data);
    if (deoverlap) {
      rec.anchorQ = deoverlap.q;
      rec.anchorR = deoverlap.r;
      return deoverlap;
    }
    return null;
  }
  if (getMotion(state, id) === null && isHexClaimedByOtherUnit(state, rec.anchorQ, rec.anchorR, id, data)) {
    const prof = data ? movementProfile(cols.kind[row]!, data) : 'ground';
    const alt = findNearestFreeStandTile(state, rec.anchorQ, rec.anchorR, prof, id, data, 3);
    if (alt) {
      rec.anchorQ = alt.q;
      rec.anchorR = alt.r;
    }
  }
  return null;
}

export function resolveHoldDeoverlapTile(
  state: PlanetState,
  row: number,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const cols = state.entities.cols;
  if (cols.state[row] === 2) return null; // ENTITY_STATE.moving
  const curQ = cols.q[row]!, curR = cols.r[row]!;
  const entityId = cols.id[row]!;
  const curIdx = hexIndex(state.grid.radius).indexOf(curQ, curR);
  if (!isHexStationaryOccupied(state, curIdx, entityId, data, true)) return null;
  const profile = data ? movementProfile(cols.kind[row]!, data) : 'ground';
  const free = findNearestFreeStandTile(state, curQ, curR, profile, entityId, data, 2);
  return free && (free.q !== curQ || free.r !== curR) ? free : null;
}
