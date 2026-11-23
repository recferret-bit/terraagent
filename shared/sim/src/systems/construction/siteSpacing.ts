import { isGroundMoveBlocked, isTileUneven } from '../../grid/geo';
import { axialToPlane, HEX_DIRS, hexIndex, planeToAxial } from '../../grid/hex';
import { TERRAIN } from '../../grid/layers';
import { isPassableTerrain } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { Grid, PlanetState } from '../../kernel/state';
import { buildingFootprints } from './occupancy';
import { occupiesGround } from './placement';

/**
 * Natural base layout for the bot / auto-builder site pickers (goal breakdown, rule-engine autopilot).
 *
 * This is a SCORE and passability filter for choosing among sites that `evaluatePlacement` already accepted (D-37);
 * it never changes `evaluatePlacement` itself or the player's ghost. Parts:
 * - lane: a candidate keeps at least {@link LANE_GAP} hex steps to every other footprint (one free walkable tile between
 *   buildings) and strongly prefers {@link WIDE_LANE_GAP} (2+ free tiles between buildings).
 * - passability: the 1-hex perimeter ring around a footprint must stay connected with enough walkable ground so units
 *   always have space to pass around and between buildings without pinched corridors.
 * - target: each new building aims at a deterministic point around the hub whose angle (150-degree stepping) and distance
 *   expand outward with the colony's building count, so the base spreads out loosely, not in a clump.
 * - no randomness: the same state always gives the same answer, so a picker called every tick never flips its site.
 */

/** Minimum hex distance between footprints for a walkable lane: 2 leaves one free tile between two buildings. */
export const LANE_GAP = 2;
/** Preferred spacious hex distance between footprints: 3 leaves two free tiles between buildings. */
export const WIDE_LANE_GAP = 3;
const BFS_CAP = 8;
/** 24 unit directions (15 degree steps) as a literal table: the sim must not call Math.sin / Math.cos (SIM-D-06). */
const DIRS_24: readonly (readonly [number, number])[] = [
  [1, 0], [0.9659, 0.2588], [0.866, 0.5], [0.7071, 0.7071], [0.5, 0.866], [0.2588, 0.9659],
  [0, 1], [-0.2588, 0.9659], [-0.5, 0.866], [-0.7071, 0.7071], [-0.866, 0.5], [-0.9659, 0.2588],
  [-1, 0], [-0.9659, -0.2588], [-0.866, -0.5], [-0.7071, -0.7071], [-0.5, -0.866], [-0.2588, -0.9659],
  [0, -1], [0.2588, -0.9659], [0.5, -0.866], [0.7071, -0.7071], [0.866, -0.5], [0.9659, -0.2588],
];
const FAR = 255;

export interface FootprintPassability {
  totalPerimeter: number;
  walkableCount: number;
  flatWalkableCount: number;
  impassableCount: number;
  roughCount: number;
  pinchesCorridor: boolean;
}

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

/**
 * Ranking tier of a gap:
 * - `0`: spacious boulevard (`gap >= WIDE_LANE_GAP`, 2+ free tiles between footprints)
 * - `1`: minimum walkable lane (`gap >= LANE_GAP`, 1 free tile)
 * - `2`: crowded / touching (`gap < LANE_GAP`)
 */
export const laneTier = (gap: number): 0 | 1 | 2 => (gap >= WIDE_LANE_GAP ? 0 : gap >= LANE_GAP ? 1 : 2);

/**
 * Evaluates unit passability around the 1-hex perimeter ring of `fpIndices`.
 * Marks `pinchesCorridor = true` when fewer than half the perimeter tiles are walkable OR when the walkable
 * perimeter ring splits into disconnected pockets (bridging obstacles/buildings and sealing off unit passage).
 */
