import { ENTITY_STATE } from '../ecs/columns';
import { setField } from '../ecs/store';
import { hexDistance, hexIndex } from '../grid/hex';
import { pathBlockedFor } from '../grid/pathProfiles';
import { notifyUnitChanged } from './mobility';
import { getMotion, requestMove, sameGoal, type MoveGoal } from './movement/orchestrator';
import type { UnitCtx } from './types';

export type ApproachStatus = 'arrived' | 'moving' | 'failed';

/** Writes `state`/`progress`/`targetQ`/`targetR` of the unit only when they change (no needless delta rows). */
export function setUnitActivity(u: UnitCtx, state: number, targetQ: number, targetR: number): void {
  const e = u.state.entities;
  const cols = e.cols;
  const tick = u.ctx.tick;
  let changed = false;
  if (cols.state[u.row] !== state) {
    setField(e, u.row, 'state', state, tick);
    setField(e, u.row, 'progress', 0, tick);
    changed = true;
  }
  if (cols.targetQ[u.row] !== targetQ || cols.targetR[u.row] !== targetR) {
    setField(e, u.row, 'targetQ', targetQ, tick);
    setField(e, u.row, 'targetR', targetR, tick);
    changed = true;
  }
  if (changed) notifyUnitChanged(u.state, u.row, tick, u.ctx.data);
}

/** Standing on a tile centre within the band, on a tile the unit may stand on (not inside a building footprint). */
function inBand(u: UnitCtx, goal: MoveGoal): boolean {
  const cols = u.state.entities.cols;
  const atCentre = cols.x[u.row] === cols.q[u.row] && cols.y[u.row] === cols.r[u.row];
  const d = hexDistance(cols.q[u.row], cols.r[u.row], goal.q, goal.r);
  if (!atCentre || d < goal.minDist || d > goal.maxDist) return false;
  const here = hexIndex(u.state.grid.radius).indexOf(cols.q[u.row], cols.r[u.row]);
  return !(pathBlockedFor(u.state, u.stats.profile)?.(here) ?? false);
}

/**
 * Shared "go there first" phase of every command: `arrived` once the unit stands on a tile within the goal band,
 * `moving` while the movement orchestrator routes it there (the unit's state shows `moving`, its target the goal
 * tile), `failed` when no route exists. `retarget` (tiles) lets a moving goal (an attack target) drift that far before
 * the route is re-planned.
 */
export function approach(u: UnitCtx, goal: MoveGoal, retarget = 0): ApproachStatus {
  const motion = getMotion(u.state, u.id);
  const following = motion !== null && (sameGoal(motion.goal, goal) || (retarget > 0 && hexDistance(motion.goal.q, motion.goal.r, goal.q, goal.r) <= retarget && motion.goal.maxDist === goal.maxDist));
  if (following && motion) {
    if (motion.status === 'failed') return 'failed';
    if (motion.status === 'arrived') return 'arrived';
    setUnitActivity(u, ENTITY_STATE.moving, goal.q, goal.r);
    return 'moving';
  }
  if (inBand(u, goal)) return 'arrived';
  requestMove(u.state, u.row, goal, u.ctx);
  setUnitActivity(u, ENTITY_STATE.moving, goal.q, goal.r);
  return 'moving';
}
