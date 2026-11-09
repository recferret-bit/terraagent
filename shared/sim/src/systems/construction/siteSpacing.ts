import { axialToPlane, HEX_DIRS, hexIndex, planeToAxial } from '../../grid/hex';

/**
 * Natural base layout for the bot / auto-builder site pickers (goal breakdown, rule-engine autopilot).
 *
 * This is a SCORE for choosing among sites that `evaluatePlacement` already accepted (D-37); it never rejects a site and
 * is never used by `evaluatePlacement` or the player's ghost. Three parts:
 * - lane: a candidate keeps at least {@link LANE_GAP} hex steps to every other footprint (one free walkable tile between
 *   buildings). Prefer such sites, fall back to touching ones only when no lane site exists.
 * - target: each new building aims at a deterministic point around the hub whose angle (150-degree stepping) and distance
 *   (4..7 tiles) change with the number of buildings already there, so the base spreads out loosely, not in a clump.
 * - no randomness: the same state always gives the same answer, so a picker called every tick never flips its site.
 */

/** Minimum hex distance between footprints for a "lane": 2 leaves one free tile between two buildings. */
export const LANE_GAP = 2;
const BFS_CAP = 6;
/** 24 unit directions (15 degree steps) as a literal table: the sim must not call Math.sin / Math.cos (SIM-D-06). */
const DIRS_24: readonly (readonly [number, number])[] = [
  [1, 0], [0.9659, 0.2588], [0.866, 0.5], [0.7071, 0.7071], [0.5, 0.866], [0.2588, 0.9659],
  [0, 1], [-0.2588, 0.9659], [-0.5, 0.866], [-0.7071, 0.7071], [-0.866, 0.5], [-0.9659, 0.2588],
  [-1, 0], [-0.9659, -0.2588], [-0.866, -0.5], [-0.7071, -0.7071], [-0.5, -0.866], [-0.2588, -0.9659],
  [0, -1], [0.2588, -0.9659], [0.5, -0.866], [0.7071, -0.7071], [0.866, -0.5], [0.9659, -0.2588],
];
const FAR = 255;

/** Multi-source BFS: per-tile hex distance (capped, `255` = far) to the nearest tile of `blocked`. */
export function buildGapField(radius: number, blocked: Iterable<number>): Uint8Array {
  const idx = hexIndex(radius);
  const field = new Uint8Array(idx.count).fill(FAR);
  let frontier: number[] = [];
  for (const i of blocked) {
    if (i >= 0 && i < idx.count && field[i] !== 0) { field[i] = 0; frontier.push(i); }
  }
  for (let d = 1; d <= BFS_CAP && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const [dq, dr] of HEX_DIRS) {
        const n = idx.indexOf(idx.q[i] + dq, idx.r[i] + dr);
        if (n >= 0 && field[n] === FAR) { field[n] = d; next.push(n); }
      }
    }
    frontier = next;
  }
  return field;
}

/** Smallest gap between a footprint and the blocked tiles of `field` (the footprint's own tiles must not be blocked). */
export function footprintGap(field: Uint8Array, indices: readonly number[]): number {
  let gap = FAR;
  for (const i of indices) if (i >= 0 && field[i] < gap) gap = field[i];
  return gap;
}

/** Ranking tier of a gap: `0` keeps a walkable lane, `1` is crowded. Sort it before distance terms. */
export const laneTier = (gap: number): 0 | 1 => (gap >= LANE_GAP ? 0 : 1);

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

/**
 * Where building number `ordinal` of `colonyIndex` wants to stand around `anchor`: a hex 4..7 tiles out, at an angle
 * that walks round the hub by 150 degrees (plus a small stable jitter) so neighbours in build order face apart.
 */
export function organicTarget(anchor: { q: number; r: number }, colonyIndex: number, ordinal: number): { q: number; r: number } {
  const h = mix(colonyIndex + 1, ordinal);
  // Step 10/24 of a turn (150 degrees) per building: successive buildings land on opposite sides, then fill the gaps.
  const [ux, uy] = DIRS_24[(ordinal * 10 + (h % 3)) % 24];
  const dist = 4 + ((ordinal * 3 + (h >>> 10)) % 4);
  const [ax, ay] = axialToPlane(anchor.q, anchor.r);
  const [q, r] = planeToAxial(ax + ux * dist, ay + uy * dist);
  return { q, r };
}

/** Lexicographic compare of numeric rank keys (lower is better). */
export function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
