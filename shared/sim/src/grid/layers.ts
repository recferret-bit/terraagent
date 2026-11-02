import { DEPOSIT_CODES, PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { DType, FieldDef, WaveId } from '../kernel/types';

/**
 * Per-tile layers (SIMULATION §5 `grid`). A wave that adds tile state registers a layer here at import time; codec,
 * diff and clone iterate this table. `changedAt` stamps the tick of a tile's last change for the delta.
 */
const BASE: FieldDef[] = [
  { name: 'terrain', dtype: 'u8', wave: 'W00' },
  { name: 'prep', dtype: 'u8', wave: 'W00' },
  { name: 'deposit', dtype: 'u8', wave: 'W00' },
  { name: 'richness', dtype: 'f32', wave: 'W00' },
  { name: 'height', dtype: 'f32', wave: 'W00' }, // metres above the build plane
  { name: 'owner', dtype: 'i8', wave: 'W00' }, // colony index, -1 = none
  { name: 'explored', dtype: 'u8', wave: 'W00' }, // bitmask per colony, client-side fog (D-25)
  { name: 'anchors', dtype: 'u8', wave: 'W01' }, // count of friendly anchor buildings claiming this tile (W01-17)
  { name: 'graceUntil', dtype: 'f64', wave: 'W01' }, // tick when zero-anchor tile reverts to unclaimed
  { name: 'changedAt', dtype: 'u32', wave: 'W00' },
  // Hidden subsurface (D-38): what Clear / Break uncovers. Server-only, redacted from client snapshots and diffs.
  { name: 'subDeposit', dtype: 'u8', wave: 'W01', hidden: true }, // DEPOSIT code buried under the tile, 0 = none
  { name: 'subRichness', dtype: 'f32', wave: 'W01', hidden: true }, // its richness (bp), copied to `richness` on reveal
];

const layers: FieldDef[] = [...BASE];

export function defineTileLayer(name: string, dtype: DType, wave: WaveId, opts: { hidden?: boolean } = {}): void {
  const prev = layers.find((l) => l.name === name);
  if (prev) {
    if (prev.dtype !== dtype) throw new Error(`tile layer ${name} already defined as ${prev.dtype}`);
    return;
  }
  layers.push({ name, dtype, wave, ...(opts.hidden ? { hidden: true } : {}) });
}

/** Layers a client may see (everything but `hidden` ones). */
export const clientTileLayers = (): readonly FieldDef[] => layers.filter((l) => !l.hidden);

export const tileLayers = (): readonly FieldDef[] => layers;

/**
 * Enum values of the base layers: the tables of `@terra/contracts/tiles/codes` (one copy, shared with the render engine,
 * RN-06). Later waves extend them by appending values, never renumbering. Each table also answers its PascalCase keys
 * (`TERRAIN.Flat === TERRAIN.flat`), non-enumerable so spreads and key lists see only the canonical keys.
 */
type PascalAliases<T> = { readonly [K in keyof T as Capitalize<K & string>]: T[K] };

function withPascalAliases<T extends Record<string, number>>(table: T): T & PascalAliases<T> {
  const out = { ...table };
  for (const [key, value] of Object.entries(table)) Object.defineProperty(out, key[0].toUpperCase() + key.slice(1), { value });
  return out as T & PascalAliases<T>;
}

export type TerrainKey = keyof typeof TERRAIN_CODES;
export type TerrainCode = (typeof TERRAIN_CODES)[TerrainKey];
export const TERRAIN = withPascalAliases(TERRAIN_CODES);

export type PrepKey = keyof typeof PREP_CODES;
export type PrepCode = (typeof PREP_CODES)[PrepKey];
export const PREP = withPascalAliases(PREP_CODES);

export type DepositKey = keyof typeof DEPOSIT_CODES;
export type DepositCode = (typeof DEPOSIT_CODES)[DepositKey];
export const DEPOSIT = withPascalAliases(DEPOSIT_CODES);
