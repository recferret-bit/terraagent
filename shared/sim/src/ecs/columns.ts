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
  { name: 'cell', dtype: 'f32', wave: 'W01' }, // HQ power cell current energy (E)
  { name: 'cellMax', dtype: 'f32', wave: 'W01' }, // HQ power cell capacity (E)
  { name: 'targetQ', dtype: 'i16', wave: 'W01' }, // current move/work destination q
  { name: 'targetR', dtype: 'i16', wave: 'W01' }, // current move/work destination r
  { name: 'workRate', dtype: 'f32', wave: 'W01' }, // worker rate multiplier (1.5 for HQ T1)
  { name: 'footprintW', dtype: 'u8', wave: 'W02' }, // building footprint width in tiles
  { name: 'footprintD', dtype: 'u8', wave: 'W02' }, // building footprint depth in tiles
  { name: 'shedGroup', dtype: 'u8', wave: 'W02' }, // brownout shedding group (1..4)
  { name: 'createdAt', dtype: 'u32', wave: 'W00' },
  { name: 'changedAt', dtype: 'u32', wave: 'W00' }, // tick of the last change; the delta picks rows with changedAt > fromTick
];

export const ENTITY_KIND = {
  devProbe: 1,
  pod: 2,
  dropPod: 2,
  hq: 3,
  commandHub: 4,
  hub: 4,
  metalsExtractor: 5,
  solar: 6,
  harvester: 7,
  builder: 50,
  pylon: 9,
  capacitor: 10,
  wind: 11,
  thermal: 12,
  supplyDepot: 13,
  depot: 13,
  mineralsQuarry: 14,
  quarry: 14,
  waterExtractor: 15,
  waterPump: 15,
  petroleumWell: 16,
  oilWell: 16,
  tradeHub: 8,
  roboticsFactory: 17,
  droneControlArray: 18,
  droneArray: 18,
  autocannon: 19,
  turret: 19,
  laserTower: 20,
  pulseTurret: 20,
  recon: 51,
  blackAnt: 60,
  blueBeetle: 61,
  greenSpitter: 62,
  hiveBlackAnt: 63,
  hiveBlueBeetle: 64,
  hiveGreenSpitter: 65,
} as const;

export const ENTITY_STATE = {
  idle: 0,
  moving: 1,
  working: 2,
  descending: 3,
  constructing: 4,
  active: 5,
  inert: 6,
  waiting: 7,
  offlineBrownout: 8,
  offlineUnpowered: 9,
  offlineCapped: 10,
  harvesting: 11,
  offlineOverload: 12,
  offlineNoFuel: 13,
  offlineNoGrid: 14,
  repairing: 15,
} as const;

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
