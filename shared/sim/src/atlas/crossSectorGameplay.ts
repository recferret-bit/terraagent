import { W11_DEFAULT_SECTOR_RADIUS, type SectorId } from '@terra/contracts';
import { isColonyTileExplored } from '../grid/exploration';
import { hexIndex } from '../grid/hex';
import {
  findHexPath,
  pathBlockersFor,
  tileStepCostBp,
  type AxialCoord,
  type FindHexPathOptions,
  type HexPathResult,
  type PathProfileId,
} from '../grid/path';
import { isGroundPassable } from '../grid/tileModel';
import { compileData } from '../data';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import {
  evaluatePlacement,
  type EvaluatePlacementOpts,
  type PlacementResult,
  type PlacementTile,
} from '../systems/construction/placement';
import { placementWorldFromState } from '../systems/construction/placementWorld';
import {
  buildPowerGraph,
  evaluateColonyPower,
  relaysLinked,
  type ColonyPowerSummary,
  type PowerGraph,
} from '../systems/power-core';
import {
  claimTerritoryRadius,
  type ClaimTerritoryOpts,
  type ClaimTerritoryResult,
} from '../systems/territory-claim';
import { getAtlasBlob } from './generateAtlas';
import { globalTileToSector } from './partition';
import { resolveColonyFoundingSectorMap } from './sectorMetrics';
import type { GlobalTileSectorLookup } from './types';

export * from './sectorMetrics';

export interface CrossSectorStepTransition {
  readonly stepIndex: number;
  readonly from: AxialCoord;
  readonly to: AxialCoord;
  readonly fromSectorId: SectorId;
  readonly toSectorId: SectorId;
  readonly stepCostBp: number;
  readonly expectedTileCostBp: number;
}

export type CrossSectorPathRejectReason =
  | 'cross_sector_disabled'
  | 'start_out_of_bounds'
  | 'goal_out_of_bounds'
  | 'start_blocked'
  | 'goal_blocked'
  | 'unreachable';

export interface CrossSectorPathReport extends HexPathResult {
  readonly reason?: CrossSectorPathRejectReason;
  readonly sectorRadius: number;
  readonly startSectorId: SectorId;
  readonly goalSectorId: SectorId;
  readonly visitedSectors: readonly SectorId[];
  readonly pathSectorIds: readonly SectorId[];
  readonly sectorTransitions: readonly CrossSectorStepTransition[];
  readonly seamCrossings: readonly CrossSectorStepTransition[];
  readonly crossesSectorBoundary: boolean;
  readonly zeroSeamPenalty: boolean;
}

export interface CrossSectorPlacementTile extends PlacementTile {
  readonly sectorId: SectorId;
}

export interface CrossSectorPlacementResult extends Omit<PlacementResult, 'tiles'> {
  readonly reason?: string;
  readonly sectorRadius: number;
  readonly anchorSectorId: SectorId;
  readonly foundingSectorId: SectorId;
  readonly crossesFromFoundingSector: boolean;
  readonly footprintSectorIds: readonly SectorId[];
  readonly footprintSectors: readonly SectorId[];
  readonly footprintTileCount: number;
  readonly straddlesSectorBoundary: boolean;
  readonly tiles: CrossSectorPlacementTile[];
}

export interface CrossSectorTerritoryClaimReport extends ClaimTerritoryResult {
  readonly sectorRadius: number;
  readonly centerSectorId: SectorId;
  readonly claimedBySector: Readonly<Record<SectorId, number>>;
  readonly claimedSectorIds: readonly SectorId[];
  readonly spansMultipleSectors: boolean;
}

export interface CrossSectorRelayLink {
  readonly relayIdA: number;
  readonly relayIdB: number;
  readonly kindA: number;
  readonly kindB: number;
  readonly qA: number;
  readonly rA: number;
  readonly qB: number;
  readonly rB: number;
  readonly sectorA: SectorId;
  readonly sectorB: SectorId;
  readonly componentId: number;
}

export interface CrossSectorPowerGridReport {
  readonly colonyIndex: number;
  readonly sectorRadius: number;
  readonly graph: PowerGraph;
  readonly powerSummary: ColonyPowerSummary;
  readonly relaySectorById: Readonly<Record<number, SectorId>>;
  readonly buildingSectorById: Readonly<Record<number, SectorId>>;
  readonly crossSectorRelayLinks: readonly CrossSectorRelayLink[];
  readonly sectorsByComponent: Readonly<Record<number, readonly SectorId[]>>;
  readonly connectedSectorIds: readonly SectorId[];
  readonly spansMultipleSectors: boolean;
}

