import { createStore, type EntityStore } from '../ecs/store';
import { hexCount } from '../grid/hex';
import { tileLayers } from '../grid/layers';
import { SIM_VERSION } from './constants';
import { seedRng, type RngState } from './rng';
import { allocate, type TypedArray } from './types';

export type PlanetType = 'desert' | 'ocean' | 'temperate'; // D-33

export interface PlanetMeta {
  simVersion: number;
  planetId: string;
  planetType: PlanetType;
  seed: string;
  /** Current tick; a step from tick T with `dt` produces tick T + dt. */
  tick: number;
  nextEntityId: number;
  ended: boolean;
}

export interface Grid {
  radius: number;
  count: number;
  layers: Record<string, TypedArray> & { changedAt: Uint32Array };
}

/** One colony's record. Fields beyond these are added by the waves that need them (stock, caps, stage, …). */
export interface ColonyState {
  index: number;
  id: string;
  name: string;
  color: number;
  status: 'founding' | 'active' | 'eliminated' | 'settled';
  changedAt: number;
  [field: string]: unknown;
}

/**
 * A plain-data blob of per-feature state (order lanes, goals, hazards, …). Registered by name; the delta carries a
 * blob whole when its `changedAt` is past the window start, so waves add state without writing delta code (SIM-V-05).
 * Values must be MessagePack-able plain data (objects, arrays, numbers, strings, booleans, typed arrays).
 */
export interface Blob { changedAt: number; value: unknown }

/** The whole planet (SIMULATION §5). Everything here is synced to clients and saved in snapshots. */
export interface PlanetState {
  meta: PlanetMeta;
  rng: RngState;
  grid: Grid;
  colonies: ColonyState[];
  entities: EntityStore;
  blobs: Record<string, Blob>;
}

export interface NewStateParams {
  planetId: string;
  planetType: PlanetType;
  seed: string;
  radius: number;
}

/** An empty planet: every tile zeroed (terrain 0, prep 0), owners -1, no colonies, no entities. */
export function createState(p: NewStateParams): PlanetState {
  const count = hexCount(p.radius);
  const layers = {} as Grid['layers'];
  for (const l of tileLayers()) layers[l.name] = allocate(l.dtype, count);
  layers.owner.fill(-1);
  return {
    meta: { simVersion: SIM_VERSION, planetId: p.planetId, planetType: p.planetType, seed: p.seed, tick: 0, nextEntityId: 1, ended: false },
    rng: seedRng(p.seed),
    grid: { radius: p.radius, count, layers },
    colonies: [],
    entities: createStore(),
    blobs: {},
  };
}

/** Marks a tile changed at `tick` (call after writing any layer of tile `i`). */
export const touchTile = (s: PlanetState, i: number, tick: number) => { s.grid.layers.changedAt[i] = tick; };

/** Writes a blob and stamps it. */
export function setBlob(s: PlanetState, name: string, value: unknown, tick: number): void {
  s.blobs[name] = { changedAt: tick, value };
}
