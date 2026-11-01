import {
  constructionOrdersOf,
  ENTITY_KIND,
  evaluatePlacement,
  findPlacementSite,
  placementBlockText,
  placementRejectCode,
  PREP,
  TERRAIN,
  type CompiledDataLike,
  type ConstructionOrder,
  type PlacementBill,
  type PlacementBlock,
  type PlacementTile,
  type PlacementWorld,
} from '@terra/sim';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { isPlanetState, viewPlacementWorld, type WorldSource } from '../shared/placementWorld';

export type GhostSource = WorldSource;

/** Adapts any ghost source into the shared `PlacementWorld` (see `viewPlacementWorld`). */
export const ghostPlacementWorld = viewPlacementWorld;

/** Same shape as the sim's `PlacementBill` (one planner for client and server). */
export type HubGhostBill = PlacementBill;

export interface HubFootprintTileState {
  q: number;
  r: number;
  valid: boolean;
  reasonCode?: string;
  reasonText?: string;
  block?: PlacementBlock;
  terrain: number;
  prep: number;
  owner?: number;
}

export interface HubGhostState {
  active: boolean;
  q: number;
  r: number;
  valid: boolean;
  tint: 'valid' | 'invalid';
  reasonCode?: string;
  reasonText?: string;
  /** Machine cause (`trees`, `rock`, `deposit`, `water`, `foreign`, `occupied`, `hubExists`, …). */
  block?: PlacementBlock;
  footprintTiles: HubFootprintTileState[];
  bill: HubGhostBill;
}

export interface EvaluateHubGhostOptions {
  colonyId?: number;
  q?: number;
  r?: number;
  active?: boolean;
  requireHq?: boolean;
  fallbackTiles?: ClientTiles | null;
  /** The compiled balance data the host runs with (welcome flags + live overrides); defaults when absent (D-37). */
  data?: CompiledDataLike;
}

/** The `constructionQueue` blob value (`{ orders }`) of a sim state (`{ value, changedAt }` blobs) or a view (values). */
function constructionQueueOf(source: GhostSource): unknown {
  if (isPlanetState(source)) return source.blobs.constructionQueue?.value;
  return (source as { blobs?: Record<string, unknown> } | null | undefined)?.blobs?.constructionQueue;
}

/** Old semantics of `requireHq`: unset → require a landed HQ only once the colony has any entity on the map. */
function resolveRequireBuilder(world: PlacementWorld, colonyId: number, requireHq?: boolean): boolean {
  if (requireHq !== undefined) return requireHq;
  return world.entities.some((e) => e.owner === colonyId);
}

const toGhostTile = (t: PlacementTile): HubFootprintTileState => ({
  q: t.q,
  r: t.r,
  valid: t.ok,
  ...(t.block ? { reasonCode: placementRejectCode(t.block), reasonText: placementBlockText(t.block), block: t.block } : {}),
  terrain: t.block === 'outOfMap' ? TERRAIN.deep : t.terrain,
  prep: t.block === 'outOfMap' ? PREP.wild : t.prep,
  ...(t.block === 'outOfMap' ? {} : { owner: t.owner }),
});

/** Site preparation bill for the 3×3 Command Hub footprint at `(q, r)` (shared planner: same numbers the sim uses). */
export function computeGhostPrepBill(source: GhostSource, q: number, r: number, fallbackTiles?: ClientTiles | null, data?: CompiledDataLike): HubGhostBill {
  const world = ghostPlacementWorld(source, fallbackTiles);
  return evaluatePlacement(world, { colonyId: 0, q: Math.trunc(q), r: Math.trunc(r), requireBuilder: false, data }).bill;
}

/**
 * Evaluates the Command Hub placement ghost at `(q, r)` for `colonyId` with the shared `evaluatePlacement` (the same
 * function the `placeBuilding` handler runs on the server and in the browser-local host): validity, tint, reason, bill.
 */
export function evaluateHubGhost(
  source: GhostSource,
  colonyIdOrOpts: number | EvaluateHubGhostOptions = 0,
  qArg = 0,
  rArg = 0,
  extraOpts?: EvaluateHubGhostOptions,
): HubGhostState {
  const opts: EvaluateHubGhostOptions =
    typeof colonyIdOrOpts === 'number' ? { colonyId: colonyIdOrOpts, q: qArg, r: rArg, ...extraOpts } : colonyIdOrOpts;
  const colonyId = opts.colonyId ?? 0;
  const q = Math.trunc(opts.q ?? 0);
  const r = Math.trunc(opts.r ?? 0);
  const world = ghostPlacementWorld(source, opts.fallbackTiles);
  const res = evaluatePlacement(world, {
    colonyId,
    q,
    r,
    building: 'commandHub',
    requireBuilder: resolveRequireBuilder(world, colonyId, opts.requireHq),
    data: opts.data,
  });
  return {
    active: opts.active ?? true,
    q,
    r,
    valid: res.ok,
    tint: res.ok ? 'valid' : 'invalid',
    ...(res.block ? { reasonCode: res.code, reasonText: res.text, block: res.block } : {}),
    footprintTiles: res.tiles.map(toGhostTile),
    bill: res.bill,
  };
}

/** Open construction orders of `colonyId` in a `GhostSource` (completed and cancelled orders are left out). */
export function extractColonyConstructionOrders(
  source: GhostSource,
  colonyId = 0,
): ConstructionOrder[] {
  return constructionOrdersOf(constructionQueueOf(source), colonyId).filter((o) => o.status !== 'cancelled' && o.status !== 'completed');
}

/** How far (hex tiles) from the HQ the H key looks for a valid Hub site. */
export const HUB_SITE_SEARCH_RADIUS = 5;

/** Nearest valid 3×3 Hub site to `colonyId`'s HQ (or pod), searched with the shared placement rules. */
export function findValidHubSiteNearHq(
  source: GhostSource,
  colonyId = 0,
  fallbackTiles?: ClientTiles | null,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const world = ghostPlacementWorld(source, fallbackTiles);
  const hq = world.entities.find((e) => e.owner === colonyId && (e.kind === ENTITY_KIND.hq || e.kind === ENTITY_KIND.pod));
  return findPlacementSite(
    world,
    { colonyId, q: hq?.q ?? 0, r: hq?.r ?? 0, building: 'commandHub', requireBuilder: resolveRequireBuilder(world, colonyId), data },
    HUB_SITE_SEARCH_RADIUS,
  );
}