function resolveStateSectorRadius(state: PlanetState, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isSafeInteger(explicit) && explicit > 0) {
    return explicit;
  }
  return getAtlasBlob(state)?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
}

export function resolveTileSector(state: PlanetState, q: number, r: number, explicitRadius?: number): GlobalTileSectorLookup | null {
  if (!Number.isInteger(q) || !Number.isInteger(r)) return null;
  const hex = hexIndex(state.grid.radius);
  if (hex.indexOf(q, r) < 0) return null;
  const sectorRadius = resolveStateSectorRadius(state, explicitRadius);
  return globalTileToSector(q, r, sectorRadius);
}

/**
 * Runs the shared A* hex pathfinder (`findHexPath`) with strict W11 sector isolation:
 * paths whose start and goal lie in different sectors are rejected with `reason: 'cross_sector_disabled'`,
 * and intra-sector searches cannot step onto tiles belonging to another sector.
 */
export function inspectCrossSectorPath(
  state: PlanetState,
  from: AxialCoord,
  to: AxialCoord,
  opts?: FindHexPathOptions & { profile?: PathProfileId; sectorRadius?: number },
): CrossSectorPathReport {
  const sectorRadius = resolveStateSectorRadius(state, opts?.sectorRadius);
  const hex = hexIndex(state.grid.radius);
  const fromIdx = hex.indexOf(from.q, from.r);
  const toIdx = hex.indexOf(to.q, to.r);
  const startSectorId = globalTileToSector(from.q, from.r, sectorRadius).sectorId;
  const goalSectorId = globalTileToSector(to.q, to.r, sectorRadius).sectorId;

  const makeFail = (reason: CrossSectorPathRejectReason, visited: readonly SectorId[] = []): CrossSectorPathReport => ({
    ok: false,
    reason,
    path: [],
    expansions: 0,
    totalCostBp: 0,
    sectorRadius,
    startSectorId,
    goalSectorId,
    visitedSectors: visited,
    pathSectorIds: [],
    sectorTransitions: [],
    seamCrossings: [],
    crossesSectorBoundary: false,
    zeroSeamPenalty: true,
  });

  if (fromIdx < 0) return makeFail('start_out_of_bounds');
  if (toIdx < 0) return makeFail('goal_out_of_bounds', [startSectorId]);
  if (!isGroundPassable(state.grid, fromIdx, opts?.data)) return makeFail('start_blocked', [startSectorId]);

  const blockers = opts?.profile ? pathBlockersFor(state, opts.profile, fromIdx, opts?.data) : undefined;
  if (!opts?.band && (!isGroundPassable(state.grid, toIdx, opts?.data) || (opts?.blocked?.(toIdx) ?? blockers?.blocked(toIdx) ?? false))) {
    if (startSectorId === goalSectorId) return makeFail('goal_blocked', [startSectorId]);
  }
  if (startSectorId !== goalSectorId) {
    return makeFail('cross_sector_disabled', [startSectorId]);
  }

  const sameSectorOnly = (tileIdx: number): boolean =>
    tileIdx >= 0 &&
    tileIdx < hex.count &&
    globalTileToSector(hex.q[tileIdx]!, hex.r[tileIdx]!, sectorRadius).sectorId !== startSectorId;
  const baseBlocked = opts?.blocked ?? blockers?.blocked;
  const baseGoalBlocked = opts?.goalBlocked ?? blockers?.goalBlocked ?? baseBlocked;
  const searchOpts: FindHexPathOptions = {
    ...opts,
    blocked: baseBlocked ? (i) => sameSectorOnly(i) || baseBlocked(i) : sameSectorOnly,
    goalBlocked: baseGoalBlocked ? (i) => sameSectorOnly(i) || baseGoalBlocked(i) : sameSectorOnly,
  };

  const res = findHexPath(state, from, to, searchOpts);
  const pathSectorIds: SectorId[] = [];
  const visitedSectors: SectorId[] = [];
  const seenSectors = new Set<SectorId>();
  let sumStepCostBp = 0;

  for (let i = 0; i < res.path.length; i++) {
    const pt = res.path[i]!;
    const secId = globalTileToSector(pt.q, pt.r, sectorRadius).sectorId;
    pathSectorIds.push(secId);
    if (!seenSectors.has(secId)) {
      seenSectors.add(secId);
      visitedSectors.push(secId);
    }
    if (i > 0) {
      const tileIdx = hex.indexOf(pt.q, pt.r);
      const expectedTileCostBp = tileIdx >= 0 ? tileStepCostBp(state, tileIdx, opts?.data) : 0;
      sumStepCostBp += expectedTileCostBp;
    }
  }

  return {
    ...res,
    ...(res.ok ? {} : { reason: 'unreachable' as const }),
    sectorRadius,
    startSectorId,
    goalSectorId,
    visitedSectors: visitedSectors.length > 0 ? visitedSectors : [startSectorId],
    pathSectorIds,
    sectorTransitions: [],
    seamCrossings: [],
    crossesSectorBoundary: false,
    zeroSeamPenalty: !res.ok || sumStepCostBp === res.totalCostBp,
  };
}

