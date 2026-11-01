import type { CompiledRow } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import type { PathProfileId } from '../grid/pathProfiles';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { resolveHqT1Row, syncHqView } from '../systems/hq';

/**
 * Which entity kinds are units (take commands and move) and their stats from the data rows. Every unit moves the
 * same way: commands → movement orchestrator → pathfinding service → locomotion. A new unit kind registers one
 * entry here; it gets movement, stop, die, attack and the work commands with no other code.
 */
export interface MobileStats {
  /** Tiles per tick (data `speedTilesPerS`, compiled). */
  speedPerTick: number;
  viewRadius: number;
  profile: PathProfileId;
  terraformReach: readonly [number, number];
  buildReach: readonly [number, number];
  weaponRange: number;
  /** Damage per second (design units). */
  dps: number;
  stopHoldTicks: number;
  retryTicks: number;
}

interface MobileKindDef {
  stats(data: CompiledDataLike): MobileStats;
  /** Refreshes derived views after a unit's columns changed (e.g. the HQ panel blob). */
  onChanged?(state: PlanetState, row: number, tick: number, data: CompiledDataLike): void;
}

const num = (row: CompiledRow, key: string, fallback: number): number => {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

function statsFromRow(row: CompiledRow): MobileStats {
  return {
    speedPerTick: Math.fround(num(row, 'speedTilesPerS', 0)),
    viewRadius: num(row, 'viewRadius', 0),
    profile: 'ground',
    terraformReach: [num(row, 'terraformReachMin', 1), num(row, 'terraformReachTiles', 2)],
    buildReach: [num(row, 'buildReachMin', 2), num(row, 'buildReachTiles', 3)],
    weaponRange: num(row, 'weaponRange', 0),
    dps: num(row, 'dps', 0),
    stopHoldTicks: num(row, 'stopHoldS', 25),
    retryTicks: Math.max(1, num(row, 'retryBlockedS', 25)),
  };
}

const MOBILE_KINDS: ReadonlyMap<number, MobileKindDef> = new Map<number, MobileKindDef>([
  [
    ENTITY_KIND.hq,
    {
      stats: (data) => statsFromRow(resolveHqT1Row(data)),
      onChanged: (state, row, tick, data) => {
        syncHqView(state, row, tick, data);
      },
    },
  ],
]);

const statsCache = new WeakMap<CompiledDataLike, Map<number, MobileStats>>();

/** Stats of a unit kind, or `null` if entities of `kind` are not units (buildings, pods, dev probes). */
export function mobileStats(kind: number, data: CompiledDataLike): MobileStats | null {
  const def = MOBILE_KINDS.get(kind);
  if (!def) return null;
  let byKind = statsCache.get(data);
  if (!byKind) statsCache.set(data, (byKind = new Map()));
  let s = byKind.get(kind);
  if (!s) byKind.set(kind, (s = def.stats(data)));
  return s;
}

export const isUnitKind = (kind: number): boolean => MOBILE_KINDS.has(kind);

/** Lets the unit kind refresh its derived views after the runner changed its columns. */
export function notifyUnitChanged(state: PlanetState, row: number, tick: number, data: CompiledDataLike): void {
  MOBILE_KINDS.get(state.entities.cols.kind[row])?.onChanged?.(state, row, tick, data);
}
