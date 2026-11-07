import { TILE_M } from '@terra/render/planets/hex';
import { axialToPlane } from '@terra/sim/grid/hex';
import {
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  PREP,
  setTileTerrain,
  spawnHqUnit,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';

export const MARCH_RADIUS = 22;
export const MARCH_ANCHOR = { q: 8, r: 0 };
export const MARCH_ROCKS = [
  { q: 8, r: 0 },
  { q: 9, r: 0 },
  { q: 8, r: -1 },
] as const;
export const MARCH_COUNT = 30;

/** Sim axial position → playground metres, matching the firing-range scene. */
export function marchWorld(x: number, y: number): { x: number; z: number } {
  const [px, pz] = axialToPlane(x, y);
  return { x: px * TILE_M, z: pz * TILE_M };
}

export function stampMarchGround(state: PlanetState): void {
  const layers = state.grid.layers;
  layers.terrain.fill(TERRAIN.flat);
  layers.prep.fill(PREP.prepared);
  layers.height.fill(0);
  layers.deposit.fill(DEPOSIT.none);
}

/** Twenty-nine HQ drones and one tank in a block west of the anchor. The tank is the last id. */
export function spawnMarchUnits(state: PlanetState): { ids: number[]; tankId: number } {
  const ids: number[] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 3 && ids.length < MARCH_COUNT - 1; q++) {
      ids.push(spawnHqUnit(state, { owner: 0, q, r }));
    }
  }
  const tankId = spawnTank(state, -2, 3);
  ids.push(tankId);
  return { ids, tankId };
}

export function stampMarchRocks(state: PlanetState): void {
  const idx = hexIndex(state.grid.radius);
  for (const rock of MARCH_ROCKS) setTileTerrain(state.grid, idx.indexOf(rock.q, rock.r), TERRAIN.rock);
}

function spawnTank(state: PlanetState, q: number, r: number): number {
  const tick = state.meta.tick;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.demoTank;
  cols.owner[row] = 0;
  cols.hp[row] = 520;
  cols.hpMax[row] = 520;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, q, r, tick);
  return id;
}
