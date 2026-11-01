import { ENTITY_KIND } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import { defineGroundOccupancy } from '../../grid/pathProfiles';
import type { PlanetState } from '../../kernel/state';
import { getBuildingFootprintTiles } from './placement';

/**
 * Buildings block ground movement: every tile of a Hub's footprint (placed, under construction or done) is an obstacle
 * for ground units, so the HQ routes around Hubs and works a site it prepares from outside it. Placing or removing a
 * building bumps `meta.pathEpoch` (`bumpPathEpoch`) so paused path searches restart on the new ground.
 */
export function buildingFootprints(state: PlanetState): number[][] {
  const e = state.entities;
  const idx = hexIndex(state.grid.radius);
  const out: number[][] = [];
  for (let row = 0; row < e.count; row++) {
    if (e.cols.kind[row] !== ENTITY_KIND.hub) continue;
    const tiles = getBuildingFootprintTiles(e.cols.q[row], e.cols.r[row], 3).map((t) => idx.indexOf(t.q, t.r));
    out.push(tiles.filter((i) => i >= 0));
  }
  return out;
}

defineGroundOccupancy(buildingFootprints);
