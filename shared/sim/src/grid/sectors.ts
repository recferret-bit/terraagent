import { hexIndex } from './hex';

/**
 * Planet sectors (D-38): the hex grid cut into `SECTOR_TILES`×`SECTOR_TILES` axial blocks, indexed by a quadtree.
 * One index drives everything that should not scan the whole planet:
 *  - world generation runs its stages sector by sector, each sector seeded from its own stream;
 *  - `diffSince` only scans sectors stamped after `fromTick` (per-sector max `changedAt`, kept by every tile stamp);
 *  - spatial queries (landing zones, site search) walk the quadtree instead of every tile;
 *  - the client's render chunks are whole multiples of a sector (`CHUNK_TILES % SECTOR_TILES === 0`).
 * Geometry is cached per radius (not part of the planet state); stamps live beside the `changedAt` layer.
 */
export const SECTOR_TILES = 8;

export interface Sector {
  readonly id: number;
  /** Sector coordinates: floor(q / SECTOR_TILES), floor(r / SECTOR_TILES). */
  readonly sq: number;
  readonly sr: number;
  /** Tile indices in this sector, ascending. */
  readonly tiles: Int32Array;
}

interface QuadNode {
  x0: number; y0: number; x1: number; y1: number; // inclusive sector-coordinate bounds
  kids: QuadNode[] | null;
  ids: number[]; // leaf: sector ids
}

export interface SectorIndex {
  readonly radius: number;
  readonly size: number;
  readonly sectors: readonly Sector[];
  /** Tile index → sector id. */
  readonly sectorOfTile: Int32Array;
  /** Sector ids whose block intersects the axial rectangle [minQ, maxQ] × [minR, maxR] (quadtree walk). */
  query(minQ: number, minR: number, maxQ: number, maxR: number): number[];
  /** Sector ids that may hold a tile within hex distance `dist` of (q, r). */
  near(q: number, r: number, dist: number): number[];
}

const cache = new Map<string, SectorIndex>();
const LEAF = 4;

function buildTree(sectors: readonly Sector[], ids: number[], x0: number, y0: number, x1: number, y1: number): QuadNode {
  if (ids.length <= LEAF || (x0 === x1 && y0 === y1)) return { x0, y0, x1, y1, kids: null, ids };
  const mx = (x0 + x1) >> 1, my = (y0 + y1) >> 1;
  const boxes: Array<[number, number, number, number]> = [[x0, y0, mx, my], [mx + 1, y0, x1, my], [x0, my + 1, mx, y1], [mx + 1, my + 1, x1, y1]];
  const kids: QuadNode[] = [];
  for (const [a, b, c, d] of boxes) {
    if (a > c || b > d) continue;
    const sub = ids.filter((id) => sectors[id].sq >= a && sectors[id].sq <= c && sectors[id].sr >= b && sectors[id].sr <= d);
    if (sub.length) kids.push(buildTree(sectors, sub, a, b, c, d));
  }
  return { x0, y0, x1, y1, kids, ids: [] };
}

function walk(n: QuadNode, x0: number, y0: number, x1: number, y1: number, out: number[]): void {
  if (n.x1 < x0 || n.x0 > x1 || n.y1 < y0 || n.y0 > y1) return;
  if (!n.kids) { out.push(...n.ids); return; }
  for (const k of n.kids) walk(k, x0, y0, x1, y1, out);
}

