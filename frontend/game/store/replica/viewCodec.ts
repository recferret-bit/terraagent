import type { PlanetType, SimView, ViewColony, ViewEntity } from '@terra/sim';
import { renderViewBlobs } from './viewBlobs';

/**
 * Entity buffer layout: `count` rows of `ENTITY_STRIDE` float32, per row in this order
 *   [0] id  [1] kind  [2] owner  [3] q  [4] r  [5] x  [6] y  [7] rot  [8] hp  [9] hpMax  [10] state  [11] progress
 *   [12] tier (unit / building tier, 0 when the kind has none: Worker Drone T2 / T3 mesh, labels)
 * `id` is exact in float32 up to 2^24 (16,777,216 ids per planet). Entity ids are monotonic and never recycled, so a
 * planet that spawns past that needs a wider id column (an Int32 side buffer); `packEntities` throws instead of
 * silently corrupting.
 */
export const ENTITY_FIELDS = ['id', 'kind', 'owner', 'q', 'r', 'x', 'y', 'rot', 'hp', 'hpMax', 'state', 'progress', 'tier'] as const;
export const ENTITY_STRIDE = ENTITY_FIELDS.length;
export const MAX_EXACT_ID = 1 << 24;
export type EntityField = (typeof ENTITY_FIELDS)[number];

/** Column offsets inside one row, from `ENTITY_FIELDS`: `buf[i * ENTITY_STRIDE + E.hp]`. Never hard-code the numbers. */
export const E = Object.freeze(Object.fromEntries(ENTITY_FIELDS.map((f, i) => [f, i]))) as { readonly [K in EntityField]: number };

/** One entity row as plain numbers (the packed columns only). */
export type EntityRow = { [K in EntityField]: number };

/** Row `i` of a packed entity buffer, or of a `SimView`'s `ViewEntity[]` (headless hosts / tests pass those). */
export function readEntity(ents: Float32Array | readonly ViewEntity[], i: number): EntityRow {
  if (!(ents instanceof Float32Array)) {
    const e = ents[i];
    return { id: e.id, kind: e.kind, owner: e.owner, q: e.q, r: e.r, x: e.x, y: e.y, rot: e.rot, hp: e.hp, hpMax: e.hpMax, state: e.state, progress: e.progress, tier: e.tier ?? 0 };
  }
  const o = i * ENTITY_STRIDE;
  const row = {} as EntityRow;
  for (const f of ENTITY_FIELDS) row[f] = ents[o + E[f]];
  return row;
}

/** Number of rows in either entity form (`count` wins for a packed buffer when given). */
export const entityCount = (ents: Float32Array | readonly ViewEntity[] | undefined, count?: number): number =>
  !ents ? 0 : ents instanceof Float32Array ? (count ?? Math.floor(ents.length / ENTITY_STRIDE)) : ents.length;

/** Calls `fn` for every entity row; returning `false` stops the walk. */
export function forEachEntity(ents: Float32Array | readonly ViewEntity[] | undefined, count: number | undefined, fn: (row: EntityRow, i: number) => void | boolean): void {
  const n = entityCount(ents, count);
  for (let i = 0; i < n; i++) if (fn(readEntity(ents!, i), i) === false) return;
}

/** Tile layers sent to the renderer (copies, never views of the replica state). */
export interface ClientTiles {
  count: number;
  terrain: Uint8Array;
  prep: Uint8Array;
  height: Float32Array;
  owner: Int8Array;
  deposit?: Uint8Array;
  /** Tier of the visible deposit: 0 = legacy (tier 1), 1..3 explicit (sim `depositTier` layer). */
  depositTier?: Uint8Array;
  richness?: Float32Array;
  explored?: Uint8Array;
}

/** What the main thread sees. `tiles` is present on the first view after a welcome and whenever a tile changed. */
export interface ClientView {
  tick: number;
  /** Estimated server time at this tick (filled by `WorldStore`, not the worker). */
  serverTimeMs?: number;
  planet: { id: string; type: PlanetType; radius: number };
  tiles?: ClientTiles;
  entities: Float32Array;
  count: number;
  colonies: ViewColony[];
  blobs?: Record<string, unknown>;
  entityPower?: Record<number, ViewEntity['power']>;
  pylonLoads?: Record<number, ViewEntity['pylon']>;
}

