import { createStore, type EntityStore } from '../ecs/store';
import { hexCount } from '../grid/hex';
import { tileLayers } from '../grid/layers';
import { noteTileStamp } from '../grid/sectors';
import { linkGridMeta } from '../grid/tileModel';
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
  /** World generator version that built the ground (`GEN_VERSION`, D-38); absent on planets built before it. */
  genVersion?: number;
  /**
   * Server-only secret mixed into the hidden-subsurface seeds (D-38): without it a client could regenerate the buried
   * deposits from the public seed. Stripped from every client-bound snapshot and diff (`forClient`).
   */
  worldSalt?: string;
  /**
   * Bumped whenever ground passability may have changed (terrain, prep, deposit, a building placed or removed). A path
   * search paused across steps restarts when it changed, so every host resolves the same path (`grid/pathQueue.ts`).
   */
  pathEpoch?: number;
}

export interface Grid {
  radius: number;
  count: number;
  layers: Record<string, TypedArray> & { changedAt: Uint32Array };
  readonly terrain?: Uint8Array;
  readonly prep?: Uint8Array;
  readonly deposit?: Uint8Array;
  readonly richness?: Float32Array;
  readonly height?: Float32Array;
  readonly owner?: Int16Array;
  readonly explored?: Uint8Array;
  readonly anchors?: Uint8Array;
  readonly graceUntil?: Float64Array;
  readonly changedAt?: Uint32Array;
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

export type SimState = PlanetState;

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
  const meta: PlanetMeta = { simVersion: SIM_VERSION, planetId: p.planetId, planetType: p.planetType, seed: p.seed, tick: 0, nextEntityId: 1, ended: false };
  const grid: Grid = { radius: p.radius, count, layers };
  linkGridMeta(grid, meta);
  return {
    meta,
    rng: seedRng(p.seed),
    grid,
    colonies: [],
    entities: createStore(),
    blobs: {},
  };
}

/** Marks a tile changed at `tick` (call after writing any layer of tile `i`). */
export const touchTile = (s: PlanetState, i: number, tick: number) => {
  s.grid.layers.changedAt[i] = tick;
  noteTileStamp(s.grid.layers.changedAt, i, tick);
};

/** Writes a blob and stamps it. */
export function setBlob(s: PlanetState, name: string, value: unknown, tick: number): void {
  s.blobs[name] = { changedAt: tick, value };
}
