import { HEX_DIRS, hexDistance, hexRound, type HexIndex } from '../../grid/hex';

/**
 * Stand tiles around one ordered hex, one per unit. Ring 0 is the anchor. Each later ring starts at `ring` steps
 * along `HEX_DIRS[0]` and walks six sides, `HEX_DIRS[(side + 2) % 6]`. Whole rings are collected until every unit
 * can have a tile, and the extra tiles on the last ring are left empty.
 * Each unit is matched to the tile that keeps its offset from the group centre, so a unit in the middle stays near
 * the anchor and a unit on the north edge stays on the north edge. Lowest id is seated first when tiles run out.
 * Nothing here moves a unit.
 */

export interface SlotAssignment {
  id: number;
  q: number;
  r: number;
}

export interface SlotUnit {
  id: number;
  q: number;
  r: number;
}

const MATCH_INF = 1_000_000_000;

export function ringCoords(q: number, r: number, ring: number): Array<[number, number]> {
  if (ring <= 0) return [[q, r]];
  const out: Array<[number, number]> = [];
  let cq = q + ring;
  let cr = r;
  for (let side = 0; side < 6; side++) {
    const [dq, dr] = HEX_DIRS[(side + 2) % 6];
    for (let step = 0; step < ring; step++) {
      out.push([cq, cr]);
      cq += dq;
      cr += dr;
    }
  }
  return out;
}

function candidateTiles(
  anchor: { q: number; r: number },
  count: number,
  isFree: (q: number, r: number) => boolean,
  opts: { maxRing?: number; inBounds?: (q: number, r: number) => boolean },
): Array<[number, number]> {
  const tiles: Array<[number, number]> = [];
  const maxRing = opts.maxRing ?? 32;
  for (let ring = 0; ring <= maxRing && tiles.length < count; ring++) {
    const ringTiles = ringCoords(anchor.q, anchor.r, ring);
    if (opts.inBounds && !ringTiles.some(([q, r]) => opts.inBounds!(q, r))) break;
    for (const [q, r] of ringTiles) if (isFree(q, r)) tiles.push([q, r]);
  }
  return tiles;
}

export function assignSlots(
  anchor: { q: number; r: number },
  units: readonly SlotUnit[],
  isFree: (q: number, r: number) => boolean,
  opts: { maxRing?: number; inBounds?: (q: number, r: number) => boolean } = {},
): { slots: SlotAssignment[]; overflow: number[] } {
  const ranked = [...units].sort((a, b) => a.id - b.id);
  const tiles = candidateTiles(anchor, ranked.length, isFree, opts);
  const seated = ranked.slice(0, tiles.length);
  const overflow = ranked.slice(tiles.length).map((unit) => unit.id);
  if (seated.length === 0) return { slots: [], overflow };
  return { slots: matchFormation(anchor, seated, tiles), overflow };
}

function matchFormation(
  anchor: { q: number; r: number },
  units: readonly SlotUnit[],
  tiles: readonly (readonly [number, number])[],
): SlotAssignment[] {
  const columnOf = hungarian(offsetCosts(anchor, units, tiles));
  const slots: SlotAssignment[] = [];
  for (let i = 0; i < units.length; i++) {
    const tile = tiles[columnOf[i]];
    slots.push({ id: units[i].id, q: tile[0], r: tile[1] });
  }
  return slots;
}

/** Scaled axial offset from the group centre, matched to the same offset from the anchor. Extra rows are unused tiles. */
function offsetCosts(
  anchor: { q: number; r: number },
  units: readonly SlotUnit[],
  tiles: readonly (readonly [number, number])[],
): number[][] {
  const n = units.length;
  const m = tiles.length;
  let sumQ = 0;
  let sumR = 0;
  for (const unit of units) {
    sumQ += unit.q;
    sumR += unit.r;
  }
  const scale = m + 1;
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const uq = units[i].q * n - sumQ;
    const ur = units[i].r * n - sumR;
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      const dq = uq - (tiles[j][0] - anchor.q) * n;
      const dr = ur - (tiles[j][1] - anchor.r) * n;
      const hex = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
      row.push(hex * scale + j);
    }
    matrix.push(row);
  }
  for (let i = n; i < m; i++) matrix.push(new Array<number>(m).fill(0));
  return matrix;
}

