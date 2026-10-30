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
  { name: 'changedAt', dtype: 'u32', wave: 'W00' },
];

const layers: FieldDef[] = [...BASE];

export function defineTileLayer(name: string, dtype: DType, wave: WaveId): void {
  const prev = layers.find((l) => l.name === name);
  if (prev) {
    if (prev.dtype !== dtype) throw new Error(`tile layer ${name} already defined as ${prev.dtype}`);
    return;
  }
  layers.push({ name, dtype, wave });
}

export const tileLayers = (): readonly FieldDef[] => layers;

/** Enum values of the base layers (tables later waves extend by appending values, never renumbering). */
export const TERRAIN = { flat: 0 } as const;
export const PREP = { wild: 0 } as const;
