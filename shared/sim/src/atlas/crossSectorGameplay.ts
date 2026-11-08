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
import { getAtlasBlob } from './generateAtlas';
import { globalTileToSector } from './partition';

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

export interface CrossSectorPathReport extends HexPathResult {
  readonly sectorRadius: number;
  readonly startSectorId: SectorId;
  readonly goalSectorId: SectorId;
  readonly visitedSectors: readonly SectorId[];
  readonly pathSectorIds: readonly SectorId[];
  readonly sectorTransitions: readonly CrossSectorStepTransition[];
  readonly crossesSectorBoundary: boolean;
  readonly zeroSeamPenalty: boolean;
}

export interface CrossSectorPlacementTile extends PlacementTile {
  readonly sectorId: SectorId;
}

export interface CrossSectorPlacementResult extends Omit<PlacementResult, 'tiles'> {
  readonly sectorRadius: number;
  readonly anchorSectorId: SectorId;
  readonly footprintSectorIds: readonly SectorId[];
  readonly straddlesSectorBoundary: boolean;
  readonly tiles: CrossSectorPlacementTile[];
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

/**
 * Runs the shared A* hex pathfinder (`findHexPath`) across sector boundaries on `state`,
 * recording every visited `SectorId`, every cross-sector seam transition, and verifying
 * that cross-seam step costs match `tileStepCostBp` with zero artificial border penalty.
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
  const blockers = opts?.profile ? pathBlockersFor(state, opts.profile, fromIdx, opts.data) : undefined;
  const searchOpts: FindHexPathOptions = {
    ...opts,
    ...(blockers && !opts?.blocked ? { blocked: blockers.blocked } : {}),
    ...(blockers && !opts?.goalBlocked ? { goalBlocked: blockers.goalBlocked } : {}),
  };

  const res = findHexPath(state, from, to, searchOpts);
  const startSectorId = globalTileToSector(from.q, from.r, sectorRadius).sectorId;
  const goalSectorId = globalTileToSector(to.q, to.r, sectorRadius).sectorId;
  const pathSectorIds: SectorId[] = [];
  const visitedSectors: SectorId[] = [];
  const seenSectors = new Set<SectorId>();
  const sectorTransitions: CrossSectorStepTransition[] = [];
  let sumStepCostBp = 0;
  let zeroSeamPenalty = true;

  for (let i = 0; i < res.path.length; i++) {
    const pt = res.path[i]!;
    const secId = globalTileToSector(pt.q, pt.r, sectorRadius).sectorId;
    pathSectorIds.push(secId);
    if (!seenSectors.has(secId)) {
      seenSectors.add(secId);
      visitedSectors.push(secId);
    }
    if (i > 0) {
      const prev = res.path[i - 1]!;
      const prevSecId = pathSectorIds[i - 1]!;
      const tileIdx = hex.indexOf(pt.q, pt.r);
      const expectedTileCostBp = tileIdx >= 0 ? tileStepCostBp(state, tileIdx, opts?.data) : 0;
      sumStepCostBp += expectedTileCostBp;
      if (prevSecId !== secId) {
        if (expectedTileCostBp <= 0) zeroSeamPenalty = false;
        sectorTransitions.push({
          stepIndex: i,
          from: prev,
          to: pt,
          fromSectorId: prevSecId,
          toSectorId: secId,
          stepCostBp: expectedTileCostBp,
          expectedTileCostBp,
        });
      }
    }
  }

  if (res.ok && sumStepCostBp !== res.totalCostBp) {
    zeroSeamPenalty = false;
  }

  return {
    ...res,
    sectorRadius,
    startSectorId,
    goalSectorId,
    visitedSectors,
    pathSectorIds,
    sectorTransitions,
    crossesSectorBoundary: sectorTransitions.length > 0,
    zeroSeamPenalty,
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
 * Evaluates building placement on `state` using the shared `evaluatePlacement` rule (`D-37`)
 * and annotates the anchor and every footprint tile with its owning `SectorId`.
 */
export function evaluateCrossSectorPlacement(
  state: PlanetState,
  opts: EvaluatePlacementOpts & { sectorRadius?: number },
): CrossSectorPlacementResult {
  const sectorRadius = resolveStateSectorRadius(state, opts.sectorRadius);
  const res = evaluatePlacement(placementWorldFromState(state), {
    data: opts.data ?? defaultCrossSectorPlacementData(),
    ...opts,
  });
  const anchorSectorId = globalTileToSector(opts.q, opts.r, sectorRadius).sectorId;
  const sectorSet = new Set<SectorId>();
  const tiles: CrossSectorPlacementTile[] = res.tiles.map((t) => {
    const sectorId = globalTileToSector(t.q, t.r, sectorRadius).sectorId;
    sectorSet.add(sectorId);
    return { ...t, sectorId };
  });
  const footprintSectorIds = [...sectorSet].sort();

  return {
    ...res,
    sectorRadius,
    anchorSectorId,
    footprintSectorIds,
    straddlesSectorBoundary: footprintSectorIds.length > 1,
    tiles,
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
      if (!relaysLinked(a, b)) continue;
      const sectorA = relaySectorById[a.id]!;
      const sectorB = relaySectorById[b.id]!;
      if (sectorA !== sectorB) {
        crossSectorRelayLinks.push({
          relayIdA: a.id,
          relayIdB: b.id,
          kindA: a.kind,
          kindB: b.kind,
          qA: a.q,
          rA: a.r,
          qB: b.q,
          rB: b.r,
          sectorA,
          sectorB,
          componentId: a.componentId,
        });
      }
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
  const connectedSectorIds = hubComponent ? (sectorsByComponent[hubComponent.componentId] ?? []) : [];

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
    spansMultipleSectors: connectedSectorIds.length > 1,
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