/** Square min-cost assignment. Row `i` receives column `assignment[i]`. The last rows may be unused-tile fillers. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(MATCH_INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = MATCH_INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = new Array<number>(n).fill(0);
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  return assignment;
}

/** Neighbour steps from `from` to `to`. The nudge keeps a hex edge from rounding either way. */
export function hexLine(from: { q: number; r: number }, to: { q: number; r: number }): Array<{ q: number; r: number }> {
  const n = hexDistance(from.q, from.r, to.q, to.r);
  if (n === 0) return [{ q: from.q, r: from.r }];
  const out: Array<{ q: number; r: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [q, r] = hexRound(from.q + (to.q - from.q) * t + 1e-6, from.r + (to.r - from.r) * t + 1e-6);
    out.push({ q, r });
  }
  return out;
}

function clearHexLine(
  from: { q: number; r: number },
  to: { q: number; r: number },
  passable: (q: number, r: number) => boolean,
): Array<{ q: number; r: number }> | null {
  const line = hexLine(from, to);
  const end = line[line.length - 1];
  if (!end || end.q !== to.q || end.r !== to.r || line.length !== hexDistance(from.q, from.r, to.q, to.r) + 1) return null;
  for (let i = 1; i < line.length; i++) {
    if (hexDistance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r) !== 1) return null;
    if (i < line.length - 1 && !passable(line[i].q, line[i].r)) return null;
  }
  return line;
}

/** Straight neighbour path when the ground is open, otherwise the disk search. `null` when `to` cannot be reached. */
export function seatingPath(
  idx: HexIndex,
  from: { q: number; r: number },
  to: { q: number; r: number },
  center: { q: number; r: number },
  radius: number,
  blocked: (tileIdx: number) => boolean,
): Array<{ q: number; r: number }> | null {
  const line = clearHexLine(from, to, (q, r) => {
    const tile = idx.indexOf(q, r);
    return tile >= 0 && !blocked(tile);
  });
  if (line) return line;
  return diskPath(idx, from, to, center, radius, blocked);
}

/**
 * Leave `corridor` (a walk toward the anchor) at the closest tile that still has a clear line to `slot`.
 * `null` when every such line is blocked, so the caller can walk the corridor to the end and search inside the disk.
 */
export function leaveCorridor(
  corridor: readonly { q: number; r: number }[],
  slot: { q: number; r: number },
  passable: (q: number, r: number) => boolean,
): Array<{ q: number; r: number }> | null {
  if (corridor.length === 0) return null;
  let best = 0;
  let bestDist = hexDistance(corridor[0].q, corridor[0].r, slot.q, slot.r);
  for (let i = 1; i < corridor.length; i++) {
    const dist = hexDistance(corridor[i].q, corridor[i].r, slot.q, slot.r);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  for (let i = best; i < corridor.length; i++) {
    const line = clearHexLine(corridor[i], slot, passable);
    if (line) return corridor.slice(0, i).concat(line);
  }
  return null;
}

/** Breadth-first path inside the disk, directions in `HEX_DIRS` order. `null` when `to` cannot be reached. */
export function diskPath(
  idx: HexIndex,
  from: { q: number; r: number },
  to: { q: number; r: number },
  center: { q: number; r: number },
  radius: number,
  blocked: (tileIdx: number) => boolean,
): Array<{ q: number; r: number }> | null {
  const start = idx.indexOf(from.q, from.r);
  const goal = idx.indexOf(to.q, to.r);
  if (start < 0 || goal < 0) return null;
  if (hexDistance(to.q, to.r, center.q, center.r) > radius) return null;
  if (start === goal) return [{ q: from.q, r: from.r }];
  const prev = new Int32Array(idx.count).fill(-1);
  const queue: number[] = [start];
  prev[start] = start;
  let found = false;
  for (let head = 0; head < queue.length && !found; head++) {
    const i = queue[head];
    const cq = idx.q[i];
    const cr = idx.r[i];
    for (let d = 0; d < 6; d++) {
      const nq = cq + HEX_DIRS[d][0];
      const nr = cr + HEX_DIRS[d][1];
      if (hexDistance(nq, nr, center.q, center.r) > radius) continue;
      const ni = idx.indexOf(nq, nr);
      if (ni < 0 || prev[ni] !== -1) continue;
      if (ni !== goal && blocked(ni)) continue;
      prev[ni] = i;
      queue.push(ni);
      if (ni === goal) found = true;
    }
  }
  if (prev[goal] === -1) return null;
  const rev: Array<{ q: number; r: number }> = [];
  for (let i = goal; ; i = prev[i]) {
    rev.push({ q: idx.q[i], r: idx.r[i] });
    if (i === start) break;
  }
  rev.reverse();
  return rev;
}
