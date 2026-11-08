import {
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_SECTOR_RADIUS,
  type SectorId,
} from '@terra/contracts';
import { ENTITY_KIND } from '../ecs/columns';
import { hexIndex } from '../grid/hex';
import type { PlanetState } from '../kernel/state';
import { getAtlasBlob } from './generateAtlas';
import { globalTileToSector } from './partition';
import { buildSmallAtlasPartition } from './smallAtlas';
import type { AtlasSectorBlobSummary } from './types';

export type FoundingSectorLookupInput =
  | ReadonlyMap<number, SectorId>
  | Readonly<Record<number, SectorId>>;

export function resolveAtlasSectorSummaries(state: PlanetState): {
  sectorRadius: number;
  sectors: readonly AtlasSectorBlobSummary[];
} {
  const blob = getAtlasBlob(state);
  const sectorRadius = blob?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  if (blob?.sectors && blob.sectors.length > 0) {
    return { sectorRadius, sectors: blob.sectors };
  }
  const partition = buildSmallAtlasPartition({ sectorRadius });
  const seats = blob?.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const sectors: AtlasSectorBlobSummary[] = partition.sectors.map((s) => ({
    sectorId: s.sectorId,
    ordinal: s.ordinal,
    kind: s.kind,
    continentId: s.continentId,
    macroQ: s.macroQ,
    macroR: s.macroR,
    centerQ: s.centerQ,
    centerR: s.centerR,
    radius: s.radius,
    tileCount: s.tileCount,
    foundingCapacity: s.kind === 'land' ? seats : 0,
  }));
  return { sectorRadius, sectors };
}

export function isColonyLivingInState(state: PlanetState, colonyIndex: number): boolean {
  if (!Number.isInteger(colonyIndex) || colonyIndex < 0) return false;
  const col = state.colonies[colonyIndex];
  if (col && (col.status === 'eliminated' || col.status === 'settled')) return false;
  return true;
}

function defaultFootprintForKind(kind: number): number {
  if (kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.roboticsFactory) return 3;
  if (
    kind === ENTITY_KIND.metalsExtractor ||
    kind === ENTITY_KIND.solar ||
    kind === ENTITY_KIND.capacitor ||
    kind === ENTITY_KIND.wind ||
    kind === ENTITY_KIND.thermal ||
    kind === ENTITY_KIND.supplyDepot ||
    kind === ENTITY_KIND.mineralsQuarry ||
    kind === ENTITY_KIND.waterExtractor ||
    kind === ENTITY_KIND.petroleumWell ||
    kind === ENTITY_KIND.tradeHub
  ) {
    return 2;
  }
  return 1;
}

function entityCoveredTiles(
  q: number,
  r: number,
  w: number,
  d: number,
  rot: number,
): Array<{ q: number; r: number }> {
  const width = Math.max(1, w || 1);
  const depth = Math.max(1, d || 1);
  if (width === 1 && depth === 1) return [{ q, r }];
  const swap = rot % 2 !== 0;
  const fw = swap ? depth : width;
  const fd = swap ? width : depth;
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  const out: Array<{ q: number; r: number }> = [];
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      out.push({ q: q + minQ + dq, r: r + minR + dr });
    }
  }
  return out;
}

function applyFoundingInput(
  target: Map<number, SectorId>,
  input: FoundingSectorLookupInput | undefined,
  knownSectorIds: ReadonlySet<SectorId>,
): void {
  if (!input) return;
  const entries: Iterable<[number | string, SectorId]> =
    input instanceof Map ? input.entries() : Object.entries(input as Record<string, SectorId>);
  for (const [rawCol, sectorId] of entries) {
    const colIdx = Number(rawCol);
    if (!Number.isInteger(colIdx) || colIdx < 0 || target.has(colIdx)) continue;
    if (typeof sectorId === 'string' && knownSectorIds.has(sectorId)) {
      target.set(colIdx, sectorId);
    }
  }
}

function fallbackEntityFoundingSector(
  state: PlanetState,
  colonyIndex: number,
  sectorRadius: number,
  knownSectorIds: ReadonlySet<SectorId>,
): SectorId | null {
  const cols = state.entities.cols;
  const hubEntityId = state.colonies[colonyIndex]?.hubEntityId;
  let bestRow = -1;
  let bestRank = 99;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    const kind = cols.kind[row];
    const rank =
      typeof hubEntityId === 'number' && cols.id[row] === hubEntityId
        ? 0
        : kind === ENTITY_KIND.pod
          ? 1
          : kind === ENTITY_KIND.commandHub
            ? 2
            : kind === ENTITY_KIND.hq
              ? 3
              : 4;
    if (
      bestRow < 0 ||
      rank < bestRank ||
      (rank === bestRank &&
        (cols.createdAt[row] < cols.createdAt[bestRow] || cols.id[row] < cols.id[bestRow]))
    ) {
      bestRow = row;
      bestRank = rank;
    }
  }
  if (bestRow < 0) return null;
  const secId = globalTileToSector(cols.q[bestRow]!, cols.r[bestRow]!, sectorRadius).sectorId;
  return knownSectorIds.has(secId) ? secId : null;
}

