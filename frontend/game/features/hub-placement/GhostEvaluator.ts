import {
  ENTITY_KIND,
  evaluatePlacement,
  findPlacementSite,
  placementBlockText,
  placementRejectCode,
  PREP,
  TERRAIN,
  type ConstructionOrder,
  type PlacementBill,
  type PlacementBlock,
  type PlacementTile,
  type PlacementWorld,
  type PlanetState,
  type SimView,
  type ViewColony,
  type ViewEntity,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE, type ClientTiles, type ClientView } from '../../store/replica/viewCodec';

export type GhostSource = PlanetState | ClientView | SimView | GameView | null | undefined;

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
}

interface ExtractedEntity {
  id: number;
  kind: number;
  owner: number;
  q: number;
  r: number;
  hp: number;
  hpMax: number;
  state: number;
}

interface ExtractedWorld {
  radius: number;
  tileCount: number;
  terrain: Uint8Array | null;
  prep: Uint8Array | null;
  deposit: Uint8Array | null;
  owner: Int8Array | null;
  entities: ExtractedEntity[];
  orders: ConstructionOrder[];
}

function isPlanetState(src: unknown): src is PlanetState {
  return Boolean(
    src &&
      typeof src === 'object' &&
      'grid' in src &&
      typeof (src as PlanetState).grid?.radius === 'number' &&
      (src as PlanetState).grid?.layers,
  );
}

function extractOrdersFromBlobs(blobs?: Record<string, unknown>, colonyId?: number): ConstructionOrder[] {
  const raw = blobs?.constructionQueue as
    | { value?: unknown; orders?: ConstructionOrder[]; byColony?: Record<number, ConstructionOrder[]> }
    | ConstructionOrder[]
    | undefined;
  if (!raw) return [];
  const inner = (
    typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? raw.value : raw
  ) as { orders?: ConstructionOrder[]; byColony?: Record<number, ConstructionOrder[]> } | ConstructionOrder[];
  let list: ConstructionOrder[] = [];
  if (Array.isArray(inner)) {
    list = inner;
  } else if (inner && typeof inner === 'object') {
    if (colonyId !== undefined && Array.isArray(inner.byColony?.[colonyId])) {
      list = inner.byColony[colonyId];
    } else if (Array.isArray(inner.orders)) {
      list = inner.orders;
    }
  }
  return colonyId === undefined ? list : list.filter((o) => o.colonyId === colonyId);
}

function extractEntitiesFromView(
  rawEntities: Float32Array | ViewEntity[] | undefined,
  rawCount?: number,
): ExtractedEntity[] {
  if (!rawEntities) return [];
  const out: ExtractedEntity[] = [];
  if (rawEntities instanceof Float32Array) {
    const count = rawCount ?? Math.floor(rawEntities.length / ENTITY_STRIDE);
    for (let i = 0; i < count; i++) {
      const o = i * ENTITY_STRIDE;
      out.push({
        id: rawEntities[o],
        kind: rawEntities[o + 1],
        owner: rawEntities[o + 2],
        q: rawEntities[o + 3],
        r: rawEntities[o + 4],
        hp: rawEntities[o + 8],
        hpMax: rawEntities[o + 9],
        state: rawEntities[o + 10],
      });
    }
    return out;
  }
  if (Array.isArray(rawEntities)) {
    for (const e of rawEntities) {
      out.push({
        id: e.id,
        kind: e.kind,
        owner: e.owner,
        q: e.q,
        r: e.r,
        hp: e.hp,
        hpMax: e.hpMax,
        state: e.state,
      });
    }
  }
  return out;
}

function extractWorld(source: GhostSource, fallbackTiles?: ClientTiles | null): ExtractedWorld {
  if (isPlanetState(source)) {
    const e = source.entities;
    const c = e.cols;
    const entities: ExtractedEntity[] = [];
    for (let i = 0; i < e.count; i++) {
      entities.push({
        id: c.id[i],
        kind: c.kind[i],
        owner: c.owner[i],
        q: c.q[i],
        r: c.r[i],
        hp: c.hp[i],
        hpMax: c.hpMax[i],
        state: c.state[i],
      });
    }
    return {
      radius: source.grid.radius,
      tileCount: source.grid.count,
      terrain: source.grid.layers.terrain as Uint8Array,
      prep: source.grid.layers.prep as Uint8Array,
      deposit: (source.grid.layers.deposit as Uint8Array | undefined) ?? null,
      owner: source.grid.layers.owner as Int8Array,
      entities,
      orders: extractOrdersFromBlobs(source.blobs as unknown as Record<string, unknown>),
    };
  }

  const v = (source ?? {}) as {
    planet?: { radius?: number };
    tiles?: ClientTiles;
    entities?: Float32Array | ViewEntity[];
    count?: number;
    colonies?: ViewColony[];
    blobs?: Record<string, unknown>;
  };
  const tiles = v.tiles ?? fallbackTiles ?? null;
  return {
    radius: typeof v.planet?.radius === 'number' ? v.planet.radius : 12,
    tileCount: tiles?.count ?? 0,
    terrain: tiles?.terrain ?? null,
    prep: tiles?.prep ?? null,
    deposit: tiles?.deposit ?? null,
    owner: tiles?.owner ?? null,
    entities: extractEntitiesFromView(v.entities, v.count),
    orders: extractOrdersFromBlobs(v.blobs),
  };
}

/** Adapts any ghost source (authoritative state, replica view, local host view) into the shared `PlacementWorld`. */
export function ghostPlacementWorld(source: GhostSource, fallbackTiles?: ClientTiles | null): PlacementWorld {
  const w = extractWorld(source, fallbackTiles);
  const n = w.tileCount;
  return {
    radius: w.radius,
    tileCount: w.terrain && w.prep && w.owner ? n : 0,
    terrain: w.terrain ?? new Uint8Array(0),
    prep: w.prep ?? new Uint8Array(0),
    deposit: w.deposit,
    owner: w.owner ?? new Int8Array(0),
    entities: w.entities,
  };
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
export function computeGhostPrepBill(source: GhostSource, q: number, r: number, fallbackTiles?: ClientTiles | null): HubGhostBill {
  const world = ghostPlacementWorld(source, fallbackTiles);
  return evaluatePlacement(world, { colonyId: 0, q: Math.trunc(q), r: Math.trunc(r), requireBuilder: false }).bill;
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

/** Extracts active/pending construction orders for `colonyId` from a `GhostSource`. */
export function extractColonyConstructionOrders(
  source: GhostSource,
  colonyId = 0,
): ConstructionOrder[] {
  const world = extractWorld(source);
  return world.orders.filter((o) => o.colonyId === colonyId && o.status !== 'cancelled');
}

/** Nearest valid 3×3 Hub site to `colonyId`'s HQ (or pod), searched with the shared placement rules. */
export function findValidHubSiteNearHq(
  source: GhostSource,
  colonyId = 0,
  fallbackTiles?: ClientTiles | null,
): { q: number; r: number } | null {
  const world = ghostPlacementWorld(source, fallbackTiles);
  const hq = world.entities.find((e) => e.owner === colonyId && (e.kind === ENTITY_KIND.hq || e.kind === ENTITY_KIND.pod));
  return findPlacementSite(
    world,
    { colonyId, q: hq?.q ?? 0, r: hq?.r ?? 0, building: 'commandHub', requireBuilder: resolveRequireBuilder(world, colonyId) },
    5,
  );
}