export function evaluateFootprintPassability(
  grid: Grid,
  reserved: ReadonlySet<number>,
  fpIndices: readonly number[],
): FootprintPassability {
  const idx = hexIndex(grid.radius);
  const fpSet = new Set(fpIndices);
  const perimeterSet = new Set<number>();
  const oobCoords = new Set<string>();
  const walkableTiles: number[] = [];
  const walkableSet = new Set<number>();
  let flatWalkableCount = 0;
  const { terrain, prep, deposit, height } = grid.layers;
  const valid = (grid.layers as { valid?: ArrayLike<number> }).valid;

  for (const ti of fpIndices) {
    if (ti < 0 || ti >= grid.count) continue;
    const q = idx.q[ti]!;
    const r = idx.r[ti]!;
    for (const [dq, dr] of HEX_DIRS) {
      const nq = q + dq;
      const nr = r + dr;
      const n = idx.indexOf(nq, nr);
      if (n < 0) {
        oobCoords.add(`${nq},${nr}`);
        continue;
      }
      if (fpSet.has(n) || perimeterSet.has(n)) continue;
      perimeterSet.add(n);
      const inBounds = !valid || valid[n] !== 0;
      const dep = deposit ? deposit[n]! : 0;
      const walkable =
        inBounds &&
        !reserved.has(n) &&
        isPassableTerrain(terrain[n]!, prep[n]!) &&
        !isGroundMoveBlocked(terrain[n]!, dep) &&
        terrain[n] !== TERRAIN.shallow;
      if (!walkable) continue;
      walkableTiles.push(n);
      walkableSet.add(n);
      if (terrain[n] === TERRAIN.flat && !isTileUneven(grid.radius, n, terrain, height)) {
        flatWalkableCount++;
      }
    }
  }

  const totalPerimeter = perimeterSet.size + oobCoords.size;
  const walkableCount = walkableTiles.length;
  const impassableCount = totalPerimeter - walkableCount;
  const roughCount = walkableCount - flatWalkableCount;

  if (totalPerimeter === 0 || walkableCount === 0) {
    return { totalPerimeter, walkableCount, flatWalkableCount, impassableCount, roughCount, pinchesCorridor: true };
  }

  const visited = new Set<number>([walkableTiles[0]!]);
  const queue: number[] = [walkableTiles[0]!];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const cq = idx.q[cur]!;
    const cr = idx.r[cur]!;
    for (const [dq, dr] of HEX_DIRS) {
      const nb = idx.indexOf(cq + dq, cr + dr);
      if (nb >= 0 && walkableSet.has(nb) && !visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  const pinchesCorridor = walkableCount < Math.ceil(totalPerimeter * 0.4) || visited.size < walkableCount;
  return { totalPerimeter, walkableCount, flatWalkableCount, impassableCount, roughCount, pinchesCorridor };
}

/** Counts alive ground-occupying buildings of `colonyIndex` plus queued unspawned build orders. */
export function colonyBuildingOrdinal(state: PlanetState, colonyIndex: number, data?: CompiledDataLike): number {
  const { count, cols } = state.entities;
  let total = 0;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (occupiesGround({ kind: cols.kind[row], hp: cols.hp[row], hpMax: cols.hpMax[row] })) total++;
  }
  const entries = (
    state.blobs.queue?.value as
      | { entries?: ReadonlyArray<{ colonyIndex?: number; state?: string; lane?: string; entityId?: number; task?: { kind?: string } }> }
      | undefined
  )?.entries;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (
        e.colonyIndex === colonyIndex &&
        e.state !== 'done' &&
        e.state !== 'cancelled' &&
        e.task?.kind === 'build' &&
        e.entityId === undefined
      ) {
        total++;
      }
    }
  }
  return total > 0 ? total : buildingFootprints(state, data).length;
}

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

/**
 * Where building number `ordinal` of `colonyIndex` wants to stand around `anchor`: a hex 4..11 tiles out (expanding
 * outward as the colony grows), at an angle that walks round the hub by 150 degrees so neighbours face apart.
 */
export function organicTarget(anchor: { q: number; r: number }, colonyIndex: number, ordinal: number): { q: number; r: number } {
  const h = mix(colonyIndex + 1, ordinal);
  // Step 10/24 of a turn (150 degrees) per building: successive buildings land on opposite sides, then fill the gaps.
  const [ux, uy] = DIRS_24[(ordinal * 10 + (h % 3)) % 24];
  const ringBoost = Math.min(4, Math.floor(ordinal / 4) * 2);
  const dist = 4 + ((ordinal * 3 + (h >>> 10)) % 4) + ringBoost;
  const [ax, ay] = axialToPlane(anchor.q, anchor.r);
  const [q, r] = planeToAxial(ax + ux * dist, ay + uy * dist);
  return { q, r };
}

/** Lexicographic compare of numeric rank keys (lower is better). */
export function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
