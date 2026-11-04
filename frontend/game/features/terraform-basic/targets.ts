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

export function terraformTargets(view: GameView | null | undefined, colonyId: number): TerraformTarget[] {
  const out: TerraformTarget[] = [];
  for (const o of extractColonyOrders(view, colonyId)) for (const j of o.jobs) out.push({ q: j.q, r: j.r, id: o.orderId });
  for (const j of colonyWorkJobs(view, colonyId)) if (j.mode === 'terraform') out.push({ q: j.q, r: j.r, id: j.jobId });
  return out;
}

/** The distinct hexes of {@link terraformTargets}. */
export function terraformTargetTiles(view: GameView | null | undefined, colonyId: number): TileCoord[] {
  const seen = new Map<string, TileCoord>();
  for (const t of terraformTargets(view, colonyId)) seen.set(`${t.q},${t.r}`, { q: t.q, r: t.r });
  return [...seen.values()];
}

/** Ids of the orders / jobs that target hex `(q, r)` (empty: the hex is not queued). */
export function terraformTargetIdsAt(view: GameView | null | undefined, colonyId: number, q: number, r: number): string[] {
  return [...new Set(terraformTargets(view, colonyId).filter((t) => t.q === q && t.r === r).map((t) => t.id))];
}
