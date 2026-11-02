import { hexIndex } from '../../grid/hex';
import { defineGroundOccupancy } from '../../grid/pathProfiles';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { entityFootprint, getBuildingFootprintTiles, occupiesGround } from './placement';

/**
 * Buildings block ground movement: every tile of an alive building's footprint (placed, under construction or done) is
 * an obstacle for ground units, so the HQ routes around Hubs and works a site it prepares from outside it. The rule is
 * `occupiesGround`, the same one placement uses (GP-23). Placing or removing a building bumps `meta.pathEpoch`
 * (`bumpPathEpoch`) so paused path searches restart on the new ground.
 */

interface Cached {
  key: string;
  footprints: number[][];
}

/** Last footprints per state (GP-22): recomputed only when the set of occupying buildings or their tiles changed. */
const cache = new WeakMap<PlanetState, Cached>();

/**
 * Footprint tiles of every alive building, sized by the step's compiled data (`hub.t1.footprint`, the number placement
 * reads, GP-38): a tuned footprint blocks the same tiles for movement as for placement.
 */
export function buildingFootprints(state: PlanetState, data?: CompiledDataLike): number[][] {
  const e = state.entities, cols = e.cols;
  const rows: number[] = [];
  let key = `${state.grid.radius}`;
  for (let row = 0; row < e.count; row++) {
    if (!occupiesGround({ kind: cols.kind[row], hp: cols.hp[row], hpMax: cols.hpMax[row] })) continue;
    rows.push(row);
    key += `|${cols.kind[row]}x${entityFootprint(cols.kind[row], data)}:${cols.q[row]},${cols.r[row]}`;
  }
  const hit = cache.get(state);
  if (hit && hit.key === key) return hit.footprints;
  const idx = hexIndex(state.grid.radius);
  const footprints = rows.map((row) =>
    getBuildingFootprintTiles(cols.q[row], cols.r[row], entityFootprint(cols.kind[row], data)).map((t) => idx.indexOf(t.q, t.r)).filter((i) => i >= 0),
  );
  cache.set(state, { key, footprints });
  return footprints;
}

defineGroundOccupancy(buildingFootprints);