/** Sector geometry + quadtree for a planet of `radius` (cached). */
export function sectorIndex(radius: number, size = SECTOR_TILES): SectorIndex {
  const key = `${radius}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const hx = hexIndex(radius);
  const byKey = new Map<string, number[]>();
  const sectorOfTile = new Int32Array(hx.count);
  for (let i = 0; i < hx.count; i++) {
    const k = `${Math.floor(hx.q[i] / size)},${Math.floor(hx.r[i] / size)}`;
    const list = byKey.get(k);
    if (list) list.push(i); else byKey.set(k, [i]);
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    const [aq, ar] = a.split(',').map(Number), [bq, br] = b.split(',').map(Number);
    return ar - br || aq - bq;
  });
  const sectors: Sector[] = keys.map((k, id) => {
    const [sq, sr] = k.split(',').map(Number);
    const tiles = Int32Array.from(byKey.get(k)!);
    for (const t of tiles) sectorOfTile[t] = id;
    return { id, sq, sr, tiles };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sectors) { x0 = Math.min(x0, s.sq); y0 = Math.min(y0, s.sr); x1 = Math.max(x1, s.sq); y1 = Math.max(y1, s.sr); }
  const root = buildTree(sectors, sectors.map((s) => s.id), x0, y0, x1, y1);
  const query = (minQ: number, minR: number, maxQ: number, maxR: number) => {
    const out: number[] = [];
    walk(root, Math.floor(minQ / size), Math.floor(minR / size), Math.floor(maxQ / size), Math.floor(maxR / size), out);
    return out.sort((a, b) => a - b);
  };
  const idx: SectorIndex = {
    radius, size, sectors, sectorOfTile, query,
    // |dq| ≤ dist and |dr| ≤ dist for every tile within hex distance `dist`, so the axial box is a superset.
    near: (q, r, dist) => query(q - dist, r - dist, q + dist, r + dist),
  };
  cache.set(key, idx);
  return idx;
}

/** Radius of a hex planet with `count` tiles (inverse of `hexCount`). */
export const radiusOfCount = (count: number): number => Math.round((-3 + Math.sqrt(9 + 12 * (count - 1))) / 6);

/** Per-sector max `changedAt`, keyed by the `changedAt` array itself (a restore makes a new array → rebuilt). */
const stamps = new WeakMap<ArrayLike<number>, { index: SectorIndex; max: Uint32Array }>();

function stampsOf(changedAt: ArrayLike<number>): { index: SectorIndex; max: Uint32Array } {
  let e = stamps.get(changedAt);
  if (!e) {
    const index = sectorIndex(radiusOfCount(changedAt.length));
    const max = new Uint32Array(index.sectors.length);
    for (let i = 0; i < changedAt.length; i++) {
      const s = index.sectorOfTile[i];
      if (changedAt[i] > max[s]) max[s] = changedAt[i];
    }
    e = { index, max };
    stamps.set(changedAt, e);
  }
  return e;
}

/**
 * Keeps the sector stamps in step with a tile stamp. Every writer of `layers.changedAt` calls this (`touchTile`,
 * `stampTile`, `applyDiff`); until the first `changedTileIndices` the stamps do not exist and a full scan builds them.
 */
export function noteTileStamp(changedAt: ArrayLike<number>, tileIdx: number, tick: number): void {
  const e = stamps.get(changedAt);
  if (!e) return;
  const s = e.index.sectorOfTile[tileIdx];
  if (s !== undefined && tick > e.max[s]) e.max[s] = tick;
}

export function noteTilesStamped(state: { grid: { layers: Record<string, ArrayLike<number>> } }, idx: ArrayLike<number>): void {
  const changedAt = state.grid.layers.changedAt;
  const e = stamps.get(changedAt);
  if (!e) return;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], s = e.index.sectorOfTile[i];
    if (changedAt[i] > e.max[s]) e.max[s] = changedAt[i];
  }
}

/** Tile indices stamped after `fromTick`, ascending; only sectors whose stamp is newer are scanned. */
export function changedTileIndices(state: { grid: { count: number; layers: Record<string, ArrayLike<number>> } }, fromTick: number): Uint32Array {
  const changedAt = state.grid.layers.changedAt;
  const { index, max } = stampsOf(changedAt);
  const out: number[] = [];
  for (const s of index.sectors) {
    if (max[s.id] <= fromTick) continue;
    for (const i of s.tiles) if (changedAt[i] > fromTick) out.push(i);
  }
  return Uint32Array.from(out.sort((a, b) => a - b));
}

/** Drops the sector stamps of a `changedAt` array after a bulk write (`fill`); the next query rebuilds them by a scan. */
export function forgetTileStamps(changedAt: ArrayLike<number>): void {
  stamps.delete(changedAt);
}
