import { hexIndex, planeToAxial } from '@terra/sim/grid/hex';

/** Centre spacing of neighbouring tiles in metres (CLIENT §8). */
export const TILE_M = 2;
/** Tiles per chunk edge (axial q / r blocks). */
export const CHUNK_TILES = 32;

/** Tile centre in world metres (x, z); pointy-top rows, see `axialToPlane`. */
export const tileXZ = (q: number, r: number): [number, number] => [(q + r / 2) * TILE_M, (r * Math.sqrt(3) / 2) * TILE_M];

/** World xz → tile `{q, r, i}`, or null outside the planet. */
export function tileAt(radius: number, x: number, z: number): { q: number; r: number; i: number } | null {
  const [q, r] = planeToAxial(x / TILE_M, z / TILE_M);
  const i = hexIndex(radius).indexOf(q, r);
  return i < 0 ? null : { q, r, i };
}

/** Planet half-extents in metres: x (corner to corner) and z (flat to flat). */
export const planetExtent = (radius: number) => ({ x: radius * TILE_M, z: (radius * TILE_M * Math.sqrt(3)) / 2 });

/**
 * Ray → first hit on the height field: march in 1 m steps from `y` above the field to below it, then bisect.
 * Pure (no three.js) so it is unit-testable; `heightAt` is the same function the camera uses.
 */
export function rayGround(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, heightAt: (x: number, z: number) => number, maxT = 600): { x: number; y: number; z: number } | null {
  const h = (t: number) => o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
  if (h(0) <= 0) return null;
  let t0 = 0, t1 = -1;
  for (let t = 1; t <= maxT; t++) {
    const v = h(t);
    if (v <= 0) { t0 = t - 1; t1 = t; break; }
  }
  if (t1 < 0) return null;
  for (let k = 0; k < 20; k++) { const m = (t0 + t1) / 2; if (h(m) > 0) t0 = m; else t1 = m; }
  const t = (t0 + t1) / 2, x = o.x + d.x * t, z = o.z + d.z * t;
  return { x, y: heightAt(x, z), z };
}

/**
 * Where the ray meets the water surface (`y = level`) before it meets the ground `groundHit`, or null. The player
 * clicks the water they see, not the lakebed under it: with a grazing camera the two differ by more than a tile edge,
 * so a click on a lake hex must pick the hex whose surface is under the cursor (`isWater` tells which hexes have water).
 */
export function waterSurfaceHit(
  o: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  level: number,
  groundHit: { x: number; y: number; z: number } | null,
  isWater: (x: number, z: number) => boolean,
): { x: number; y: number; z: number } | null {
  if (d.y >= -1e-6 || o.y <= level) return null;
  const t = (level - o.y) / d.y;
  const x = o.x + d.x * t, z = o.z + d.z * t;
  if (groundHit) {
    const tg = (groundHit.x - o.x) * d.x + (groundHit.y - o.y) * d.y + (groundHit.z - o.z) * d.z; // distance along the (unit) ray
    if (tg < t - 1e-6) return null; // ground in front of the surface (a bank or ridge hides the water here)
  }
  return isWater(x, z) ? { x, y: level, z } : null;
}
