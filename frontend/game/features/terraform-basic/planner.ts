import {
  enqueueAutoPrepares,
  evaluateTerraform,
  inHex,
  terraformJobKey,
  terraformWorldFrom,
  type CompiledDataLike,
  type TerraformOpKind,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { viewPlacementWorld } from '../shared/placementWorld';
import type { TileCoord } from '../shared/pointer';
import { extractColonyOrders } from './TileOverlay';

/** A brush always names one op; the host turns a multi-tile Grade into "prepare whatever each tile needs". */
export type BrushOpSelection = TerraformOpKind;

export interface PlannedTileJob {
  q: number;
  r: number;
  op: TerraformOpKind;
}

export interface BrushPlan {
  jobs: PlannedTileJob[];
  queuedCount: number;
  skippedCount: number;
}

/**
 * Computes all axial coordinates `(q, r)` in the rectangular box from `start` to `end`
 * in deterministic row-major order (`r` ascending, then `q` ascending).
 */
export function computeBoxTiles(start: TileCoord, end: TileCoord, radius?: number): TileCoord[] {
  const minQ = Math.min(Math.trunc(start.q), Math.trunc(end.q));
  const maxQ = Math.max(Math.trunc(start.q), Math.trunc(end.q));
  const minR = Math.min(Math.trunc(start.r), Math.trunc(end.r));
  const maxR = Math.max(Math.trunc(start.r), Math.trunc(end.r));
  const out: TileCoord[] = [];
  for (let r = minR; r <= maxR; r++) {
    for (let q = minQ; q <= maxQ; q++) {
      if (radius !== undefined && !inHex(q, r, radius)) continue;
      out.push({ q, r });
    }
  }
  return out;
}

/**
 * The host's `enqueueTask` rule for which op runs per tile: a Grade stroke over more than one tile prepares each tile
 * with what it needs (Grade / Clear / Break); any other stroke runs the named op only. Mirrors the one line in the sim
 * handler (`shared/sim/src/systems/terraform-basic/index.ts`), which does not export it; the parity spec guards it.
 */
/** The host's `enqueueTask` auto-prepare rule (the sim's own export, so client and host cannot drift). */
export const hostAutoPrepares = (op: TerraformOpKind, tileCount: number): boolean => enqueueAutoPrepares(op, tileCount);

/** Every `op:q,r` the colony already has queued in the view (the host skips those tiles: never worked twice). */
function pendingJobKeys(view: GameView | null | undefined, colonyId: number): Set<string> {
  const out = new Set<string>();
  for (const o of extractColonyOrders(view, colonyId)) for (const j of o.jobs) out.add(terraformJobKey(j.op, j.q, j.r));
  return out;
}

/**
 * Preview of a brush stroke over the replica view with the sim's own rule (`evaluateTerraform` over a read-only
 * `TerraformWorld`, the function the `enqueueTask` handler runs; D-37, FF-03): which tiles the host will queue and how
 * many it will skip. The host re-validates every tile; this only feeds the status line.
 */
export function planBrushStroke(
  view: GameView | null | undefined,
  tiles: readonly TileCoord[],
  opts: { op: BrushOpSelection; colonyId: number; data?: CompiledDataLike },
): BrushPlan {
  const placement = viewPlacementWorld(view);
  if (placement.tileCount === 0) return { jobs: [], queuedCount: 0, skippedCount: tiles.length };
  const plan = evaluateTerraform(terraformWorldFrom(placement, opts.colonyId, opts.data), {
    colonyId: opts.colonyId,
    op: opts.op,
    tiles,
    auto: hostAutoPrepares(opts.op, tiles.length),
    pending: pendingJobKeys(view, opts.colonyId),
    data: opts.data,
  });
  return { jobs: plan.jobs, queuedCount: plan.jobs.length, skippedCount: plan.skipped.length };
}
