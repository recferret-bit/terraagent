import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { pathBlockedFor } from '../../grid/pathProfiles';
import { cancelPathRequest, enqueuePathRequest, PATH_EXPANSION_BUDGET_PER_STEP, stepPathQueue } from '../../grid/pathQueue';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { mobileStats, movementProfile, notifyUnitChanged } from '../mobility';
import { applyGroupField, detachMember, groupMotionFor, replanGroupMember } from './groupMarch';
import { advanceAlongRoute, type Route } from './locomotion';

/**
 * Movement orchestrator. Unit commands never move a unit themselves: they ask the orchestrator for a move
 * (`requestMove`). The orchestrator keeps one live movement request per unit (a newer request replaces the older one),
 * hands requests in FIFO order to the pathfinding service (`grid/pathQueue.ts`: A* under the per-step expansion budget,
 * SIM-T-02), turns each solved path into the unit's route, and drives locomotion along it. A request the service
 * cannot solve ends as `failed`; there is no straight-line fallback.
 *
 * State lives in `state.blobs.unitMotion` (plain data), so routes survive snapshots and the prediction clone.
 */

/** Where a unit wants to be: any tile whose hex distance to `(q, r)` is in `[minDist, maxDist]` (0, 0 = that tile). */
export interface MoveGoal {
  q: number;
  r: number;
  minDist: number;
  maxDist: number;
}

export type MotionStatus = 'pending' | 'following' | 'arrived' | 'failed';

export interface UnitMotion extends Route {
  goal: MoveGoal;
  /** Id of the pending path request, or `null` once solved. */
  reqId: string | null;
  status: MotionStatus;
  /** Tiles per tick when a group march holds this unit below its data speed. Never written back onto the stat cache. */
  marchSpeed?: number;
}

interface MotionBlobValue {
  nextReq: number;
  byId: Record<string, UnitMotion>;
  /** Material route transitions only; waypoint progress never stamps this sparse transport journal. */
  changeTicks?: Record<string, number>;
}

function markRouteChange(motions: MotionBlobValue, id: number, tick: number): void {
  (motions.changeTicks ??= {})[String(id)] = tick;
}

function readMotions(state: PlanetState): MotionBlobValue {
  const raw = state.blobs.unitMotion?.value as MotionBlobValue | undefined;
  return raw && typeof raw === 'object' && raw.byId ? raw : { nextReq: 1, byId: {} };
}

function writeMotions(state: PlanetState, value: MotionBlobValue, tick: number): void {
  setBlob(state, 'unitMotion', value, tick);
}

export const sameGoal = (a: MoveGoal, b: MoveGoal): boolean =>
  a.q === b.q && a.r === b.r && a.minDist === b.minDist && a.maxDist === b.maxDist;

/** The unit's current movement (route and status), or `null` if it has none. */
export function getMotion(state: PlanetState, entityId: number): UnitMotion | null {
  return readMotions(state).byId[String(entityId)] ?? null;
}

function enqueueFor(state: PlanetState, motions: MotionBlobValue, row: number, goal: MoveGoal, ctx: StepContext): UnitMotion {
  const cols = state.entities.cols;
  const id = cols.id[row];
  const tick = ctx.tick;
  const prev = motions.byId[String(id)];
  if (prev?.reqId) cancelPathRequest(state, prev.reqId, tick);
  const reqId = `mv${motions.nextReq++}`;
  enqueuePathRequest(
    state,
    {
      id: reqId,
      entityId: id,
      from: { q: cols.q[row], r: cols.r[row] },
      to: { q: goal.q, r: goal.r },
      radius: state.grid.radius,
      profile: movementProfile(cols.kind[row], ctx.data),
      ...(goal.maxDist > 0 ? { band: { minDist: goal.minDist, maxDist: goal.maxDist } } : {}),
    },
    tick,
  );
  const motion: UnitMotion = { goal: { ...goal }, reqId, status: 'pending', path: [], next: 0 };
  motions.byId[String(id)] = motion;
  markRouteChange(motions, id, tick);
  return motion;
}

/** Queues a move of unit `row` to `goal`. A unit already heading for the same goal keeps its route. */
export function requestMove(state: PlanetState, row: number, goal: MoveGoal, ctx: StepContext): void {
  const motions = readMotions(state);
  const prev = motions.byId[String(state.entities.cols.id[row])];
  if (prev && sameGoal(prev.goal, goal) && prev.status !== 'failed') return;
  const joined = groupMotionFor(state, row, goal);
  if (joined) {
    motions.byId[String(state.entities.cols.id[row])] = joined;
    markRouteChange(motions, state.entities.cols.id[row], ctx.tick);
    writeMotions(state, motions, ctx.tick);
    return;
  }
  enqueueFor(state, motions, row, goal, ctx);
  writeMotions(state, motions, ctx.tick);
}

