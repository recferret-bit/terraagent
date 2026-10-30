import type { DType, FieldDef, WaveId } from '../kernel/types';

/**
 * Entity columns (SIMULATION §5). The base set is fixed here; a wave that needs more per-entity state registers a
 * column with `defineEntityColumn` from its system's module (at import time, before any state is created). Codec,
 * diff and clone iterate this table, so a new column needs no codec or delta code (SIM-V-05).
 */
const BASE: FieldDef[] = [
  { name: 'id', dtype: 'u32', wave: 'W00' }, // monotonic entity id, never recycled (SIM-D-05)
  { name: 'kind', dtype: 'u8', wave: 'W00' }, // archetype index (data table)
  { name: 'owner', dtype: 'i8', wave: 'W00' }, // colony index, -1 = none
  { name: 'tier', dtype: 'u8', wave: 'W00' },
  { name: 'q', dtype: 'i16', wave: 'W00' }, // axial tile
  { name: 'r', dtype: 'i16', wave: 'W00' },
  { name: 'x', dtype: 'f32', wave: 'W00' }, // continuous position in tile units (axial q, r as floats)
  { name: 'y', dtype: 'f32', wave: 'W00' },
  { name: 'rot', dtype: 'f32', wave: 'W00' },
  { name: 'hp', dtype: 'f32', wave: 'W00' },
  { name: 'hpMax', dtype: 'f32', wave: 'W00' },
  { name: 'state', dtype: 'u8', wave: 'W00' },
  { name: 'progress', dtype: 'f32', wave: 'W00' },
  { name: 'createdAt', dtype: 'u32', wave: 'W00' },
  { name: 'changedAt', dtype: 'u32', wave: 'W00' }, // tick of the last change; the delta picks rows with changedAt > fromTick
];

const columns: FieldDef[] = [...BASE];

export function defineEntityColumn(name: string, dtype: DType, wave: WaveId): void {
  const prev = columns.find((c) => c.name === name);
  if (prev) {
    if (prev.dtype !== dtype) throw new Error(`entity column ${name} already defined as ${prev.dtype}`);
    return;
  }
  columns.push({ name, dtype, wave });
}

export const entityColumns = (): readonly FieldDef[] => columns;
