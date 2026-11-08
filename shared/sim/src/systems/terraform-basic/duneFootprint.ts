import { hexDistance, hexIndex } from '../../grid/hex';
import { isHexTile, isOpenGround, joinPlaneHeight, type HexTileLayers } from '../../grid/hexTile';
import { DEPOSIT, PREP, TERRAIN, type DepositKey } from '../../grid/layers';
import { revealAroundChanged } from '../../grid/subsurface';
import { setTileHeight, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import type { PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';

/**
 * A dune is not its own terrain. Desert sand is `slope` over a height field, and one hex of that
 * does not move the mound (the renderer keeps the neighbouring slope vertices). A `work` job on
 * slope therefore clears every slope hex within {@link DUNE_RADIUS} (a 5-wide disc) in one step.
 * Rock, forest, water, holes, deposits and tiles under a building stay on their own jobs.
 */
export const DUNE_RADIUS = 2;

/** One disc takes this many times a single slope hex (`TERRAFORM_TIME_TABLE.slope` is unchanged). */
export const DUNE_TIME_MULT = 5;

export interface DuneCoord {
  q: number;
  r: number;
}

export interface DuneFlatten {
  count: number;
  revealed: Array<{ q: number; r: number; deposit: DepositKey; richnessBp: number }>;
}

/** Slope `work` lasts longer because it clears a disc, not one hex. Other ground keys are unchanged. */
export function scaleSlopeWork<T extends { terrainKey: string; durationTicks: number; energyCost: number }>(work: T): T {
  if (work.terrainKey !== 'slope') return work;
  return { ...work, durationTicks: work.durationTicks * DUNE_TIME_MULT, energyCost: work.energyCost * DUNE_TIME_MULT };
}

/** Every tile index of the 5-wide disc around `(q, r)` (the centre included) that exists on the planet. */
function discIndices(planetRadius: number, q: number, r: number, ring = 0): number[] {
  const hx = hexIndex(planetRadius);
  const reach = ring || DUNE_RADIUS;
  const out: number[] = [];
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dq = -reach; dq <= reach; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (ring ? d !== ring : d > reach) continue;
      const i = hx.indexOf(q + dq, r + dr);
      if (i >= 0) out.push(i);
    }
  }
  return out;
}

/**
 * Slope hexes a dune `work` job will clear around `(q, r)`, the centre included.
 * `planetRadius` is the planet, not the disc. Deposits are left for the extractor.
 */
export function duneWorkTiles(
  planetRadius: number,
  q: number,
  r: number,
  terrain: ArrayLike<number>,
  deposit?: ArrayLike<number> | null,
): DuneCoord[] {
  const hx = hexIndex(planetRadius);
  const out: DuneCoord[] = [];
  for (const i of discIndices(planetRadius, q, r)) {
    if (terrain[i] !== TERRAIN.slope) continue;
    if (deposit && deposit[i] !== DEPOSIT.none) continue;
    out.push({ q: hx.q[i]!, r: hx.r[i]! });
  }
  return out;
}

/** How far (rings beyond the disc) a dune pad looks for the level ground it joins. */
export const DUNE_PLANE_SEARCH_RINGS = 12;

/**
 * Height the disc is cut to (R4, `joinPlaneHeight`), so worked ground joins level ground instead of making a new step:
 *   1. the nearest hex tiles (a real level plane: the landing pad, the core of an earlier disc), searched ring by ring
 *      outwards from the disc edge, together with `fixed` open ground inside the disc (a building or deposit it keeps);
 *   2. none in reach: the open ground on the ring right outside the disc;
 *   3. nothing at all: the build plane (0), so the mound is gone.
 */
export function dunePadHeight(
  planetRadius: number,
  q: number,
  r: number,
  layers: HexTileLayers,
  fixed?: (i: number) => boolean,
): number {
  const { terrain, prep, height } = layers;
  const open = (i: number) => isOpenGround(terrain[i] ?? -1, prep?.[i] ?? 0);
  const inside = fixed ? discIndices(planetRadius, q, r).filter((i) => fixed(i) && open(i)).map((i) => height[i] ?? 0) : [];
  for (let ring = DUNE_RADIUS + 1; ring <= DUNE_RADIUS + DUNE_PLANE_SEARCH_RINGS; ring++) {
    const hex = discIndices(planetRadius, q, r, ring).filter((i) => isHexTile(planetRadius, i, layers));
    if (hex.length > 0) return joinPlaneHeight([...inside, ...hex.map((i) => height[i] ?? 0)])!;
  }
  const shoulder = discIndices(planetRadius, q, r, DUNE_RADIUS + 1).filter(open).map((i) => height[i] ?? 0);
  return joinPlaneHeight([...inside, ...shoulder]) ?? 0;
}

/**
 * Stamps the dune disc as one plane (R4): its slope hexes become Flat + prepared, and every other open-ground hex in
 * the disc (loose Flat sand, earlier pads) takes the same height, so no small step is left inside worked ground.
 * Buildings, deposits, rock, forest, water and holes keep their tiles. Returns how many dune hexes were cleared and the buried
 * deposits that became visible on the disc and beside it (`revealAroundChanged`: only on hex tiles).
 */
export function flattenDuneFootprint(state: PlanetState, q: number, r: number, tick: number): DuneFlatten {
  const grid = state.grid;
  const { terrain, height, deposit, prep } = grid.layers;
  const occupied = occupiedGroundTiles(state);
  const fixed = (i: number) => occupied.has(i) || deposit[i] !== DEPOSIT.none;
  const pad = dunePadHeight(grid.radius, q, r, { terrain, prep, height }, fixed);
  const changed: number[] = [];
  let cleared = 0;
  for (const i of discIndices(grid.radius, q, r)) {
    if (fixed(i)) continue;
    if (terrain[i] === TERRAIN.slope) {
      setTileTerrain(grid, i, TERRAIN.flat, tick);
      setTilePrep(grid, i, PREP.prepared, tick);
      cleared++;
    } else if (!isOpenGround(terrain[i]!, prep[i]!) || height[i] === pad) continue;
    setTileHeight(grid, i, pad, tick);
    changed.push(i);
  }
  // Reveal once the whole disc is level: only then are its inner tiles (and neighbours beside it) hex tiles.
  return { count: cleared, revealed: revealAroundChanged(state, changed, tick) };
}
