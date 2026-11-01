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

/** Enum values of the base layers (tables later waves extend by appending values, never renumbering). */
const TERRAIN_BASE = {
  flat: 0,
  forest: 1,
  rock: 2,
  slope: 3,
  hole: 4,
  shallow: 5,
  deep: 6,
} as const;
export type TerrainKey = keyof typeof TERRAIN_BASE;
export type TerrainCode = (typeof TERRAIN_BASE)[TerrainKey];

export const TERRAIN = Object.defineProperties(
  { ...TERRAIN_BASE },
  {
    Flat: { value: 0 },
    Forest: { value: 1 },
    Rock: { value: 2 },
    Slope: { value: 3 },
    Hole: { value: 4 },
    Shallow: { value: 5 },
    Deep: { value: 6 },
  },
) as typeof TERRAIN_BASE & {
  readonly Flat: 0;
  readonly Forest: 1;
  readonly Rock: 2;
  readonly Slope: 3;
  readonly Hole: 4;
  readonly Shallow: 5;
  readonly Deep: 6;
};

const PREP_BASE = {
  wild: 0,
  flat: 1,
  prepared: 2,
  irrigated: 3,
  living: 4,
  ridge: 5,
  moat: 6,
} as const;
export type PrepKey = keyof typeof PREP_BASE;
export type PrepCode = (typeof PREP_BASE)[PrepKey];

export const PREP = Object.defineProperties(
  { ...PREP_BASE },
  {
    Wild: { value: 0 },
    Flat: { value: 1 },
    Prepared: { value: 2 },
    Irrigated: { value: 3 },
    Living: { value: 4 },
    Ridge: { value: 5 },
    Moat: { value: 6 },
  },
) as typeof PREP_BASE & {
  readonly Wild: 0;
  readonly Flat: 1;
  readonly Prepared: 2;
  readonly Irrigated: 3;
  readonly Living: 4;
  readonly Ridge: 5;
  readonly Moat: 6;
};

const DEPOSIT_BASE = {
  none: 0,
  metals: 1,
  minerals: 2,
  oil: 3,
} as const;
export type DepositKey = keyof typeof DEPOSIT_BASE;
export type DepositCode = (typeof DEPOSIT_BASE)[DepositKey];

export const DEPOSIT = Object.defineProperties(
  { ...DEPOSIT_BASE },
  {
    None: { value: 0 },
    Metals: { value: 1 },
    Minerals: { value: 2 },
    Oil: { value: 3 },
  },
) as typeof DEPOSIT_BASE & {
  readonly None: 0;
  readonly Metals: 1;
  readonly Minerals: 2;
  readonly Oil: 3;
};
