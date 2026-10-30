import type { PlanetType, SimView, ViewColony } from '@terra/sim';

/**
 * Entity buffer layout: `count` rows of `ENTITY_STRIDE` float32, per row in this order
 *   [0] id  [1] kind  [2] owner  [3] q  [4] r  [5] x  [6] y  [7] rot  [8] hp  [9] hpMax  [10] state  [11] progress
 * `id` is exact in float32 up to 2^24 (16,777,216 ids per planet). Entity ids are monotonic and never recycled, so a
 * planet that spawns past that needs a wider id column (an Int32 side buffer); `packEntities` throws instead of
 * silently corrupting.
 */
export const ENTITY_STRIDE = 12;
export const ENTITY_FIELDS = ['id', 'kind', 'owner', 'q', 'r', 'x', 'y', 'rot', 'hp', 'hpMax', 'state', 'progress'] as const;
export const MAX_EXACT_ID = 1 << 24;

/** Tile layers sent to the renderer (copies, never views of the replica state). */
export interface ClientTiles { count: number; terrain: Uint8Array; prep: Uint8Array; height: Float32Array; owner: Int8Array }

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
}

/** The structured-clone form: only plain data and ArrayBuffers (listed in `transfer`). */
export interface WireView {
  tick: number;
  planet: ClientView['planet'];
  tiles?: { count: number; terrain: ArrayBuffer; prep: ArrayBuffer; height: ArrayBuffer; owner: ArrayBuffer };
  entities: ArrayBuffer;
  count: number;
  colonies: ViewColony[];
}

export function packEntities(entities: SimView['entities']): Float32Array {
  const out = new Float32Array(entities.length * ENTITY_STRIDE);
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i], o = i * ENTITY_STRIDE;
    if (e.id >= MAX_EXACT_ID) throw new Error(`entity id ${e.id} exceeds float32 exact range`);
    out[o] = e.id; out[o + 1] = e.kind; out[o + 2] = e.owner; out[o + 3] = e.q; out[o + 4] = e.r; out[o + 5] = e.x;
    out[o + 6] = e.y; out[o + 7] = e.rot; out[o + 8] = e.hp; out[o + 9] = e.hpMax; out[o + 10] = e.state; out[o + 11] = e.progress;
  }
  return out;
}

const copy = <T extends Uint8Array | Int8Array | Float32Array>(a: T): T => a.slice() as T;

/** Packs a view; `withTiles` copies the tile layers (welcome / changed tiles), otherwise they are omitted. */
export function packView(v: SimView, withTiles: boolean): { view: WireView; transfer: ArrayBuffer[] } {
  const entities = packEntities(v.entities);
  const transfer: ArrayBuffer[] = [entities.buffer as ArrayBuffer];
  const view: WireView = { tick: v.tick, planet: v.planet, entities: entities.buffer as ArrayBuffer, count: v.entities.length, colonies: v.colonies };
  if (withTiles) {
    const t = v.tiles;
    const terrain = copy(t.terrain), prep = copy(t.prep), height = copy(t.height), owner = copy(t.owner);
    view.tiles = { count: t.count, terrain: terrain.buffer as ArrayBuffer, prep: prep.buffer as ArrayBuffer, height: height.buffer as ArrayBuffer, owner: owner.buffer as ArrayBuffer };
    transfer.push(view.tiles.terrain, view.tiles.prep, view.tiles.height, view.tiles.owner);
  }
  return { view, transfer };
}

export function unpackView(w: WireView, serverTimeMs?: number): ClientView {
  const out: ClientView = { tick: w.tick, planet: w.planet, entities: new Float32Array(w.entities), count: w.count, colonies: w.colonies };
  if (serverTimeMs !== undefined) out.serverTimeMs = serverTimeMs;
  if (w.tiles) {
    out.tiles = { count: w.tiles.count, terrain: new Uint8Array(w.tiles.terrain), prep: new Uint8Array(w.tiles.prep), height: new Float32Array(w.tiles.height), owner: new Int8Array(w.tiles.owner) };
  }
  return out;
}
