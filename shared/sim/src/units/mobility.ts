import type { CompiledRow } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import type { PathProfileId } from '../grid/pathProfiles';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { syncHqView } from '../systems/hq/view';
import { resolveHqT1Row, rowNum } from '../systems/rows';
import { resolveKindWeaponRow } from '../systems/combat/weaponRows';

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

import { resolveReconRow } from '../systems/factories-hub/robotics';
import { resolveBuilderRow, syncBuilderView } from '../systems/factories-hub/unit';
import { resolveHarvesterRow, syncHarvesterView } from '../systems/harvest/unit';
import { revealVision } from '../systems/hq';

function faunaMobileStats(
  data: CompiledDataLike,
  species: 'blackAnt' | 'blueBeetle' | 'greenSpitter',
  defaults: { speedPerTick: number; viewRadius: number; weaponRange: number; dps: number },
): MobileStats {
  const row = (data?.tables?.fauna as Record<string, CompiledRow | undefined> | undefined)?.[species];
  const rawSpeed = Number(row?.speed ?? defaults.speedPerTick);
  const speedPerTick = rawSpeed;
  return {
    speedPerTick: Math.fround(speedPerTick),
    viewRadius: Number(row?.viewRadius ?? defaults.viewRadius),
    profile: 'ground',
    terraformReach: [0, 0],
    buildReach: [0, 0],
    weaponRange: Number(row?.range ?? defaults.weaponRange),
    dps: Number(row?.dps ?? defaults.dps),
    stopHoldTicks: 15,
    retryTicks: 10,
    retryMaxTicks: 80,
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
  [
    ENTITY_KIND.harvester,
    {
      stats: (data) => {
        const row = resolveHarvesterRow(data);
        return {
          speedPerTick: Math.fround(Number(row.speedTilesPerS ?? 0.3)),
          viewRadius: Number(row.viewRadius ?? 7),
          profile: 'harvester',
          terraformReach: [0, 1],
          buildReach: [0, 0],
          weaponRange: 0,
          dps: 0,
          stopHoldTicks: 15,
          retryTicks: 10,
          retryMaxTicks: 80,
        };
      },
      onChanged: (state, row, tick, data) => {
        syncHarvesterView(state, row, tick, data);
      },
    },
  ],
  [
    ENTITY_KIND.builder,
    {
      stats: (data) => {
        const row = resolveBuilderRow(data);
        return {
          speedPerTick: Math.fround(Number(row.speedTilesPerS ?? 0.3)),
          viewRadius: Number(row.viewRadius ?? 7),
          profile: 'ground',
          terraformReach: [Number(row.terraformReachMin ?? 0), Number(row.terraformReachTiles ?? 1)],
          buildReach: [Number(row.buildReachMin ?? 1), Number(row.buildReachTiles ?? 1)],
          weaponRange: 0,
          dps: 0,
          stopHoldTicks: 15,
          retryTicks: 10,
          retryMaxTicks: 80,
        };
      },
      onChanged: (state, row, tick, data) => {
        const cols = state.entities.cols;
        const bRow = resolveBuilderRow(data);
        revealVision(state, cols.owner[row], cols.q[row], cols.r[row], Number(bRow.viewRadius ?? 7), tick);
        syncBuilderView(state, row, tick, data);
      },
    },
  ],
  [
    ENTITY_KIND.recon,
    {
      stats: (data) => {
        const row = resolveReconRow(data);
        const rawSpeed = Number(row.speed ?? row.speedTilesPerS ?? 0.7);
        const speedPerTick = rawSpeed;
        return {
          speedPerTick: Math.fround(speedPerTick),
          viewRadius: Number(row.viewRadius ?? 8),
          profile: row.mobility === 'hover' ? 'hover' : 'ground',
          terraformReach: [0, 0],
          buildReach: [0, 0],
          weaponRange: Number(row.range ?? 4),
          dps: Number(row.dps ?? 14),
          stopHoldTicks: 15,
          retryTicks: 10,
          retryMaxTicks: 80,
        };
      },
      onChanged: (state, row, tick, data) => {
        const cols = state.entities.cols;
        const rRow = resolveReconRow(data);
        revealVision(state, cols.owner[row], cols.q[row], cols.r[row], Number(rRow.viewRadius ?? 10), tick);
      },
    },
  ],
  [
    ENTITY_KIND.demoTank,
    {
      stats: (data) => {
        const row = (data?.tables?.combatUnits as Record<string, CompiledRow | undefined> | undefined)?.demoTank;
        const rawSpeed = Number(row?.speed ?? 0.44);
        const speedPerTick = rawSpeed > 1.0 ? rawSpeed * 0.2 : rawSpeed;
        return {
          speedPerTick: Math.fround(speedPerTick),
          viewRadius: Number(row?.viewRadius ?? 6),
          profile: 'ground',
          terraformReach: [0, 0],
          buildReach: [0, 0],
          weaponRange: Number(row?.range ?? 6),
          dps: Number(row?.dps ?? 28),
          stopHoldTicks: 15,
          retryTicks: 10,
          retryMaxTicks: 80,
        };
      },
      onChanged: (state, row, tick) => {
        const cols = state.entities.cols;
        revealVision(state, cols.owner[row], cols.q[row], cols.r[row], 6, tick);
      },
    },
  ],
  [
    ENTITY_KIND.demoArtillery,
    {
      stats: (data) => {
        const row = (data?.tables?.combatUnits as Record<string, CompiledRow | undefined> | undefined)?.demoArtillery;
        const rawSpeed = Number(row?.speed ?? 0.32);
        const speedPerTick = rawSpeed > 1.0 ? rawSpeed * 0.2 : rawSpeed;
        return {
          speedPerTick: Math.fround(speedPerTick),
          viewRadius: Number(row?.viewRadius ?? 6),
          profile: 'ground',
          terraformReach: [0, 0],
          buildReach: [0, 0],
          weaponRange: Number(row?.range ?? 12),
          dps: Number(row?.dps ?? 22.5),
          stopHoldTicks: 15,
          retryTicks: 10,
          retryMaxTicks: 80,
        };
      },
      onChanged: (state, row, tick) => {
        const cols = state.entities.cols;
        revealVision(state, cols.owner[row], cols.q[row], cols.r[row], 6, tick);
      },
    },
  ],
  [
    ENTITY_KIND.blackAnt,
    {
      stats: (data) =>
        faunaMobileStats(data, 'blackAnt', {
          speedPerTick: 0.4,
          viewRadius: 6,
          weaponRange: 1,
          dps: 8,
        }),
    },
  ],
  [
    ENTITY_KIND.blueBeetle,
    {
      stats: (data) =>
        faunaMobileStats(data, 'blueBeetle', {
          speedPerTick: 0.16,
          viewRadius: 6,
          weaponRange: 1,
          dps: 12,
        }),
    },
  ],
  [
    ENTITY_KIND.greenSpitter,
    {
      stats: (data) =>
        faunaMobileStats(data, 'greenSpitter', {
          speedPerTick: 0.28,
          viewRadius: 7,
          weaponRange: 5,
          dps: 6,
        }),
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
  if (!s) {
    s = def.stats(data);
    const weapon = data.tables.weapons ? resolveKindWeaponRow(kind, data) : undefined;
    if (weapon) {
      s.weaponRange = Number(weapon.range ?? s.weaponRange);
      s.dps = Number(weapon.damage ?? 0) * Number(weapon.ratePerS ?? 0);
    }
    byKind.set(kind, s);
  }
  return s;
}

export const isUnitKind = (kind: number): boolean => MOBILE_KINDS.has(kind);

/** Path profile the movement orchestrator uses. Fauna share the harvester rule whatever their row says. */
export function movementProfile(kind: number, data: CompiledDataLike): PathProfileId {
  if (kind === ENTITY_KIND.blackAnt || kind === ENTITY_KIND.blueBeetle || kind === ENTITY_KIND.greenSpitter) return 'harvester';
  return mobileStats(kind, data)?.profile ?? 'ground';
}

/** Lets the unit kind refresh its derived views after the runner changed its columns. */
export function notifyUnitChanged(state: PlanetState, row: number, tick: number, data: CompiledDataLike): void {
  MOBILE_KINDS.get(state.entities.cols.kind[row])?.onChanged?.(state, row, tick, data);
}
