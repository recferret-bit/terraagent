import terrainTable from '../data/terrain';
import { decodeValue } from '../codec/values';
import type { EngineDiff } from '../host/diff';
import { noteTileStamp } from './sectors';
import type { CompiledDataLike } from '../kernel/config';
import type { Grid, PlanetMeta, PlanetState } from '../kernel/state';
import type { TypedArray } from '../kernel/types';
import {
  DEPOSIT,
  PREP,
  TERRAIN,
  tileLayers,
  type DepositCode,
  type DepositKey,
  type PrepCode,
  type PrepKey,
  type TerrainCode,
  type TerrainKey,
} from './layers';

export { DEPOSIT, PREP, TERRAIN, type DepositCode, type DepositKey, type PrepCode, type PrepKey, type TerrainCode, type TerrainKey };

export interface TileLayersLike {
  count?: number;
  terrain: Uint8Array;
  prep: Uint8Array;
  deposit?: Uint8Array;
  richness?: Float32Array;
  height?: Float32Array;
  owner?: Int8Array;
  explored?: Uint8Array;
  anchors?: Uint8Array;
  graceUntil?: Float64Array;
  changedAt?: Uint32Array;
  [layer: string]: TypedArray | ArrayLike<number> | number | undefined;
}

export type GridLike = PlanetState | Grid | TileLayersLike;

/**
 * Key ↔ code converters of one enum table (XC-13): `keys[code]` is the canonical key, `idFromKey` is case-insensitive and
 * throws on an unknown key, `keyFromId` throws `RangeError` on a code outside the table. Public API for clients and
 * tools that label or parse a layer value (data keys, dev commands).
 */
function keyCodec<K extends string, C extends number>(what: string, table: Readonly<Record<K, C>>) {
  const keys = (Object.keys(table) as K[]).sort((a, b) => table[a] - table[b]);
  keys.forEach((k, i) => { if (table[k] !== i) throw new Error(`${what} codes must be 0..${keys.length - 1}`); });
  return {
    keys: keys as readonly K[],
    idFromKey(key: K | string): C {
      const idx = keys.indexOf(key.toLowerCase() as K);
      if (idx < 0) throw new Error(`unknown ${what} key "${key}"`);
      return idx as C;
    },
    keyFromId(id: number): K {
      if (!Number.isInteger(id) || id < 0 || id >= keys.length) throw new RangeError(`invalid ${what} id ${String(id)}`);
      return keys[id];
    },
  };
}

const terrainCodec = keyCodec<TerrainKey, TerrainCode>('terrain', TERRAIN);
const prepCodec = keyCodec<PrepKey, PrepCode>('prep', PREP);
const depositCodec = keyCodec<DepositKey, DepositCode>('deposit', DEPOSIT);

export const TERRAIN_KEYS: readonly TerrainKey[] = terrainCodec.keys;
export const PREP_KEYS: readonly PrepKey[] = prepCodec.keys;
export const DEPOSIT_KEYS: readonly DepositKey[] = depositCodec.keys;

/** Terrain key (`'flat' | 'forest' | ...`, case-insensitive) → `TERRAIN` code; throws on an unknown key. */
export const terrainIdFromKey = terrainCodec.idFromKey;
/** `TERRAIN` code → canonical key; `RangeError` outside the table. */
export const terrainKeyFromId = terrainCodec.keyFromId;
/** Prep key (`'wild' | 'flat' | 'prepared' | ...`, case-insensitive) → `PREP` code; throws on an unknown key. */
export const prepIdFromKey = prepCodec.idFromKey;
/** `PREP` code → canonical key; `RangeError` outside the table. */
export const prepKeyFromId = prepCodec.keyFromId;
/** Deposit key (`'none' | 'metals' | 'minerals' | 'oil'`, case-insensitive) → `DEPOSIT` code; throws on an unknown key. */
export const depositIdFromKey = depositCodec.idFromKey;
/** `DEPOSIT` code → canonical key; `RangeError` outside the table. */
export const depositKeyFromId = depositCodec.keyFromId;

interface TerrainClassDefaults {
  readonly code: TerrainCode;
  readonly key: TerrainKey;
  readonly passable: boolean;
  readonly moveMultBp: number;
}

