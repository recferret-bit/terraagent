import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { axialToPlane, hexDistance, hexIndex, hexRound } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { findHexPath, PATH_EXPANSION_BUDGET_PER_STEP, stepPathQueue, type AxialCoord } from '../../grid/path';
import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import {
  getHqView,
  hqJobFromState,
  resolveHqT1Row,
  revealVision,
  spawnHqUnit,
  syncHqView,
  type HqJob,
  type HqUnitView,
  type SimState,
  type SpawnHqOpts,
} from '../hq';

export {
  getHqView,
  hqJobFromState,
  revealVision,
  spawnHqUnit,
  syncHqView,
  type HqJob,
  type HqUnitView,
  type SimState,
  type SpawnHqOpts,
};

interface MoveUnitArgs {
  entityId?: number;
  unitId?: number;
  q?: number;
  r?: number;
  to?: { q: number; r: number };
  queue?: boolean;
}

const ARRIVAL_EPS = 1e-5;

/** Remaining waypoints per entity row (transient; recomputed lazily if missing, e.g. after a snapshot restore). */
const waypoints = new WeakMap<object, Map<number, AxialCoord[]>>();

function pathsOf(state: SimState): Map<number, AxialCoord[]> {
  let m = waypoints.get(state.entities);
  if (!m) waypoints.set(state.entities, (m = new Map()));
  return m;
}

/** Untouched trees and rock block ground units until terraformed (Clear / Break turn them into Flat). */
function hqObstacle(state: SimState): (tileIdx: number) => boolean {
  const terrain = state.grid.layers.terrain;
  return (i) => terrain[i] === TERRAIN.forest || terrain[i] === TERRAIN.rock;
}

/** A* route over open ground from the unit's current tile to `(q, r)`; waypoints exclude the start tile. */
function planRoute(state: SimState, from: AxialCoord, q: number, r: number, data: SimCtxData): AxialCoord[] | null {
  const res = findHexPath(state.grid as never, from, { q, r }, { radius: state.grid.radius, data, blocked: hqObstacle(state) });
  return res.ok ? res.path.slice(1) : null;
}
type SimCtxData = Parameters<typeof syncHqView>[3];

export const moveUnit = defineCommandHandler({
  kind: 'moveUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as MoveUnitArgs;
    const rawId = args.entityId ?? args.unitId;
    const targetQ = args.to ? args.to.q : args.q;
    const targetR = args.to ? args.to.r : args.r;
    if (
      typeof rawId !== 'number' ||
      typeof targetQ !== 'number' ||
      typeof targetR !== 'number' ||
      !Number.isInteger(targetQ) ||
      !Number.isInteger(targetR)
    ) {
      return 'invalid_args';
    }

    let row = rowOf(state.entities, rawId);
    if (row < 0 && rawId === 0 && state.entities.count > 0) row = 0;
    if (row < 0) return 'unknown_entity';

    const cols = state.entities.cols;
    if (cmd.colonyIndex !== null && cmd.colonyIndex !== undefined && cols.owner[row] !== cmd.colonyIndex) {
      return 'not_own_colony';
    }
    if (cols.kind[row] !== ENTITY_KIND.hq || cols.hp[row] <= 0) {
      return 'invalid_args';
    }

    const idx = hexIndex(state.grid.radius);
    const tileIdx = idx.indexOf(targetQ, targetR);
    if (tileIdx < 0) return 'invalid_args';

    const terrain = state.grid.layers.terrain[tileIdx];
    const prep = state.grid.layers.prep[tileIdx];
    if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) {
      return 'site_blocked';
    }
    if (terrain === TERRAIN.forest || terrain === TERRAIN.rock) return 'site_blocked'; // terraform it first
    const route = planRoute(state, { q: cols.q[row], r: cols.r[row] }, targetQ, targetR, ctx.data);
    if (!route) return 'site_blocked'; // walled in by trees / rock / water
    pathsOf(state).set(row, route);

    setField(state.entities, row, 'targetQ', targetQ, ctx.tick);
    setField(state.entities, row, 'targetR', targetR, ctx.tick);
    const dist = hexDistance(cols.x[row], cols.y[row], targetQ, targetR);
    setField(state.entities, row, 'state', dist <= ARRIVAL_EPS ? ENTITY_STATE.idle : ENTITY_STATE.moving, ctx.tick);
    setField(state.entities, row, 'progress', 0, ctx.tick);
    syncHqView(state, row, ctx.tick, ctx.data);
  },
});

export const movement = defineSystem({
  id: 'movement',
  slot: 5,
  wave: 'W01',
  run(state, ctx) {
    stepPathQueue(state, PATH_EXPANSION_BUDGET_PER_STEP, ctx.data, ctx.tick);

    const e = state.entities;
    const cols = e.cols;
    const hqRow = resolveHqT1Row(ctx.data);
    const speedPerTick = Math.fround(Number(hqRow.speedTilesPerS));
    const viewRadius = Number(hqRow.viewRadius);
    const stepDist = Math.fround(speedPerTick * ctx.dt);

    for (let row = 0; row < e.count; row++) {
      if (cols.state[row] !== ENTITY_STATE.moving) continue;
      if (cols.hp[row] <= 0) continue;

      const finalQ = cols.targetQ[row];
      const finalR = cols.targetR[row];
      const route = pathsOf(state);
      let wps = route.get(row);
      if (!wps) {
        wps = planRoute(state, { q: cols.q[row], r: cols.r[row] }, finalQ, finalR, ctx.data) ?? [{ q: finalQ, r: finalR }];
        route.set(row, wps);
      }
      const prevQ = cols.q[row];
      const prevR = cols.r[row];
      let x = cols.x[row];
      let y = cols.y[row];
      let budget = stepDist;
      // Consume the step budget across waypoints so speed is independent of path corners.
      while (wps.length > 0) {
        const tx = wps[0].q;
        const ty = wps[0].r;
        const dist = hexDistance(x, y, tx, ty);
        if (dist > 0) {
          const [px, py] = axialToPlane(tx - x, ty - y);
          setField(e, row, 'rot', Math.fround(Math.atan2(py, px)), ctx.tick);
        }
        if (dist <= budget + ARRIVAL_EPS) {
          x = tx;
          y = ty;
          budget = Math.max(0, budget - dist);
          wps.shift();
        } else {
          const ratio = budget / dist;
          x = Math.fround(x + (tx - x) * ratio);
          y = Math.fround(y + (ty - y) * ratio);
          break;
        }
      }
      const [nq, nr] = wps.length === 0 ? [finalQ, finalR] : hexRound(x, y);
      setField(e, row, 'x', Math.fround(x), ctx.tick);
      setField(e, row, 'y', Math.fround(y), ctx.tick);
      setField(e, row, 'q', nq, ctx.tick);
      setField(e, row, 'r', nr, ctx.tick);
      if (wps.length === 0) {
        route.delete(row);
        setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
        setField(e, row, 'progress', 0, ctx.tick);
      }
      if (nq !== prevQ || nr !== prevR) {
        revealVision(state, cols.owner[row], nq, nr, viewRadius, ctx.tick);
      }

      if (cols.kind[row] === ENTITY_KIND.hq) {
        syncHqView(state, row, ctx.tick, ctx.data);
      }
    }
  },
});

export default defineSimModule({
  id: 'movement',
  wave: 'W01',
  systems: [movement],
  handlers: [moveUnit],
});
