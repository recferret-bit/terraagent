import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { isOpenGround, joinPlaneHeight } from '../../grid/hexTile';
import { DEPOSIT, PREP, TERRAIN, type DepositKey } from '../../grid/layers';
import { revealAroundChanged } from '../../grid/subsurface';
import { setTileHeight, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import type { PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { getWeatherState, saveWeatherState, type MeteorCraterState, type WeatherBlobState } from '../weather/types';
import { METEOR_CRATER_TERRAFORM_MULTIPLIER, scaleMeteorCraterWork } from './groundWorkRule';

export { METEOR_CRATER_TERRAFORM_MULTIPLIER, scaleMeteorCraterWork };
export const MAX_CRATER_FLOOD_TILES = 64;

export interface CraterCoord {
  q: number;
  r: number;
}

export interface MeteorCraterFlatten {
  count: number;
  tiles: CraterCoord[];
  revealed: Array<{ q: number; r: number; deposit: DepositKey; richnessBp: number }>;
}

function unwrapWeatherBlob(raw: unknown): Partial<WeatherBlobState> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if ('value' in obj && obj.value && typeof obj.value === 'object') {
    return obj.value as Partial<WeatherBlobState>;
  }
  return obj as Partial<WeatherBlobState>;
}

/** Finds a recorded `MeteorCraterState` in `weatherBlob?.craters` whose radius-3 disc or `tiles` contains `(q, r)`. */
export function findMeteorCraterAt(weatherBlob: unknown, q: number, r: number): MeteorCraterState | undefined {
  const weather = unwrapWeatherBlob(weatherBlob);
  if (!weather || !Array.isArray(weather.craters)) return undefined;
  return weather.craters.find(
    (c) =>
      hexDistance(q, r, c.q, c.r) <= 3 ||
      (Array.isArray(c.tiles) && c.tiles.some((t) => t.q === q && t.r === r)),
  );
}

/** BFS flood-fill of connected `TERRAIN.hole` tiles starting from `(q, r)` up to `MAX_CRATER_FLOOD_TILES`. */
export function floodFillConnectedHoleTiles(
  planetRadius: number,
  q: number,
  r: number,
  terrain: ArrayLike<number>,
  maxTiles = MAX_CRATER_FLOOD_TILES,
): CraterCoord[] {
  const hx = hexIndex(planetRadius);
  const startIdx = hx.indexOf(q, r);
  if (startIdx < 0 || terrain[startIdx] !== TERRAIN.hole) return [];
  const visited = new Set<number>([startIdx]);
  const queue: CraterCoord[] = [{ q, r }];
  for (let head = 0; head < queue.length && queue.length < maxTiles; head++) {
    const cur = queue[head]!;
    for (const [dq, dr] of HEX_DIRS) {
      if (queue.length >= maxTiles) break;
      const nq = cur.q + dq;
      const nr = cur.r + dr;
      const nIdx = hx.indexOf(nq, nr);
      if (nIdx < 0 || visited.has(nIdx) || terrain[nIdx] !== TERRAIN.hole) continue;
      visited.add(nIdx);
      queue.push({ q: nq, r: nr });
    }
  }
  return queue;
}

/**
 * Returns the hole hexes that a meteor crater `work` job at `(q, r)` will fill & prepare together.
 * Uses `weatherBlob?.craters` if `(q, r)` belongs to a recorded meteor crater, and falls back to
 * connected `TERRAIN.hole` flood-fill up to 12 tiles.
 */
export function meteorCraterWorkTiles(
  planetRadius: number,
  q: number,
  r: number,
  terrain: ArrayLike<number>,
  weatherBlob?: unknown,
): CraterCoord[] {
  const hx = hexIndex(planetRadius);
  const crater = findMeteorCraterAt(weatherBlob, q, r);
  if (crater && Array.isArray(crater.tiles) && crater.tiles.length > 0) {
    const validTiles = crater.tiles.filter((t) => hx.indexOf(t.q, t.r) >= 0);
    const holeTiles = validTiles.filter((t) => terrain[hx.indexOf(t.q, t.r)] === TERRAIN.hole);
    if (holeTiles.length > 0) {
      return holeTiles.map((t) => ({ q: t.q, r: t.r }));
    }
    return validTiles.map((t) => ({ q: t.q, r: t.r }));
  }
  return floodFillConnectedHoleTiles(planetRadius, q, r, terrain, MAX_CRATER_FLOOD_TILES);
}

function computeCraterJoinHeight(
  planetRadius: number,
  craterIndices: ReadonlySet<number>,
  terrain: ArrayLike<number>,
  prep: ArrayLike<number> | undefined,
  height: ArrayLike<number> | undefined,
): number {
  if (!height) return 0;
  const hx = hexIndex(planetRadius);
  const openPerimeterHeights: number[] = [];
  const anyPerimeterHeights: number[] = [];
  const seenNeighbors = new Set<number>();

  for (const idx of craterIndices) {
    const cq = hx.q[idx]!;
    const cr = hx.r[idx]!;
    for (const [dq, dr] of HEX_DIRS) {
      const nIdx = hx.indexOf(cq + dq, cr + dr);
      if (nIdx < 0 || craterIndices.has(nIdx) || seenNeighbors.has(nIdx)) continue;
      seenNeighbors.add(nIdx);
      const t = terrain[nIdx] ?? -1;
      if (t === TERRAIN.hole) continue;
      const h = height[nIdx] ?? 0;
      anyPerimeterHeights.push(h);
      if (isOpenGround(t, prep?.[nIdx] ?? 0)) {
        openPerimeterHeights.push(h);
      }
    }
  }

  return (
    joinPlaneHeight(openPerimeterHeights) ??
    joinPlaneHeight(anyPerimeterHeights) ??
    0
  );
}

function removeClearedAftermathSites(
  state: PlanetState,
  weather: WeatherBlobState,
  q: number,
  r: number,
  coordMap: ReadonlyMap<string, CraterCoord>,
  tick: number,
): void {
  let changed = false;
  if (Array.isArray(weather.craters) && weather.craters.length > 0) {
    const beforeLen = weather.craters.length;
    weather.craters = weather.craters.filter(
      (c) => !(c.q === q && c.r === r) && !c.tiles.some((t) => coordMap.has(`${t.q},${t.r}`)),
    );
    if (weather.craters.length !== beforeLen) changed = true;
  }
  if (Array.isArray(weather.lightningSites) && weather.lightningSites.length > 0) {
    const beforeLen = weather.lightningSites.length;
    weather.lightningSites = weather.lightningSites.filter(
      (s) => !(s.q === q && s.r === r) && !s.tiles.some((t) => coordMap.has(`${t.q},${t.r}`)),
    );
    if (weather.lightningSites.length !== beforeLen) changed = true;
  }
  if (changed) {
    saveWeatherState(state, weather, tick);
  }
}

/**
 * Flattens and prepares an entire meteor crater or lightning aftermath site containing `(q, r)` as a single plane
 * (`TERRAIN.flat`, `PREP.prepared`, smooth `joinPlaneHeight`), clears `holeVariant`, and removes the site from
 * `weather.craters` / `weather.lightningSites`.
 */
export function flattenMeteorCraterFootprint(
  state: PlanetState,
  q: number,
  r: number,
  tick: number,
): MeteorCraterFlatten {
  const grid = state.grid;
  const hx = hexIndex(grid.radius);
  const { terrain, height, deposit, prep } = grid.layers;
  const holeVariant = (grid.layers as { holeVariant?: Uint8Array }).holeVariant;
  const weather = getWeatherState(state);
  const recorded = findMeteorCraterAt(weather, q, r);
  const recordedLightning = Array.isArray(weather.lightningSites)
    ? weather.lightningSites.find(
        (s) => (s.q === q && s.r === r) || (Array.isArray(s.tiles) && s.tiles.some((t) => t.q === q && t.r === r)),
      )
    : undefined;
  const flooded = floodFillConnectedHoleTiles(grid.radius, q, r, terrain, MAX_CRATER_FLOOD_TILES);

  const coordMap = new Map<string, CraterCoord>();
  if (recorded) {
    for (const t of recorded.tiles) {
      if (hx.indexOf(t.q, t.r) >= 0) coordMap.set(`${t.q},${t.r}`, { q: t.q, r: t.r });
    }
  }
  if (recordedLightning) {
    for (const t of recordedLightning.tiles) {
      if (hx.indexOf(t.q, t.r) >= 0) coordMap.set(`${t.q},${t.r}`, { q: t.q, r: t.r });
    }
  }
  for (const t of flooded) {
    coordMap.set(`${t.q},${t.r}`, { q: t.q, r: t.r });
  }
  if (coordMap.size === 0 && hx.indexOf(q, r) >= 0) {
    coordMap.set(`${q},${r}`, { q, r });
  }

  const tiles = [...coordMap.values()];
  const craterIndices = new Set<number>();
  for (const t of tiles) {
    const idx = hx.indexOf(t.q, t.r);
    if (idx >= 0) craterIndices.add(idx);
  }

  const occupied = occupiedGroundTiles(state);
  const level = computeCraterJoinHeight(grid.radius, craterIndices, terrain, prep, height);
  const changed: number[] = [];
  let cleared = 0;

  for (const idx of craterIndices) {
    const isFixed = occupied.has(idx) || (deposit && deposit[idx] !== DEPOSIT.none);
    if (terrain[idx] === TERRAIN.hole || !isFixed) {
      setTileTerrain(grid, idx, TERRAIN.flat, tick);
      setTilePrep(grid, idx, PREP.prepared, tick);
      if (!isFixed) {
        setTileHeight(grid, idx, level, tick);
      }
      if (holeVariant) holeVariant[idx] = 0;
      cleared++;
      changed.push(idx);
    }
  }

  removeClearedAftermathSites(state, weather, q, r, coordMap, tick);

  return {
    count: cleared,
    tiles,
    revealed: revealAroundChanged(state, changed, tick),
  };
}