const DEFAULT_TERRAIN_BY_CODE: readonly TerrainClassDefaults[] = TERRAIN_KEYS.map((key, code) => {
  const row = terrainTable.rows.find((r) => r.id === key);
  const moveMult = typeof row?.moveMult === 'number' ? row.moveMult : 0;
  const passable = typeof row?.passable === 'boolean' ? row.passable : moveMult > 0;
  return {
    code: code as TerrainCode,
    key,
    passable,
    moveMultBp: Math.round(moveMult * 10000),
  };
});

const DEFAULT_LIVING_MOVE_BP = (() => {
  const row = terrainTable.rows.find((r) => r.id === 'temperate');
  const mult = typeof row?.livingMoveMult === 'number' ? row.livingMoveMult : 1.1;
  return Math.round(mult * 10000);
})();

const gridMetaMap = new WeakMap<object, PlanetMeta>();

/** Associates a `Grid` and its `layers` with the owning `PlanetMeta` so tile mutations know the current tick. */
export function linkGridMeta(grid: Grid, meta: PlanetMeta): void {
  gridMetaMap.set(grid, meta);
  gridMetaMap.set(grid.layers, meta);
  for (const l of tileLayers()) {
    if (!Object.prototype.hasOwnProperty.call(grid, l.name)) {
      Object.defineProperty(grid, l.name, {
        get: () => grid.layers[l.name],
        enumerable: false,
        configurable: true,
      });
    }
  }
}

/** The layers, tile count and (if linked) planet meta behind any grid shape. */
export function resolveTileLayers(src: GridLike): { layers: TileLayersLike; count: number; meta?: PlanetMeta } {
  if ('grid' in src && 'meta' in src) {
    const state = src as PlanetState;
    return { layers: state.grid.layers as unknown as TileLayersLike, count: state.grid.count, meta: state.meta };
  }
  if ('layers' in src && typeof src.count === 'number') {
    const grid = src as Grid;
    return {
      layers: grid.layers as unknown as TileLayersLike,
      count: grid.count,
      meta: gridMetaMap.get(grid) ?? gridMetaMap.get(grid.layers),
    };
  }
  const direct = src as TileLayersLike;
  const count = typeof direct.count === 'number' ? direct.count : direct.terrain.length;
  return { layers: direct, count, meta: gridMetaMap.get(direct) };
}

/** Returns `true` when `tileIdx` is an integer within `[0, count)`. */
export function isValidTileIndex(grid: GridLike, tileIdx: number): boolean {
  if (!Number.isInteger(tileIdx) || tileIdx < 0) return false;
  return tileIdx < resolveTileLayers(grid).count;
}

function lookupTerrainConfig(terrainCode: number, data?: CompiledDataLike): { passable: boolean; moveMultBp: number } {
  const def = DEFAULT_TERRAIN_BY_CODE[terrainCode];
  if (!def) return { passable: false, moveMultBp: 0 };
  const terrainRows = data?.tables.terrain as Record<string, Record<string, unknown>> | undefined;
  const row = terrainRows?.[def.key];
  if (!row) return { passable: def.passable, moveMultBp: def.moveMultBp };
  const moveMult = typeof row.moveMult === 'number' ? row.moveMult : def.moveMultBp / 10000;
  const passable = typeof row.passable === 'boolean' ? row.passable : def.passable;
  return { passable, moveMultBp: Math.round(moveMult * 10000) };
}

function lookupLivingMoveBp(data?: CompiledDataLike): number {
  const terrainRows = data?.tables.terrain as Record<string, Record<string, unknown>> | undefined;
  const row = terrainRows?.temperate;
  if (typeof row?.livingMoveMult === 'number') return Math.round(row.livingMoveMult * 10000);
  return DEFAULT_LIVING_MOVE_BP;
}

/**
 * Pure movement multiplier in basis points (`10000 = 1.0x`) for a `(terrainCode, prepCode)` pair (§4.8 `UO-W`, `UO-TF-07`).
 * Returns `0` when impassable to ground units (Deep water, Ridge wall, Moat wall).
 */