let cachedDefaultPlacementData: CompiledDataLike | null = null;
function defaultCrossSectorPlacementData(): CompiledDataLike {
  if (!cachedDefaultPlacementData) {
    cachedDefaultPlacementData = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W07', 'W10']));
  }
  return cachedDefaultPlacementData;
}

/**
 * Evaluates building placement on `state` with strict W11 sector isolation:
 * placements outside the colony's founding sector or straddling a sector boundary are rejected with `reason: 'cross_sector_disabled'`.
 */
export function evaluateCrossSectorPlacement(
  state: PlanetState,
  optsOrColonyId: (EvaluatePlacementOpts & { sectorRadius?: number }) | number,
  defId?: string,
  qArg?: number,
  rArg?: number,
): CrossSectorPlacementResult {
  const opts: EvaluatePlacementOpts & { sectorRadius?: number } =
    typeof optsOrColonyId === 'number'
      ? { colonyId: optsOrColonyId, building: defId, q: qArg ?? 0, r: rArg ?? 0 }
      : optsOrColonyId;
  const sectorRadius = resolveStateSectorRadius(state, opts.sectorRadius);
  const world = { ...placementWorldFromState(state), sectorRadius };
  const res = evaluatePlacement(world, {
    data: opts.data ?? defaultCrossSectorPlacementData(),
    ...opts,
  });
  const anchorSectorId = globalTileToSector(opts.q, opts.r, sectorRadius).sectorId;
  const foundingMap = resolveColonyFoundingSectorMap(state);
  const foundingSectorId = foundingMap.get(opts.colonyId) ?? anchorSectorId;
  const sectorSet = new Set<SectorId>();
  const tiles: CrossSectorPlacementTile[] = res.tiles.map((t) => {
    const sectorId = globalTileToSector(t.q, t.r, sectorRadius).sectorId;
    sectorSet.add(sectorId);
    return { ...t, sectorId };
  });
  const footprintSectorIds = [...sectorSet].sort();
  const straddlesSectorBoundary = footprintSectorIds.length > 1;
  const crossesFromFoundingSector = anchorSectorId !== foundingSectorId;

  if (crossesFromFoundingSector || straddlesSectorBoundary) {
    return {
      ...res,
      ok: false,
      reason: 'cross_sector_disabled',
      code: 'terrain_unbuildable',
      block: 'outOfMap',
      sectorRadius,
      anchorSectorId,
      foundingSectorId,
      crossesFromFoundingSector,
      footprintSectorIds,
      footprintSectors: footprintSectorIds,
      footprintTileCount: tiles.length,
      straddlesSectorBoundary,
      tiles: tiles.map((t) =>
        t.sectorId !== foundingSectorId || straddlesSectorBoundary ? { ...t, ok: false, block: 'outOfMap' } : t,
      ),
    };
  }

  return {
    ...res,
    sectorRadius,
    anchorSectorId,
    foundingSectorId,
    crossesFromFoundingSector: false,
    footprintSectorIds,
    footprintSectors: footprintSectorIds,
    footprintTileCount: tiles.length,
    straddlesSectorBoundary: false,
    tiles,
  };
}

/**
 * Claims territory around `(q, r)` clamped strictly to `centerSectorId` (never crossing sector boundaries).
 */
export function claimCrossSectorTerritory(
  state: PlanetState,
  optsOrColonyId: (ClaimTerritoryOpts & { sectorRadius?: number }) | number,
  qArg?: number,
  rArg?: number,
  radiusArg?: number,
  tickArg?: number,
): CrossSectorTerritoryClaimReport {
  const opts: ClaimTerritoryOpts & { sectorRadius?: number } =
    typeof optsOrColonyId === 'number'
      ? { colonyId: optsOrColonyId, q: qArg ?? 0, r: rArg ?? 0, radius: radiusArg, tick: tickArg }
      : optsOrColonyId;
  const sectorRadius = resolveStateSectorRadius(state, opts.sectorRadius);
  const centerSectorId = globalTileToSector(opts.q, opts.r, sectorRadius).sectorId;
  const res = claimTerritoryRadius(state, opts);
  const claimedBySector: Record<SectorId, number> = { [centerSectorId]: res.claimedCount };
  return {
    ...res,
    sectorRadius,
    centerSectorId,
    claimedBySector,
    claimedSectorIds: [centerSectorId],
    spansMultipleSectors: false,
  };
}

