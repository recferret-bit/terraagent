import worldgenTable from '../data/worldgen';
import type { PlanetType } from '../kernel/state';

/**
 * World generation numbers (`data/worldgen.ts`, D-38). Generation reads the file rows, never compiled data: a planet
 * is generated once, before any pipeline exists, so a host's live tunes must not reach it (the table is `fixed`).
 */
export type ProfileRow = Readonly<Record<string, unknown>> & { readonly id: string; readonly stages: readonly string[] };

const rows = worldgenTable.rows as unknown as readonly ProfileRow[];
const shared = rows.find((r) => r.id === 'shared');

/** The world-generation profile row for `planetType`, temperate as fallback. */
export function worldProfile(planetType: PlanetType): ProfileRow {
  return rows.find((r) => r.id === planetType) ?? rows.find((r) => r.id === 'temperate')!;
}

/** A number of `profile`, else of the `shared` row, else `fallback`. */
export function profileNumber(profile: ProfileRow, field: string, fallback: number): number {
  const own = profile[field], common = shared?.[field];
  if (typeof own === 'number') return own;
  return typeof common === 'number' ? common : fallback;
}

/** `profileNumber` of the profile for `planetType`. */
export const profileNum = (planetType: PlanetType, field: string, fallback: number): number =>
  profileNumber(worldProfile(planetType), field, fallback);

/** Spawn slot guarantee numbers (UO-TF-09) of a planet type. */
export interface SpawnConfig {
  readonly ringRadius: number; readonly ringJitter: number; readonly guaranteeRadius: number; readonly minFlatShareBp: number;
  readonly maxNonFlatPer3x3: number; readonly metalsRadius: number; readonly allDepositsRadius: number;
}
const spawnConfigs = new Map<PlanetType, SpawnConfig>();

export function spawnConfig(type: PlanetType): SpawnConfig {
  let c = spawnConfigs.get(type);
  if (!c) {
    const n = (f: string, fallback: number) => profileNum(type, f, fallback);
    c = {
      ringRadius: n('spawnRingRadius', 32), ringJitter: n('spawnRingJitter', 3), guaranteeRadius: n('spawnGuaranteeRadius', 4),
      minFlatShareBp: n('spawnMinFlatShareBp', 6000), maxNonFlatPer3x3: n('spawnMaxNonFlatPer3x3', 3),
      metalsRadius: n('spawnMetalsRadius', 8), allDepositsRadius: n('spawnAllDepositsRadius', 12),
    };
    spawnConfigs.set(type, c);
  }
  return c;
}