export function terrainMoveMultiplierBp(terrainCode: number, prepCode: number = PREP.wild, data?: CompiledDataLike): number {
  if (prepCode === PREP.ridge || prepCode === PREP.moat) return 0;
  const cfg = lookupTerrainConfig(terrainCode, data);
  if (!cfg.passable) return 0;
  if (prepCode === PREP.living) return lookupLivingMoveBp(data);
  if (prepCode === PREP.prepared || prepCode === PREP.irrigated || prepCode === PREP.flat) return 10000;
  return cfg.moveMultBp;
}

/**
 * Returns `true` if ground units and ground fauna can enter `tileIdx` (§4.8 `UO-W`).
 * Deep water (`TERRAIN.deep`), raised walls (`PREP.ridge`), and dug moats (`PREP.moat`) are impassable.
 */
export function isGroundPassable(grid: GridLike, tileIdx: number, data?: CompiledDataLike): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveTileLayers(grid);
  return terrainMoveMultiplierBp(layers.terrain[tileIdx], layers.prep[tileIdx], data) > 0;
}

/**
 * Ground movement speed multiplier in basis points (`10000 = 1.0x`, `11000 = 1.1x` on Living, `0` if impassable).
 */
export function groundMoveMultiplierBp(grid: GridLike, tileIdx: number, data?: CompiledDataLike): number {
  if (!isValidTileIndex(grid, tileIdx)) return 0;
  const { layers } = resolveTileLayers(grid);
  return terrainMoveMultiplierBp(layers.terrain[tileIdx], layers.prep[tileIdx], data);
}

/** Returns `true` if `tileIdx` is a raised Ridge wall that blocks direct ground fire (`UO-W-02`; kept for the combat wave). */
export function blocksDirectFire(grid: GridLike, tileIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveTileLayers(grid);
  return layers.prep[tileIdx] === PREP.ridge;
}

/**
 * Returns `true` iff `tileIdx` is valid buildable ground (`PREP.prepared` or `PREP.living` and not Deep water, `UO-TF-01`).
 */
export function isBuildablePrepared(grid: GridLike, tileIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveTileLayers(grid);
  if (layers.terrain[tileIdx] === TERRAIN.deep) return false;
  const prep = layers.prep[tileIdx];
  return prep === PREP.prepared || prep === PREP.living;
}

/** Ground passability may have changed (see `PlanetMeta.pathEpoch`). */
export function bumpPathEpoch(meta: PlanetMeta | undefined): void {
  if (meta) meta.pathEpoch = (meta.pathEpoch ?? 0) + 1;
}

function stampTile(layers: TileLayersLike, meta: PlanetMeta | undefined, tileIdx: number, tick?: number): void {
  if (!layers.changedAt) return;
  if (tick !== undefined) {
    layers.changedAt[tileIdx] = tick;
    noteTileStamp(layers.changedAt, tileIdx, tick);
    return;
  }
  const baseTick = meta ? meta.tick + 1 : 1;
  const nextStamp = Math.max(baseTick, (layers.changedAt[tileIdx] ?? 0) + 1);
  layers.changedAt[tileIdx] = nextStamp;
  noteTileStamp(layers.changedAt, tileIdx, nextStamp);
}