/** Drops the unit's route and any pending path request (the unit stops where it is). */
export function cancelMove(state: PlanetState, entityId: number, tick: number): void {
  detachMember(state, entityId, tick);
  const motions = readMotions(state);
  const prev = motions.byId[String(entityId)];
  if (!prev) return;
  if (prev.reqId) cancelPathRequest(state, prev.reqId, tick);
  delete motions.byId[String(entityId)];
  markRouteChange(motions, entityId, tick);
  writeMotions(state, motions, tick);
}

/**
 * The waypoints a unit at its current continuous position walks: the path minus its start tile when the unit stands
 * on that tile's centre, is already part-way towards the path's second tile (a re-plan mid-step must not walk back), or
 * the start tile itself became an obstacle (the unit walks straight out of it).
 */
function routeFrom(state: PlanetState, row: number, path: readonly { q: number; r: number }[], ctx: StepContext): { q: number; r: number }[] {
  const cols = state.entities.cols;
  const x = cols.x[row];
  const y = cols.y[row];
  const atStart = x === path[0].q && y === path[0].r;
  const towardSecond = path.length > 1 && hexDistance(x, y, path[1].q, path[1].r) < 1 - 1e-6;
  const startIdx = hexIndex(state.grid.radius).indexOf(path[0].q, path[0].r);
  const effProfile = movementProfile(cols.kind[row], ctx.data);
  const startBlocked = path.length > 1 && (pathBlockedFor(state, effProfile, -1, ctx.data)?.(startIdx) ?? false);
  return atStart || towardSecond || startBlocked ? path.slice(1) : path.slice();
}

function assignRoutes(state: PlanetState, motions: MotionBlobValue, ctx: StepContext, ended: number[]): boolean {
  const solved = stepPathQueue(state, PATH_EXPANSION_BUDGET_PER_STEP, ctx.data, ctx.tick).resolved;
  let changed = false;
  for (const res of solved) {
    if (res.fieldParents || res.fieldSeeds) {
      if (applyGroupField(state, motions, res, ctx, ended, (row, path) => routeFrom(state, row, path, ctx))) changed = true;
      continue;
    }
    if (res.entityId === undefined) continue;
    const m = motions.byId[String(res.entityId)];
    if (!m || m.reqId !== res.id) continue;
    changed = true;
    m.reqId = null;
    markRouteChange(motions, res.entityId, ctx.tick);
    if (!res.ok) {
      m.status = 'failed';
      ended.push(res.entityId);
      continue;
    }
    const row = rowOf(state.entities, res.entityId);
    const steps = row >= 0 ? routeFrom(state, row, res.path, ctx) : res.path;
    m.path = steps.flatMap((p) => [p.q, p.r]);
    m.next = 0;
    m.status = steps.length > 0 ? 'following' : 'arrived';
    if (m.status === 'arrived') ended.push(res.entityId);
  }
  return changed;
}

/**
 * One movement step for the whole planet (units slot): solve queued paths within the budget, then advance every unit
 * that has a route. Returns the ids whose movement ended this step (`arrived` or `failed`), in ascending id order, so
 * their commands can react on the same step.
 */
export function runMovement(state: PlanetState, ctx: StepContext): number[] {
  const motions = readMotions(state);
  const ended: number[] = [];
  for (const id of Object.keys(motions.changeTicks ?? {})) {
    if (rowOf(state.entities, Number(id)) < 0) delete motions.changeTicks![id];
  }
  let changed = assignRoutes(state, motions, ctx, ended);

  const ids = Object.keys(motions.byId).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const m = motions.byId[String(id)];
    const row = rowOf(state.entities, id);
    if (row < 0) {
      if (m.reqId) cancelPathRequest(state, m.reqId, ctx.tick);
      delete motions.byId[String(id)];
      changed = true;
      continue;
    }
    if (m.status !== 'following') continue;
    const stats = mobileStats(state.entities.cols.kind[row], ctx.data);
    if (!stats) continue;
    const stepStats = m.marchSpeed !== undefined && m.marchSpeed < stats.speedPerTick ? { ...stats, speedPerTick: m.marchSpeed } : stats;
    const before = m.next;
    const here = hexIndex(state.grid.radius).indexOf(state.entities.cols.q[row], state.entities.cols.r[row]);
    const effProfile = movementProfile(state.entities.cols.kind[row], ctx.data);
    const res = advanceAlongRoute(state, row, m, stepStats, ctx, pathBlockedFor(state, effProfile, here, ctx.data));
    if (m.next !== before) changed = true;
    if (res === 'arrived') {
      m.status = 'arrived';
      markRouteChange(motions, id, ctx.tick);
      ended.push(id);
      changed = true;
    } else if (res === 'blocked') {
      if (!replanGroupMember(state, motions, row, ctx, (blockedRow, path) => routeFrom(state, blockedRow, path, ctx))) {
        enqueueFor(state, motions, row, m.goal, ctx); // the map changed under the route: re-plan from here
      }
      changed = true;
    }
    notifyUnitChanged(state, row, ctx.tick, ctx.data);
  }
  if (changed) writeMotions(state, motions, ctx.tick);
  return ended.sort((a, b) => a - b);
}