/** The structured-clone form: only plain data and ArrayBuffers (listed in `transfer`). */
export interface WireView {
  tick: number;
  planet: ClientView['planet'];
  tiles?: {
    count: number;
    terrain: ArrayBuffer;
    prep: ArrayBuffer;
    height: ArrayBuffer;
    owner: ArrayBuffer;
    deposit?: ArrayBuffer;
    depositTier?: ArrayBuffer;
    richness?: ArrayBuffer;
    explored?: ArrayBuffer;
  };
  entities: ArrayBuffer;
  count: number;
  colonies: ViewColony[];
  blobs?: Record<string, unknown>;
  entityPower?: Record<number, ViewEntity['power']>;
  pylonLoads?: Record<number, ViewEntity['pylon']>;
}

export function packEntities(entities: SimView['entities']): Float32Array {
  const out = new Float32Array(entities.length * ENTITY_STRIDE);
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i], o = i * ENTITY_STRIDE;
    if (e.id >= MAX_EXACT_ID) throw new Error(`entity id ${e.id} exceeds float32 exact range`);
    for (const f of ENTITY_FIELDS) out[o + E[f]] = e[f] ?? 0;
  }
  return out;
}

const copy = <T extends Uint8Array | Int8Array | Float32Array>(a: T): T => a.slice() as T;

/** Packs a view; `withTiles` copies the tile layers (welcome / changed tiles), otherwise they are omitted. */
export function packView(v: SimView, withTiles: boolean): { view: WireView; transfer: ArrayBuffer[] } {
  const entities = packEntities(v.entities);
  const transfer: ArrayBuffer[] = [entities.buffer as ArrayBuffer];
  const entityPower: Record<number, ViewEntity['power']> = {};
  const pylonLoads: Record<number, ViewEntity['pylon']> = {};
  for (let i = 0; i < v.entities.length; i++) {
    const e = v.entities[i];
    if (e.power) entityPower[e.id] = e.power;
    if (e.pylon) pylonLoads[e.id] = e.pylon;
  }
  const hasPower = Object.keys(entityPower).length > 0;
  const hasPylon = Object.keys(pylonLoads).length > 0;
  const view: WireView = {
    tick: v.tick,
    planet: v.planet,
    entities: entities.buffer as ArrayBuffer,
    count: v.entities.length,
    colonies: v.colonies,
    blobs: renderViewBlobs(v.blobs),
    ...(hasPower ? { entityPower } : {}),
    ...(hasPylon ? { pylonLoads } : {}),
  };
  if (withTiles) {
    const t = v.tiles;
    const terrain = copy(t.terrain), prep = copy(t.prep), height = copy(t.height), owner = copy(t.owner);
    const deposit = t.deposit ? copy(t.deposit) : undefined;
    const depositTier = t.depositTier ? copy(t.depositTier) : undefined;
    const richness = t.richness ? copy(t.richness) : undefined;
    const explored = t.explored ? copy(t.explored) : undefined;
    view.tiles = {
      count: t.count,
      terrain: terrain.buffer as ArrayBuffer,
      prep: prep.buffer as ArrayBuffer,
      height: height.buffer as ArrayBuffer,
      owner: owner.buffer as ArrayBuffer,
      ...(deposit ? { deposit: deposit.buffer as ArrayBuffer } : {}),
      ...(depositTier ? { depositTier: depositTier.buffer as ArrayBuffer } : {}),
      ...(richness ? { richness: richness.buffer as ArrayBuffer } : {}),
      ...(explored ? { explored: explored.buffer as ArrayBuffer } : {}),
    };
    transfer.push(view.tiles.terrain, view.tiles.prep, view.tiles.height, view.tiles.owner);
  }
  return { view, transfer };
}

export function unpackView(w: WireView, serverTimeMs?: number): ClientView {
  const out: ClientView = {
    tick: w.tick,
    planet: w.planet,
    entities: new Float32Array(w.entities),
    count: w.count,
    colonies: w.colonies,
    blobs: w.blobs,
    ...(w.entityPower ? { entityPower: w.entityPower } : {}),
    ...(w.pylonLoads ? { pylonLoads: w.pylonLoads } : {}),
  };
  if (serverTimeMs !== undefined) out.serverTimeMs = serverTimeMs;
  if (w.tiles) {
    out.tiles = {
      count: w.tiles.count,
      terrain: new Uint8Array(w.tiles.terrain),
      prep: new Uint8Array(w.tiles.prep),
      height: new Float32Array(w.tiles.height),
      owner: new Int8Array(w.tiles.owner),
      ...(w.tiles.deposit ? { deposit: new Uint8Array(w.tiles.deposit) } : {}),
      ...(w.tiles.depositTier ? { depositTier: new Uint8Array(w.tiles.depositTier) } : {}),
      ...(w.tiles.richness ? { richness: new Float32Array(w.tiles.richness) } : {}),
      ...(w.tiles.explored ? { explored: new Uint8Array(w.tiles.explored) } : {}),
    };
  }
  return out;
}