/** Sets a tile's `prep` state (`PREP.*`) and stamps `changedAt` so the next delta carries the change. */
export function setTilePrep(grid: GridLike, tileIdx: number, prep: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveTileLayers(grid);
  if (layers.prep[tileIdx] !== prep) bumpPathEpoch(meta);
  layers.prep[tileIdx] = prep;
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `terrain` class (`TERRAIN.*`) and stamps `changedAt` so the next delta carries the change. */
export function setTileTerrain(grid: GridLike, tileIdx: number, terrain: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveTileLayers(grid);
  if (layers.terrain[tileIdx] !== terrain) bumpPathEpoch(meta);
  layers.terrain[tileIdx] = terrain;
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `owner` colony index (`-1` for unclaimed) and stamps `changedAt`. */
export function setTileOwner(grid: GridLike, tileIdx: number, owner: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveTileLayers(grid);
  if (layers.owner) layers.owner[tileIdx] = owner;
  stampTile(layers, meta, tileIdx, tick);
}

/**
 * Sets a tile's `deposit` kind (`DEPOSIT.*`), optional `richness` and its `depositTier` (`0` = legacy tier 1, `1..3`;
 * always `0` without a deposit), stamping `changedAt`.
 */
export function setTileDeposit(grid: GridLike, tileIdx: number, deposit: number, richness?: number, tick?: number, tier = 0): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveTileLayers(grid);
  if (layers.deposit && layers.deposit[tileIdx] !== deposit) bumpPathEpoch(meta);
  if (layers.deposit) layers.deposit[tileIdx] = deposit;
  const tiers = layers.depositTier as Uint8Array | undefined;
  if (tiers) tiers[tileIdx] = deposit === DEPOSIT.none ? 0 : tier;
  if (layers.richness) {
    if (richness !== undefined) {
      layers.richness[tileIdx] = richness;
    } else if (deposit !== DEPOSIT.none && (layers.richness[tileIdx] ?? 0) <= 0) {
      layers.richness[tileIdx] = 10000;
    } else if (deposit === DEPOSIT.none) {
      layers.richness[tileIdx] = 0;
    }
  }
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `height` (metres above the build plane) and stamps `changedAt`. */
export function setTileHeight(grid: GridLike, tileIdx: number, height: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveTileLayers(grid);
  if (layers.height && layers.height[tileIdx] !== height) bumpPathEpoch(meta);
  if (layers.height) layers.height[tileIdx] = height;
  stampTile(layers, meta, tileIdx, tick);
}

/** Marks `tileIdx` as explored by `colonyIdx` (sets bit `1 << colonyIdx` on `explored`) and stamps `changedAt`. */
export function markTileExplored(grid: GridLike, tileIdx: number, colonyIdx: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx) || colonyIdx < 0 || colonyIdx >= 8) return;
  const { layers, meta } = resolveTileLayers(grid);
  if (layers.explored) layers.explored[tileIdx] |= 1 << colonyIdx;
  stampTile(layers, meta, tileIdx, tick);
}

/** Returns `true` if `colonyIdx` has explored `tileIdx` (`(explored & (1 << colonyIdx)) !== 0`). */
export function isTileExplored(grid: GridLike, tileIdx: number, colonyIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx) || colonyIdx < 0 || colonyIdx >= 8) return false;
  const { layers } = resolveTileLayers(grid);
  return ((layers.explored?.[tileIdx] ?? 0) & (1 << colonyIdx)) !== 0;
}

export interface TileChangeOp {
  op: 't';
  tileIdx: number;
  terrain: TerrainCode;
  prep: PrepCode;
  deposit: DepositCode;
  richness: number;
  height: number;
  owner: number;
  explored: number;
  anchors: number;
  graceUntil: number;
  changedAt: number;
}

/**
 * Extracts the list of tile change (`t`) operations from an encoded diff (`Uint8Array`) or decoded `EngineDiff`.
 * A diff inspection helper for tests and tools; the hosts apply diffs with `applyDiff`.
 */
export function extractTileChanges(diff: Uint8Array | EngineDiff): TileChangeOp[] {
  const d = diff instanceof Uint8Array ? (decodeValue(diff) as EngineDiff) : diff;
  const { idx, cols } = d.tiles;
  const out: TileChangeOp[] = [];
  for (let i = 0; i < idx.length; i++) {
    out.push({
      op: 't',
      tileIdx: idx[i],
      terrain: (cols.terrain?.[i] ?? 0) as TerrainCode,
      prep: (cols.prep?.[i] ?? 0) as PrepCode,
      deposit: (cols.deposit?.[i] ?? 0) as DepositCode,
      richness: cols.richness?.[i] ?? 0,
      height: cols.height?.[i] ?? 0,
      owner: cols.owner?.[i] ?? -1,
      explored: cols.explored?.[i] ?? 0,
      anchors: cols.anchors?.[i] ?? 0,
      graceUntil: cols.graceUntil?.[i] ?? 0,
      changedAt: cols.changedAt?.[i] ?? 0,
    });
  }
  return out;
}
