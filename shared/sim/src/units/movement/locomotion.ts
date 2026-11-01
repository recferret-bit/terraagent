import { setField } from '../../ecs/store';
import { axialToPlane, hexDistance, hexIndex, hexRound } from '../../grid/hex';
import { isGroundPassable } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { revealVision } from '../../systems/hq';
import type { MobileStats } from '../mobility';

/**
 * Locomotion: the ONLY code that moves a live entity (writes `x`, `y`, `q`, `r`). A unit advances along the route the
 * movement orchestrator gave it at its data speed, never faster and never through a blocked tile. The sim lint
 * (`eslint.rules.js`, rule "position writes") rejects position writes anywhere else except spawning
 * (`ecs/placement.ts`) and admin commands (`systems/dev`). Do not add a shortcut that snaps a unit to its target.
 */

const ARRIVAL_EPS = 1e-5;

/** Waypoints as a flat `[q0, r0, q1, r1, …]` list; `next` is the index (in pairs) of the waypoint being walked to. */
export interface Route {
  path: number[];
  next: number;
}

export type LocomotionResult = 'moving' | 'arrived' | 'blocked';

/** Turns the unit to face tile `(q, r)` (rotation only; used while working on a tile). */
export function faceTowards(state: PlanetState, row: number, q: number, r: number, tick: number): void {
  const cols = state.entities.cols;
  if (hexDistance(cols.x[row], cols.y[row], q, r) <= ARRIVAL_EPS) return;
  const [px, py] = axialToPlane(q - cols.x[row], r - cols.y[row]);
  const rot = Math.fround(Math.atan2(py, px));
  if (cols.rot[row] !== rot) setField(state.entities, row, 'rot', rot, tick);
}

/**
 * Advances unit `row` by one step of `stats.speedPerTick × dt` tiles along `route` (mutating `route.next`). The step
 * budget carries across waypoints, so speed does not depend on path corners. Stops before a waypoint tile that has
 * become impassable (`blocked`) so the orchestrator can re-plan.
 */
export function advanceAlongRoute(
  state: PlanetState,
  row: number,
  route: Route,
  stats: MobileStats,
  ctx: StepContext,
  blocked: ((tileIdx: number) => boolean) | undefined,
): LocomotionResult {
  const e = state.entities;
  const cols = e.cols;
  const idx = hexIndex(state.grid.radius);
  const prevQ = cols.q[row];
  const prevR = cols.r[row];
  let x = cols.x[row];
  let y = cols.y[row];
  let budget = Math.fround(stats.speedPerTick * ctx.dt);
  let result: LocomotionResult = 'moving';
  const waypoints = route.path.length / 2;

  while (route.next < waypoints) {
    const tx = route.path[route.next * 2];
    const ty = route.path[route.next * 2 + 1];
    const tileIdx = idx.indexOf(tx, ty);
    // the tile the unit already stands in never blocks it (it may only walk out), like A*'s exempt start tile
    const inside = tx === prevQ && ty === prevR;
    if (tileIdx < 0 || (!inside && (!isGroundPassable(state.grid, tileIdx, ctx.data) || (blocked?.(tileIdx) ?? false)))) {
      result = 'blocked';
      break;
    }
    const dist = hexDistance(x, y, tx, ty);
    if (dist > 0) {
      const [px, py] = axialToPlane(tx - x, ty - y);
      setField(e, row, 'rot', Math.fround(Math.atan2(py, px)), ctx.tick);
    }
    if (dist <= budget + ARRIVAL_EPS) {
      x = tx;
      y = ty;
      budget = Math.max(0, budget - dist);
      route.next += 1;
    } else {
      const ratio = budget / dist;
      x = Math.fround(x + (tx - x) * ratio);
      y = Math.fround(y + (ty - y) * ratio);
      break;
    }
  }

  const done = route.next >= waypoints;
  if (done) result = 'arrived';
  const [nq, nr] = done && waypoints > 0 ? [route.path[route.path.length - 2], route.path[route.path.length - 1]] : hexRound(x, y);
  setField(e, row, 'x', Math.fround(x), ctx.tick);
  setField(e, row, 'y', Math.fround(y), ctx.tick);
  setField(e, row, 'q', nq, ctx.tick);
  setField(e, row, 'r', nr, ctx.tick);
  if (nq !== prevQ || nr !== prevR) {
    revealVision(state, cols.owner[row], nq, nr, stats.viewRadius, ctx.tick);
  }
  return result;
}
