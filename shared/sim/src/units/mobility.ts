import type { CompiledRow } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import type { PathProfileId } from '../grid/pathProfiles';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { syncHqView } from '../systems/hq/view';
import { resolveHqT1Row, rowNum } from '../systems/rows';

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
  /** Longest back-off of failed auto work (`retryBlockedMaxS`). */
  retryMaxTicks: number;
}

interface MobileKindDef {
  stats(data: CompiledDataLike): MobileStats;
  /** Refreshes derived views after a unit's columns changed (e.g. the HQ panel blob). */
  onChanged?(state: PlanetState, row: number, tick: number, data: CompiledDataLike): void;
}

function statsFromRow(row: CompiledRow): MobileStats {
  return {
    speedPerTick: Math.fround(rowNum(row, 'speedTilesPerS')),
    viewRadius: rowNum(row, 'viewRadius'),
    profile: 'ground',
    terraformReach: [rowNum(row, 'terraformReachMin'), rowNum(row, 'terraformReachTiles')],
    buildReach: [rowNum(row, 'buildReachMin'), rowNum(row, 'buildReachTiles')],
    weaponRange: rowNum(row, 'weaponRange'),
    dps: rowNum(row, 'dps'),
    stopHoldTicks: rowNum(row, 'stopHoldS'),
    retryTicks: Math.max(1, rowNum(row, 'retryBlockedS')),
    retryMaxTicks: Math.max(1, rowNum(row, 'retryBlockedMaxS')),
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
