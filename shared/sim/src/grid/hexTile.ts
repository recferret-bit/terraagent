import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { HEX_DIRS, hexIndex, levelledFlatHeight } from './hex';

/**
 * HEX TILES: the one rule for where the hex grid exists (owner rule, 2026-11-06).
 *
 * The ground mesh puts one vertex at every tile centre, so the surface inside a tile's hexagon is shaped by the tile
 * AND its six neighbours: half of a Flat tile next to a dune lies on the dune's ramp. A hexagon is therefore only
 * level when its whole one-ring is level. That gives two kinds of ground and nothing in between:
 *
 *   R1  OPEN GROUND: terrain `flat`, or cleared prep (`prepared` / `irrigated` / `living`) on any terrain; never a
 *       `ridge` / `moat`. Trees, rock, dunes/slope, holes and water are obstacles, not open ground.
 *   R2  HEX TILE: an open-ground tile whose six neighbours all exist, are open ground, and sit at the same levelled
 *       height (`levelledFlatHeight`, within {@link HEX_LEVEL_EPS_M}). Its hexagon is one level plane.
 *   R3  Everything else is WILD ground: obstacles, hills, mountains, water, holes, ramps, the planet rim, and every
 *       tile that touches one of them.
 *   R4  Terraforming makes hex tiles: ground it levels takes the height of the plane it joins
 *       ({@link joinPlaneHeight}), so worked ground and the level ground beside it are one plane, never a small step.
 *
 * Who reads it (no other rule decides these):
 *   - the renderer draws hex grid lines only on hex tiles (both sides of a hex tile's edges);
 *   - a visible resource deposit only ever appears on a hex tile (world generation, spawn guarantees, subsurface
 *     reveal, terraform finds).
 * Building placement and unit movement keep their own rules (`isTileUneven`, `geoBuildBlock`, W05 linked prep), which
 * are wider than this one: a building may still be ordered onto wild ground that its linked prep will level.
 */

/** Two neighbouring levelled heights closer than this (metres) are the same level: the step cannot be seen. */
export const HEX_LEVEL_EPS_M = 0.05;

/** The tile layers the rule reads. `prep` may be missing (no prep layer: every tile is wild prep). */
export interface HexTileLayers {
  terrain: ArrayLike<number>;
  prep?: ArrayLike<number> | null;
  height: ArrayLike<number>;
}

/** R1: open ground (Flat, or cleared prep on any terrain; never a ridge or moat). */
export function isOpenGround(terrain: number, prep: number): boolean {
  if (prep === PREP_CODES.ridge || prep === PREP_CODES.moat) return false;
  if (prep === PREP_CODES.prepared || prep === PREP_CODES.irrigated || prep === PREP_CODES.living) return true;
  return terrain === TERRAIN_CODES.flat;
}

/** R2: whether tile `i` is a hex tile (open ground with a full, open, level one-ring). */
export function isHexTile(radius: number, i: number, layers: HexTileLayers): boolean {
  const { terrain, prep, height } = layers;
  if (i < 0 || !isOpenGround(terrain[i] ?? -1, prep?.[i] ?? 0)) return false;
  const hx = hexIndex(radius);
  if (i >= hx.count) return false;
  const h0 = levelledFlatHeight(height[i] ?? 0);
  const q = hx.q[i]!, r = hx.r[i]!;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j < 0 || !isOpenGround(terrain[j] ?? -1, prep?.[j] ?? 0)) return false;
    if (Math.abs(levelledFlatHeight(height[j] ?? 0) - h0) > HEX_LEVEL_EPS_M) return false;
  }
  return true;
}

/** R2 for every tile of the planet: 1 = hex tile, 0 = wild ground. Writes into `out` when given (length = tile count). */
export function hexTileMask(radius: number, layers: HexTileLayers, out?: Uint8Array): Uint8Array {
  const hx = hexIndex(radius);
  const mask = out ?? new Uint8Array(hx.count);
  for (let i = 0; i < hx.count; i++) mask[i] = isHexTile(radius, i, layers) ? 1 : 0;
  return mask;
}

/**
 * R4 (terraforming joins a plane): the height levelled ground takes so it is one plane with the ground around it.
 * `anchors` are the heights of the fixed open ground it borders. Heights within {@link HEX_LEVEL_EPS_M} (levelled) are
 * one plane; the plane most anchors share wins, the lower one on a tie. `null` when there is no anchor.
 */
export function joinPlaneHeight(anchors: readonly number[]): number | null {
  let best: number | null = null;
  let bestCount = 0;
  for (const h of anchors) {
    const lh = levelledFlatHeight(h);
    let count = 0;
    for (const o of anchors) if (Math.abs(levelledFlatHeight(o) - lh) <= HEX_LEVEL_EPS_M) count++;
    if (count > bestCount || (count === bestCount && best !== null && h < best)) {
      best = h;
      bestCount = count;
    }
  }
  return best;
}

/** Tile `i` and its existing neighbours: the tiles whose hex-tile state can change when tile `i` changes. */
export function hexTileRing(radius: number, i: number): number[] {
  const hx = hexIndex(radius);
  if (i < 0 || i >= hx.count) return [];
  const out = [i];
  const q = hx.q[i]!, r = hx.r[i]!;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j >= 0) out.push(j);
  }
  return out;
}
