import worldgenTable from '../../data/worldgen';
import { axialToPlane, hexIndex, type HexIndex } from '../../grid/hex';
import { sectorIndex, type SectorIndex } from '../../grid/sectors';
import type { PlanetState, PlanetType } from '../../kernel/state';
import { seedOf } from './noise';

/** Tile centre spacing in metres (CLIENT §8); relief noise is evaluated in metres. */
export const TILE_M = 2;

export type ProfileRow = Readonly<Record<string, unknown>> & { readonly id: string; readonly stages: readonly string[] };

/** The world-generation profile row for `planetType` (`data/worldgen.ts`), temperate as fallback. */
export function worldProfile(planetType: PlanetType): ProfileRow {
  const rows = worldgenTable.rows as unknown as readonly ProfileRow[];
  return rows.find((r) => r.id === planetType) ?? rows.find((r) => r.id === 'temperate')!;
}

/**
 * Everything a stage reads and writes: the planet state being built, cached grid / sector geometry, per-tile metre
 * coordinates, the profile numbers, and named scratch fields stages hand to later stages (e.g. `rockiness`).
 */
export interface WorldGenContext {
  readonly state: PlanetState;
  readonly hex: HexIndex;
  readonly sectors: SectorIndex;
  readonly profile: ProfileRow;
  /** Spawn slot capacity of the planet (generator parameter). */
  readonly capacity: number;
  /** Tile centre x / y in metres (plane coordinates × TILE_M). */
  readonly mx: Float32Array;
  readonly my: Float32Array;
  readonly fields: Map<string, Float32Array>;
  /** A number from the profile row (`fallback` when the row has none). */
  num(field: string, fallback: number): number;
  /** Stable 32-bit seed for `(stage, sector?)`: independent of stage order and of other sectors. */
  seed(stage: string, sector?: number): number;
  field(name: string): Float32Array;
}

export function createContext(state: PlanetState, capacity: number): WorldGenContext {
  const hex = hexIndex(state.grid.radius);
  const mx = new Float32Array(hex.count), my = new Float32Array(hex.count);
  for (let i = 0; i < hex.count; i++) {
    const [x, y] = axialToPlane(hex.q[i], hex.r[i]);
    mx[i] = Math.fround(x * TILE_M);
    my[i] = Math.fround(y * TILE_M);
  }
  const profile = worldProfile(state.meta.planetType);
  const fields = new Map<string, Float32Array>();
  const base = state.meta.seed;
  return {
    state, hex, sectors: sectorIndex(state.grid.radius), profile, capacity, mx, my, fields,
    num: (f, fallback) => (typeof profile[f] === 'number' ? (profile[f] as number) : fallback),
    seed: (stage, sector) => seedOf(`${base}|gen:${stage}${sector === undefined ? '' : `:${sector}`}`),
    field(name) {
      let f = fields.get(name);
      if (!f) fields.set(name, (f = new Float32Array(hex.count)));
      return f;
    },
  };
}

/** One generation stage. `run` may iterate `ctx.sectors` (per-sector seeds keep sectors independent). */
export interface WorldStage {
  readonly id: string;
  run(ctx: WorldGenContext): void;
}
