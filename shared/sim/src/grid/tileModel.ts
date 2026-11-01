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

export type HexGrid = Grid;

export interface TileLayersLike {
  count?: number;
  valid?: Uint8Array | ArrayLike<number>;
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

export const TERRAIN_KEYS: readonly TerrainKey[] = ['flat', 'forest', 'rock', 'slope', 'hole', 'shallow', 'deep'];
export const PREP_KEYS: readonly PrepKey[] = ['wild', 'flat', 'prepared', 'irrigated', 'living', 'ridge', 'moat'];
export const DEPOSIT_KEYS: readonly DepositKey[] = ['none', 'metals', 'minerals', 'oil'];

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

/** Converts a terrain key (`'flat' | 'forest' | ...`, case-insensitive) to its `TERRAIN` code (`0..6`). */
export function terrainIdFromKey(key: TerrainKey | string): TerrainCode {
  const normalized = key.toLowerCase() as TerrainKey;
  const idx = TERRAIN_KEYS.indexOf(normalized);
  if (idx < 0) throw new Error(`unknown terrain key "${key}"`);
  return idx as TerrainCode;
}

/** Converts a `TERRAIN` numeric code (`0..6`) to its canonical key (`'flat' | 'forest' | ...`). */
export function terrainKeyFromId(id: number): TerrainKey {
  if (!Number.isInteger(id) || id < 0 || id >= TERRAIN_KEYS.length) {
    throw new RangeError(`invalid terrain id ${String(id)}`);
  }
  return TERRAIN_KEYS[id];
}

/** Converts a prep state key (`'wild' | 'flat' | 'prepared' | ...`, case-insensitive) to its `PREP` code (`0..6`). */
export function prepIdFromKey(key: PrepKey | string): PrepCode {
  const normalized = key.toLowerCase() as PrepKey;
  const idx = PREP_KEYS.indexOf(normalized);
  if (idx < 0) throw new Error(`unknown prep key "${key}"`);
  return idx as PrepCode;
}

/** Converts a `PREP` numeric code (`0..6`) to its canonical key (`'wild' | 'flat' | 'prepared' | ...`). */
export function prepKeyFromId(id: number): PrepKey {
  if (!Number.isInteger(id) || id < 0 || id >= PREP_KEYS.length) {
    throw new RangeError(`invalid prep id ${String(id)}`);
  }
  return PREP_KEYS[id];
}

/** Converts a deposit key (`'none' | 'metals' | 'minerals' | 'oil'`, case-insensitive) to its `DEPOSIT` code (`0..3`). */
export function depositIdFromKey(key: DepositKey | string): DepositCode {
  const normalized = key.toLowerCase() as DepositKey;
  const idx = DEPOSIT_KEYS.indexOf(normalized);
  if (idx < 0) throw new Error(`unknown deposit key "${key}"`);
  return idx as DepositCode;
}

/** Converts a `DEPOSIT` numeric code (`0..3`) to its canonical key (`'none' | 'metals' | 'minerals' | 'oil'`). */
export function depositKeyFromId(id: number): DepositKey {
  if (!Number.isInteger(id) || id < 0 || id >= DEPOSIT_KEYS.length) {
    throw new RangeError(`invalid deposit id ${String(id)}`);
  }
  return DEPOSIT_KEYS[id];
}

function resolveLayers(src: GridLike): { layers: TileLayersLike; count: number; meta?: PlanetMeta } {
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

/** Returns `true` when `tileIdx` is within `[0, count)` and (if a `valid` mask exists) marked valid. */
export function isValidTileIndex(grid: GridLike, tileIdx: number): boolean {
  if (!Number.isInteger(tileIdx) || tileIdx < 0) return false;
  const { layers, count } = resolveLayers(grid);
  if (tileIdx >= count) return false;
  if (layers.valid && layers.valid[tileIdx] === 0) return false;
  return true;
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

/** Pure movement multiplier (`1.0 = 100%`) for a `(terrainCode, prepCode)` pair. */
export function terrainMoveMultiplier(terrainCode: number, prepCode: number = PREP.wild, data?: CompiledDataLike): number {
  return terrainMoveMultiplierBp(terrainCode, prepCode, data) / 10000;
}

/**
 * Returns `true` if ground units and ground fauna can enter `tileIdx` (§4.8 `UO-W`).
 * Deep water (`TERRAIN.deep`), raised walls (`PREP.ridge`), and dug moats (`PREP.moat`) are impassable.
 */
export function isGroundPassable(grid: GridLike, tileIdx: number, data?: CompiledDataLike): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveLayers(grid);
  return terrainMoveMultiplierBp(layers.terrain[tileIdx], layers.prep[tileIdx], data) > 0;
}

/**
 * Ground movement speed multiplier in basis points (`10000 = 1.0x`, `11000 = 1.1x` on Living, `0` if impassable).
 */
export function groundMoveMultiplierBp(grid: GridLike, tileIdx: number, data?: CompiledDataLike): number {
  if (!isValidTileIndex(grid, tileIdx)) return 0;
  const { layers } = resolveLayers(grid);
  return terrainMoveMultiplierBp(layers.terrain[tileIdx], layers.prep[tileIdx], data);
}

/**
 * Ground movement speed multiplier as a scalar (`1.0` on Flat/Prepared, `1.1` on Living, `0` if impassable).
 */
export function groundMoveMultiplier(grid: GridLike, tileIdx: number, data?: CompiledDataLike): number {
  return groundMoveMultiplierBp(grid, tileIdx, data) / 10000;
}

/** Returns `true` if `tileIdx` is a raised Ridge wall that blocks direct ground fire (`UO-W-02`). */
export function blocksDirectFire(grid: GridLike, tileIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveLayers(grid);
  return layers.prep[tileIdx] === PREP.ridge;
}

/**
 * Returns `true` iff `tileIdx` is valid buildable ground (`PREP.prepared` or `PREP.living` and not Deep water, `UO-TF-01`).
 */
export function isBuildablePrepared(grid: GridLike, tileIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveLayers(grid);
  if (layers.terrain[tileIdx] === TERRAIN.deep) return false;
  const prep = layers.prep[tileIdx];
  return prep === PREP.prepared || prep === PREP.living;
}

/** Returns `true` when `tileIdx` is owned by `colonyIdx`. */
export function isTileOwnedBy(grid: GridLike, tileIdx: number, colonyIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveLayers(grid);
  return (layers.owner?.[tileIdx] ?? -1) === colonyIdx;
}

/** Returns `true` when `tileIdx` is unclaimed (`owner === -1`). */
export function isTileUnclaimed(grid: GridLike, tileIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx)) return false;
  const { layers } = resolveLayers(grid);
  return (layers.owner?.[tileIdx] ?? -1) === -1;
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
  const { layers, meta } = resolveLayers(grid);
  if (layers.prep[tileIdx] !== prep) bumpPathEpoch(meta);
  layers.prep[tileIdx] = prep;
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `terrain` class (`TERRAIN.*`) and stamps `changedAt` so the next delta carries the change. */
export function setTileTerrain(grid: GridLike, tileIdx: number, terrain: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveLayers(grid);
  if (layers.terrain[tileIdx] !== terrain) bumpPathEpoch(meta);
  layers.terrain[tileIdx] = terrain;
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `owner` colony index (`-1` for unclaimed) and stamps `changedAt`. */
export function setTileOwner(grid: GridLike, tileIdx: number, owner: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveLayers(grid);
  if (layers.owner) layers.owner[tileIdx] = owner;
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `deposit` kind (`DEPOSIT.*`) and optional `richness`, stamping `changedAt`. */
export function setTileDeposit(grid: GridLike, tileIdx: number, deposit: number, richness?: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveLayers(grid);
  if (layers.deposit && layers.deposit[tileIdx] !== deposit) bumpPathEpoch(meta);
  if (layers.deposit) layers.deposit[tileIdx] = deposit;
  if (richness !== undefined && layers.richness) layers.richness[tileIdx] = richness;
  stampTile(layers, meta, tileIdx, tick);
}

/** Sets a tile's `height` (metres above the build plane) and stamps `changedAt`. */
export function setTileHeight(grid: GridLike, tileIdx: number, height: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx)) return;
  const { layers, meta } = resolveLayers(grid);
  if (layers.height) layers.height[tileIdx] = height;
  stampTile(layers, meta, tileIdx, tick);
}

/** Marks `tileIdx` as explored by `colonyIdx` (sets bit `1 << colonyIdx` on `explored`) and stamps `changedAt`. */
export function markTileExplored(grid: GridLike, tileIdx: number, colonyIdx: number, tick?: number): void {
  if (!isValidTileIndex(grid, tileIdx) || colonyIdx < 0 || colonyIdx >= 8) return;
  const { layers, meta } = resolveLayers(grid);
  if (layers.explored) layers.explored[tileIdx] |= 1 << colonyIdx;
  stampTile(layers, meta, tileIdx, tick);
}

/** Returns `true` if `colonyIdx` has explored `tileIdx` (`(explored & (1 << colonyIdx)) !== 0`). */
export function isTileExplored(grid: GridLike, tileIdx: number, colonyIdx: number): boolean {
  if (!isValidTileIndex(grid, tileIdx) || colonyIdx < 0 || colonyIdx >= 8) return false;
  const { layers } = resolveLayers(grid);
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

/** Extracts the list of tile change (`t`) operations from an encoded diff (`Uint8Array`) or decoded `EngineDiff`. */
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