function applyLandingBlobsFounding(
  state: PlanetState,
  resolved: Map<number, SectorId>,
  sectorRadius: number,
  knownSectorIds: ReadonlySet<SectorId>,
): void {
  const rawHistory = state.blobs.landingHistory?.value;
  if (Array.isArray(rawHistory)) {
    for (const rec of rawHistory as Array<{ colony?: number; q?: number; r?: number }>) {
      if (typeof rec?.colony !== 'number' || rec.colony < 0 || resolved.has(rec.colony)) continue;
      if (typeof rec.q !== 'number' || typeof rec.r !== 'number') continue;
      const secId = globalTileToSector(rec.q, rec.r, sectorRadius).sectorId;
      if (knownSectorIds.has(secId)) resolved.set(rec.colony, secId);
    }
  }
  const rawPods = state.blobs.landingPods?.value;
  if (Array.isArray(rawPods)) {
    for (const pod of rawPods as Array<{ colonyId?: number; q?: number; r?: number }>) {
      if (typeof pod?.colonyId !== 'number' || pod.colonyId < 0 || resolved.has(pod.colonyId)) continue;
      if (typeof pod.q !== 'number' || typeof pod.r !== 'number') continue;
      const secId = globalTileToSector(pod.q, pod.r, sectorRadius).sectorId;
      if (knownSectorIds.has(secId)) resolved.set(pod.colonyId, secId);
    }
  }
}

export function resolveColonyFoundingSectorMap(
  state: PlanetState,
  foundingSectorByColony?: FoundingSectorLookupInput,
): Map<number, SectorId> {
  const { sectorRadius, sectors } = resolveAtlasSectorSummaries(state);
  const knownSectorIds = new Set<SectorId>(sectors.map((s) => s.sectorId));
  const resolved = new Map<number, SectorId>();

  applyFoundingInput(resolved, foundingSectorByColony, knownSectorIds);
  applyFoundingInput(resolved, getAtlasBlob(state)?.foundingSectorByColony, knownSectorIds);

  for (const col of state.colonies) {
    if (!col || !Number.isInteger(col.index) || col.index < 0 || resolved.has(col.index)) continue;
    const fSec = col.foundingSectorId;
    if (typeof fSec === 'string' && knownSectorIds.has(fSec)) {
      resolved.set(col.index, fSec);
    }
  }
  applyLandingBlobsFounding(state, resolved, sectorRadius, knownSectorIds);

  const candidateColonies = new Set<number>();
  for (const col of state.colonies) if (col && col.index >= 0) candidateColonies.add(col.index);
  for (let row = 0; row < state.entities.count; row++) {
    const owner = state.entities.cols.owner[row]!;
    if (owner >= 0) candidateColonies.add(owner);
  }
  for (const colIdx of [...candidateColonies].sort((a, b) => a - b)) {
    if (resolved.has(colIdx)) continue;
    const fallback = fallbackEntityFoundingSector(state, colIdx, sectorRadius, knownSectorIds);
    if (fallback) resolved.set(colIdx, fallback);
  }
  return resolved;
}

export function collectPresenceBySector(
  state: PlanetState,
  sectorRadius: number,
  knownSectorIds: ReadonlySet<SectorId>,
): {
  presentBySector: Map<SectorId, Set<number>>;
  presentByColony: Map<number, Set<SectorId>>;
  entityCountBySector: Map<SectorId, number>;
  ownedTileCountBySector: Map<SectorId, number>;
} {
  const presentBySector = new Map<SectorId, Set<number>>();
  const presentByColony = new Map<number, Set<SectorId>>();
  const entityCountBySector = new Map<SectorId, number>();
  const ownedTileCountBySector = new Map<SectorId, number>();

  const markPresent = (secId: SectorId, colonyIndex: number): void => {
    let colSet = presentBySector.get(secId);
    if (!colSet) presentBySector.set(secId, (colSet = new Set<number>()));
    colSet.add(colonyIndex);
    let secSet = presentByColony.get(colonyIndex);
    if (!secSet) presentByColony.set(colonyIndex, (secSet = new Set<SectorId>()));
    secSet.add(secId);
  };

  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    const owner = cols.owner[row]!;
    if (owner < 0 || !isColonyLivingInState(state, owner)) continue;
    if (cols.hpMax[row]! > 0 && cols.hp[row]! <= 0) continue;
    const anchorSec = globalTileToSector(cols.q[row]!, cols.r[row]!, sectorRadius).sectorId;
    if (knownSectorIds.has(anchorSec)) {
      markPresent(anchorSec, owner);
      entityCountBySector.set(anchorSec, (entityCountBySector.get(anchorSec) ?? 0) + 1);
    }
    const defFp = defaultFootprintForKind(cols.kind[row]!);
    const w = cols.footprintW?.[row] || defFp;
    const d = cols.footprintD?.[row] || defFp;
    if (w > 1 || d > 1) {
      for (const ft of entityCoveredTiles(cols.q[row]!, cols.r[row]!, w, d, cols.rot[row] ?? 0)) {
        const ftSec = globalTileToSector(ft.q, ft.r, sectorRadius).sectorId;
        if (knownSectorIds.has(ftSec)) markPresent(ftSec, owner);
      }
    }
  }

  const hex = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner;
  if (ownerLayer) {
    for (let i = 0; i < state.grid.count; i++) {
      const owner = ownerLayer[i]!;
      if (owner < 0) continue;
      const secId = globalTileToSector(hex.q[i]!, hex.r[i]!, sectorRadius).sectorId;
      if (!knownSectorIds.has(secId)) continue;
      ownedTileCountBySector.set(secId, (ownedTileCountBySector.get(secId) ?? 0) + 1);
      if (isColonyLivingInState(state, owner)) markPresent(secId, owner);
    }
  }
  return { presentBySector, presentByColony, entityCountBySector, ownedTileCountBySector };
}
