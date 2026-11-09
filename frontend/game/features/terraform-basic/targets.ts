import { duneWorkTiles, indexOf, meteorCraterWorkTiles, TERRAIN } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { TileCoord } from '../shared/pointer';
import { extractColonyOrders } from './TileOverlay';
import { colonyWorkJobs } from './workStatus';

/**
 * The colony's open terraform targets in the view: every hex with a queued or running job, from the host's terraform
 * queue (`blobs.terraformTasks`, one order per click) and from `work` jobs (`mode: 'terraform'`). `id` is what
 * `cancelTask` takes (the order id, or the work job id).
 */
export interface TerraformTarget extends TileCoord {
  id: string;
}

/**
 * Hexes a terraform marker should draw for `tile`. A slope hex is a dune disc (`duneWorkTiles`, the
 * same list the host clears); a hole hex in a meteor crater is the whole crater (`meteorCraterWorkTiles`).
 * Every other hex is just itself.
 */
export function slopeDiscOrTile(view: GameView | null | undefined, tile: TileCoord): TileCoord[] {
  const terrain = view?.tiles?.terrain;
  const radius = view?.planet?.radius;
  if (!terrain || typeof radius !== 'number') return [tile];
  const i = indexOf(radius, tile.q, tile.r);
  if (i < 0) return [tile];
  const t = terrain[i];
  if (t === TERRAIN.slope) {
    const disk = duneWorkTiles(radius, tile.q, tile.r, terrain, view.tiles?.deposit);
    return disk.length > 0 ? disk : [tile];
  }
  if (t === TERRAIN.hole) {
    const crater = meteorCraterWorkTiles(radius, tile.q, tile.r, terrain, view.blobs?.weather);
    return crater.length > 0 ? crater : [tile];
  }
  return [tile];
}

export function terraformTargets(view: GameView | null | undefined, colonyId: number): TerraformTarget[] {
  const out: TerraformTarget[] = [];
  const terrain = view?.tiles?.terrain;
  const radius = view?.planet?.radius;
  for (const o of extractColonyOrders(view, colonyId)) {
    for (const j of o.jobs) {
      const i = terrain && typeof radius === 'number' ? indexOf(radius, j.q, j.r) : -1;
      const expand = j.op === 'fill' || j.op === 'work' || (i >= 0 && terrain?.[i] === TERRAIN.hole);
      const tiles = expand ? slopeDiscOrTile(view, { q: j.q, r: j.r }) : [{ q: j.q, r: j.r }];
      for (const t of tiles) out.push({ q: t.q, r: t.r, id: o.orderId });
    }
  }
  for (const j of colonyWorkJobs(view, colonyId)) {
    if (j.mode !== 'terraform') continue;
    const expand = j.terrainKey === 'slope' || j.terrainKey === 'hole';
    const tiles = expand ? slopeDiscOrTile(view, { q: j.q, r: j.r }) : [{ q: j.q, r: j.r }];
    for (const t of tiles) out.push({ q: t.q, r: t.r, id: j.jobId });
  }
  return out;
}

/** The distinct hexes of {@link terraformTargets}. */
export function terraformTargetTiles(view: GameView | null | undefined, colonyId: number | TileCoord | string): TileCoord[] {
  if (typeof colonyId === 'object' && colonyId !== null && 'q' in colonyId && 'r' in colonyId) {
    return slopeDiscOrTile(view, colonyId);
  }
  if (typeof colonyId === 'string') {
    const [qStr, rStr] = colonyId.split(',');
    const q = Number(qStr);
    const r = Number(rStr);
    if (Number.isInteger(q) && Number.isInteger(r)) return slopeDiscOrTile(view, { q, r });
  }
  const seen = new Map<string, TileCoord>();
  for (const t of terraformTargets(view, Number(colonyId) || 0)) seen.set(`${t.q},${t.r}`, { q: t.q, r: t.r });
  return [...seen.values()];
}

/** Ids of the orders / jobs that target hex `(q, r)` (empty: the hex is not queued). */
export function terraformTargetIdsAt(view: GameView | null | undefined, colonyId: number, q: number, r: number): string[] {
  return [...new Set(terraformTargets(view, colonyId).filter((t) => t.q === q && t.r === r).map((t) => t.id))];
}