/**
 * Inspects a colony's power relay graph (`buildPowerGraph`) and power evaluation (`evaluateColonyPower`)
 * across sector boundaries on `state`.
 */
export function inspectCrossSectorPowerGrid(
  state: PlanetState,
  colonyIndex = 0,
  data?: CompiledDataLike,
): CrossSectorPowerGridReport {
  const sectorRadius = resolveStateSectorRadius(state);
  const resolvedData = data ?? defaultCrossSectorPlacementData();
  const graph = buildPowerGraph(state, colonyIndex, resolvedData);
  const powerSummary = evaluateColonyPower(state, colonyIndex, resolvedData, state.meta.tick);

  const relaySectorById: Record<number, SectorId> = {};
  const componentSectorsMap = new Map<number, Set<SectorId>>();
  const markCompSector = (compId: number, secId: SectorId): void => {
    if (compId < 0) return;
    let set = componentSectorsMap.get(compId);
    if (!set) componentSectorsMap.set(compId, (set = new Set<SectorId>()));
    set.add(secId);
  };

  for (const rNode of graph.relayNodes) {
    const secId = globalTileToSector(rNode.q, rNode.r, sectorRadius).sectorId;
    relaySectorById[rNode.id] = secId;
    markCompSector(rNode.componentId, secId);
  }

  const crossSectorRelayLinks: CrossSectorRelayLink[] = [];
  for (let i = 0; i < graph.relayNodes.length; i++) {
    for (let j = i + 1; j < graph.relayNodes.length; j++) {
      const a = graph.relayNodes[i]!;
      const b = graph.relayNodes[j]!;
      const sectorA = relaySectorById[a.id]!;
      const sectorB = relaySectorById[b.id]!;
      if (sectorA !== sectorB) continue;
      if (!relaysLinked(state, a, b)) continue;
    }
  }

  const buildingSectorById: Record<number, SectorId> = {};
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    const id = cols.id[row]!;
    const compId = graph.componentByBuildingId.get(id);
    if (compId === undefined) continue;
    const secId = globalTileToSector(cols.q[row]!, cols.r[row]!, sectorRadius).sectorId;
    buildingSectorById[id] = secId;
    markCompSector(compId, secId);
  }

  const sectorsByComponent: Record<number, readonly SectorId[]> = {};
  for (const [compId, secSet] of [...componentSectorsMap.entries()].sort((a, b) => a[0] - b[0])) {
    sectorsByComponent[compId] = [...secSet].sort();
  }

  const hubComponent = graph.components.find((c) => c.hasHub) ?? graph.components[0];
  const connectedSectorIds = hubComponent ? (sectorsByComponent[hubComponent.componentId] ?? []).slice(0, 1) : [];

  return {
    colonyIndex,
    sectorRadius,
    graph,
    powerSummary,
    relaySectorById,
    buildingSectorById,
    crossSectorRelayLinks,
    sectorsByComponent,
    connectedSectorIds,
    spansMultipleSectors: false,
  };
}

/** Counts explored tiles per sector for `colonyIndex` using `isColonyTileExplored`. */
export function countExploredTilesBySector(
  state: PlanetState,
  colonyIndex: number,
): Readonly<Record<SectorId, number>> {
  const sectorRadius = resolveStateSectorRadius(state);
  const blob = getAtlasBlob(state);
  const counts: Record<SectorId, number> = {};
  if (blob) {
    for (const s of blob.sectors) counts[s.sectorId] = 0;
  }
  const hex = hexIndex(state.grid.radius);
  for (let i = 0; i < state.grid.count; i++) {
    if (!isColonyTileExplored(state.grid, i, colonyIndex)) continue;
    const secId = globalTileToSector(hex.q[i]!, hex.r[i]!, sectorRadius).sectorId;
    counts[secId] = (counts[secId] ?? 0) + 1;
  }
  return counts;
}

/** Returns the sorted list of `SectorId`s that have at least one explored tile for `colonyIndex`. */
export function exploredSectorIdsForColony(state: PlanetState, colonyIndex: number): SectorId[] {
  const counts = countExploredTilesBySector(state, colonyIndex);
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([sectorId]) => sectorId)
    .sort();
}
