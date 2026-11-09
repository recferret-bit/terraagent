import { getAtlasBlob } from '../../atlas/generateAtlas';
import { globalTileToSector } from '../../atlas/partition';
import { syncAtlasColonySectorState } from '../../atlas/sectorMetrics';
import { setField } from '../../ecs/store';
import { axialToPlane, hexDistance, hexIndex, hexRound } from '../../grid/hex';
import { PREP } from '../../grid/layers';
import { groundMoveMultiplierBp, isGroundPassable } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import { atan2Det } from '../../kernel/detMath';
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

/** One geometric step toward a waypoint. Shared by locomotion and the time-sampled march tests. */
function stepToward(
  x: number,
  y: number,
  tx: number,
  ty: number,
  budget: number,
): { x: number; y: number; budget: number; reached: boolean } {
  const dist = hexDistance(x, y, tx, ty);
  if (dist <= budget + ARRIVAL_EPS) return { x: tx, y: ty, budget: Math.max(0, budget - dist), reached: true };
  const ratio = dist > 0 ? budget / dist : 0;
  return { x: Math.fround(x + (tx - x) * ratio), y: Math.fround(y + (ty - y) * ratio), budget: 0, reached: false };
}

/**
 * Where a unit stands after spending `budget` tiles along `path` from waypoint `next`. No blocked-tile check:
 * locomotion does that before it calls this. The returned `x`/`y` match what `advanceAlongRoute` writes.
 */
export function advancePose(
  x: number,
  y: number,
  path: readonly number[],
  next: number,
  budget: number,
): { x: number; y: number; next: number; arrived: boolean } {
  let px = x;
  let py = y;
  let n = next;
  let left = budget;
  const waypoints = path.length / 2;
  while (n < waypoints) {
    const stepped = stepToward(px, py, path[n * 2], path[n * 2 + 1], left);
    px = stepped.x;
    py = stepped.y;
    left = stepped.budget;
    if (!stepped.reached) break;
    n += 1;
  }
  return { x: Math.fround(px), y: Math.fround(py), next: n, arrived: n >= waypoints };
}

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
  const rot = Math.fround(atan2Det(py, px));
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
  const curTileIdx = idx.indexOf(prevQ, prevR);
  const effectiveSpeedPerTick =
    curTileIdx >= 0 && state.grid.layers.prep[curTileIdx] === PREP.living
      ? stats.speedPerTick * (groundMoveMultiplierBp(state.grid, curTileIdx, ctx.data) / 10000)
      : stats.speedPerTick;
  let budget = Math.fround(effectiveSpeedPerTick * ctx.dt);
  let result: LocomotionResult = 'moving';
  const waypoints = route.path.length / 2;
  const atlasBlob = getAtlasBlob(state);
  const startSectorId = atlasBlob ? globalTileToSector(prevQ, prevR, atlasBlob.sectorRadius).sectorId : null;

  while (route.next < waypoints) {
    const tx = route.path[route.next * 2];
    const ty = route.path[route.next * 2 + 1];
    const tileIdx = idx.indexOf(tx, ty);
    const crossesSector =
      startSectorId !== null && globalTileToSector(tx, ty, atlasBlob!.sectorRadius).sectorId !== startSectorId;
    // the tile the unit already stands in never blocks it (it may only walk out), like A*'s exempt start tile
    const inside = tx === prevQ && ty === prevR;
    if (
      tileIdx < 0 ||
      crossesSector ||
      (!inside && (!isGroundPassable(state.grid, tileIdx, ctx.data) || (blocked?.(tileIdx) ?? false)))
    ) {
      result = 'blocked';
      break;
    }
    const dist = hexDistance(x, y, tx, ty);
    if (dist > 0) {
      const [px, py] = axialToPlane(tx - x, ty - y);
      setField(e, row, 'rot', Math.fround(atan2Det(py, px)), ctx.tick);
    }
    const stepped = stepToward(x, y, tx, ty, budget);
    x = stepped.x;
    y = stepped.y;
    budget = stepped.budget;
    if (!stepped.reached) break;
    route.next += 1;
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
    const atlasBlob = getAtlasBlob(state);
    if (atlasBlob && cols.owner[row] >= 0) {
      const prevSec = globalTileToSector(prevQ, prevR, atlasBlob.sectorRadius).sectorId;
      const nextSec = globalTileToSector(nq, nr, atlasBlob.sectorRadius).sectorId;
      if (prevSec !== nextSec) syncAtlasColonySectorState(state, ctx.tick);
    }
  }
  return result;
}
