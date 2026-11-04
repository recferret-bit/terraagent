import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { pathBlockedFor, type PathProfileId } from '../../grid/pathProfiles';
import { cancelPathRequest, enqueuePathRequest, PATH_EXPANSION_BUDGET_PER_STEP, stepPathQueue } from '../../grid/pathQueue';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { mobileStats, notifyUnitChanged } from '../mobility';
import { advanceAlongRoute, type Route } from './locomotion';

function movementProfileForKind(kind: number, baseProfile: PathProfileId | undefined): PathProfileId {
  if (
    kind === ENTITY_KIND.blackAnt ||
    kind === ENTITY_KIND.blueBeetle ||
    kind === ENTITY_KIND.greenSpitter
  ) {
    return 'harvester';
  }
  return baseProfile ?? 'ground';
}

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
}

interface MotionBlobValue {
  nextReq: number;
  byId: Record<string, UnitMotion>;
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
  const stats = mobileStats(cols.kind[row], ctx.data);
  const reqId = `mv${motions.nextReq++}`;
  enqueuePathRequest(
    state,
    {
      id: reqId,
      entityId: id,
      from: { q: cols.q[row], r: cols.r[row] },
      to: { q: goal.q, r: goal.r },
      radius: state.grid.radius,
      profile: movementProfileForKind(cols.kind[row], stats?.profile),
      ...(goal.maxDist > 0 ? { band: { minDist: goal.minDist, maxDist: goal.maxDist } } : {}),
    },
    tick,
  );
  const motion: UnitMotion = { goal: { ...goal }, reqId, status: 'pending', path: [], next: 0 };
  motions.byId[String(id)] = motion;
  return motion;
}

/** Queues a move of unit `row` to `goal`. A unit already heading for the same goal keeps its route. */
export function requestMove(state: PlanetState, row: number, goal: MoveGoal, ctx: StepContext): void {
  const motions = readMotions(state);
  const prev = motions.byId[String(state.entities.cols.id[row])];
  if (prev && sameGoal(prev.goal, goal) && prev.status !== 'failed') return;
  enqueueFor(state, motions, row, goal, ctx);
  writeMotions(state, motions, ctx.tick);
}

/** Drops the unit's route and any pending path request (the unit stops where it is). */
export function cancelMove(state: PlanetState, entityId: number, tick: number): void {
  const motions = readMotions(state);
  const prev = motions.byId[String(entityId)];
  if (!prev) return;
  if (prev.reqId) cancelPathRequest(state, prev.reqId, tick);
  delete motions.byId[String(entityId)];
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
  const effProfile = movementProfileForKind(cols.kind[row], mobileStats(cols.kind[row], ctx.data)?.profile);
  const startBlocked = path.length > 1 && (pathBlockedFor(state, effProfile, -1, ctx.data)?.(startIdx) ?? false);
  return atStart || towardSecond || startBlocked ? path.slice(1) : path.slice();
}

function assignRoutes(state: PlanetState, motions: MotionBlobValue, ctx: StepContext, ended: number[]): boolean {
  const solved = stepPathQueue(state, PATH_EXPANSION_BUDGET_PER_STEP, ctx.data, ctx.tick).resolved;
  let changed = false;
  for (const res of solved) {
    if (res.entityId === undefined) continue;
    const m = motions.byId[String(res.entityId)];
    if (!m || m.reqId !== res.id) continue;
    changed = true;
    m.reqId = null;
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
    const before = m.next;
    const here = hexIndex(state.grid.radius).indexOf(state.entities.cols.q[row], state.entities.cols.r[row]);
    const effProfile = movementProfileForKind(state.entities.cols.kind[row], stats.profile);
    const res = advanceAlongRoute(state, row, m, stats, ctx, pathBlockedFor(state, effProfile, here, ctx.data));
    if (m.next !== before) changed = true;
    if (res === 'arrived') {
      m.status = 'arrived';
      ended.push(id);
      changed = true;
    } else if (res === 'blocked') {
      enqueueFor(state, motions, row, m.goal, ctx); // the map changed under the route: re-plan from here
      changed = true;
    }
    notifyUnitChanged(state, row, ctx.tick, ctx.data);
  }
  if (changed) writeMotions(state, motions, ctx.tick);
  return ended.sort((a, b) => a - b);
}
