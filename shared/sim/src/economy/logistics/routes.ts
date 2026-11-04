import { findHexPath, type FindHexPathOptions } from '../../grid/path';
import type { GridLike } from '../../grid/tileModel';
import type { LogisticsNode, RouteTilesFn, TileRef } from './types';

/**
 * Route-length cache keyed by (node, tile, routeVersion). Bump `routeVersion` when terrain, roads or node set change:
 * older entries are then never read (and dropped), so affected assignments are recomputed. Caches `null` (unreachable) too.
 */
export class RouteCache {
  private readonly map = new Map<string, number | null>();
  private version: number;
  constructor(routeVersion: number, private readonly compute: (tile: TileRef, node: LogisticsNode) => number | null) { this.version = routeVersion; }

  get routeVersion(): number { return this.version; }
  get size(): number { return this.map.size; }

  invalidate(routeVersion: number): void {
    if (routeVersion === this.version) return;
    this.version = routeVersion;
    this.map.clear();
  }

  /** The `RouteTilesFn` for `evaluateLogistics`. */
  readonly routeTiles: RouteTilesFn = (entity, node) => {
    const key = `${node.id}|${entity.tile.q},${entity.tile.r}|${this.version}`;
    if (this.map.has(key)) return this.map.get(key) ?? null;
    const v = this.compute(entity.tile, node);
    this.map.set(key, v);
    return v;
  };
}

/** Route length (tiles) through the shared hex pathfinder; `null` when no passable path exists. No parallel pathfinder. */
export function pathRouteTiles(grid: GridLike, opts?: FindHexPathOptions): (tile: TileRef, node: LogisticsNode) => number | null {
  return (tile, node) => {
    const res = findHexPath(grid, { q: tile.q, r: tile.r }, { q: node.tile.q, r: node.tile.r }, opts);
    return res.ok ? Math.max(0, res.path.length - 1) : null;
  };
}
