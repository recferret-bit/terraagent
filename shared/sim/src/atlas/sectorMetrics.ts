import {
  deriveSectorOccupancy,
  type ContinentId,
  type SectorId,
  type SectorKind,
  type WorldAvailability,
} from '@terra/contracts';
import { setBlob, type PlanetState } from '../kernel/state';
import { getAtlasBlob } from './generateAtlas';
import { globalTileToSector } from './partition';
import {
  collectPresenceBySector,
  isColonyLivingInState,
  resolveAtlasSectorSummaries,
  resolveColonyFoundingSectorMap,
  type FoundingSectorLookupInput,
} from './sectorPresence';
import type { AtlasSectorBlobSummary } from './types';

export {
  isColonyLivingInState,
  resolveColonyFoundingSectorMap,
  type FoundingSectorLookupInput,
};

export interface AtlasSectorColonyMetrics {
  readonly sectorId: SectorId;
  readonly ordinal: number;
  readonly kind: SectorKind;
  readonly continentId: ContinentId | null;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly tileCount: number;
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly presentColonies: number;
  readonly availability: WorldAvailability;
  readonly foundedColonyIndices: readonly number[];
  readonly livingColonyIndices: readonly number[];
  readonly presentColonyIndices: readonly number[];
  readonly presentEntityCount: number;
  readonly ownedTileCount: number;
}

export interface AtlasColonySectorMetricsReport {
  readonly sectorRadius: number;
  readonly sectors: readonly AtlasSectorColonyMetrics[];
  readonly bySectorId: ReadonlyMap<SectorId, AtlasSectorColonyMetrics>;
  readonly sectorsById: Readonly<Record<SectorId, AtlasSectorColonyMetrics>>;
  readonly foundingSectorByColony: Readonly<Record<number, SectorId>>;
  readonly presentSectorsByColony: Readonly<Record<number, readonly SectorId[]>>;
  readonly totalFoundedSeats: number;
  readonly totalFreeSeats: number;
  readonly totalLivingColonies: number;
  readonly totalPresentColonies: number;
  get(sectorId: SectorId): AtlasSectorColonyMetrics | undefined;
  readonly [sectorId: `sec_${string}`]: AtlasSectorColonyMetrics;
}

function buildSectorColonyMetricsEntry(
  state: PlanetState,
  sec: AtlasSectorBlobSummary,
  foundedColonyIndices: readonly number[],
  presentColonyIndices: readonly number[],
  presentEntityCount: number,
  ownedTileCount: number,
): AtlasSectorColonyMetrics {
  const livingColonyIndices = foundedColonyIndices.filter((c) => isColonyLivingInState(state, c));
  const foundedSeats = foundedColonyIndices.length;
  const livingColonies = livingColonyIndices.length;
  const presentColonies = presentColonyIndices.length;
  const validatedCapacity = sec.foundingCapacity;
  const reservedSeats = 0;
  const { freeSeats, availability } = deriveSectorOccupancy({
    kind: sec.kind,
    foundingCapacity: sec.foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    livingColonies,
    presentColonies,
    onlinePlayers: null,
  });

  return {
    sectorId: sec.sectorId,
    ordinal: sec.ordinal,
    kind: sec.kind,
    continentId: sec.continentId,
    macroQ: sec.macroQ,
    macroR: sec.macroR,
    centerQ: sec.centerQ,
    centerR: sec.centerR,
    radius: sec.radius,
    tileCount: sec.tileCount,
    foundingCapacity: sec.foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies,
    presentColonies,
    availability,
    foundedColonyIndices,
    livingColonyIndices,
    presentColonyIndices,
    presentEntityCount,
    ownedTileCount,
  };
}

/**
 * Computes per-sector colony metrics (`foundedSeats`, `livingColonies`, `presentColonies`, `freeSeats`)
 * enforcing the W11/W27 founding-seat invariant (MATCHMAKING §0.2 MM-05 / MM-33):
 * walking units, claiming territory, or building structures/pylons/hubs in another sector updates
 * `presentColonies` in that destination sector while NEVER changing its `foundedSeats` or `freeSeats`.
 */
export function computeAtlasSectorColonyMetrics(
  state: PlanetState,
  foundingSectorByColony?: FoundingSectorLookupInput,
): AtlasColonySectorMetricsReport {
  const { sectorRadius, sectors } = resolveAtlasSectorSummaries(state);
  const knownSectorIds = new Set<SectorId>(sectors.map((s) => s.sectorId));
  const foundingMap = resolveColonyFoundingSectorMap(state, foundingSectorByColony);
  const { presentBySector, presentByColony, entityCountBySector, ownedTileCountBySector } =
    collectPresenceBySector(state, sectorRadius, knownSectorIds, foundingMap);

  const foundedBySector = new Map<SectorId, number[]>();
  const foundingRecord: Record<number, SectorId> = {};
  for (const [colIdx, secId] of [...foundingMap.entries()].sort((a, b) => a[0] - b[0])) {
    foundingRecord[colIdx] = secId;
    const list = foundedBySector.get(secId);
    if (list) list.push(colIdx);
    else foundedBySector.set(secId, [colIdx]);
  }

  const presentRecord: Record<number, readonly SectorId[]> = {};
  for (const [colIdx, secSet] of [...presentByColony.entries()].sort((a, b) => a[0] - b[0])) {
    presentRecord[colIdx] = [...secSet].sort();
  }

  const bySectorId = new Map<SectorId, AtlasSectorColonyMetrics>();
  const sectorsById: Record<SectorId, AtlasSectorColonyMetrics> = {};
  const metricsList: AtlasSectorColonyMetrics[] = [];
  let totalFoundedSeats = 0;
  let totalFreeSeats = 0;
  let totalLivingColonies = 0;
  const allPresentLiving = new Set<number>();

  for (const sec of sectors) {
    const foundedColonyIndices = foundedBySector.get(sec.sectorId) ?? [];
    const presentColonyIndices = [...(presentBySector.get(sec.sectorId) ?? [])].sort((a, b) => a - b);
    for (const c of presentColonyIndices) allPresentLiving.add(c);
    const entry = buildSectorColonyMetricsEntry(
      state,
      sec,
      foundedColonyIndices,
      presentColonyIndices,
      entityCountBySector.get(sec.sectorId) ?? 0,
      ownedTileCountBySector.get(sec.sectorId) ?? 0,
    );
    metricsList.push(entry);
    bySectorId.set(sec.sectorId, entry);
    sectorsById[sec.sectorId] = entry;
    totalFoundedSeats += entry.foundedSeats;
    totalFreeSeats += entry.freeSeats;
    totalLivingColonies += entry.livingColonies;
  }

  const reportBase = {
    sectorRadius,
    sectors: metricsList,
    bySectorId,
    sectorsById,
    foundingSectorByColony: foundingRecord,
    presentSectorsByColony: presentRecord,
    totalFoundedSeats,
    totalFreeSeats,
    totalLivingColonies,
    totalPresentColonies: allPresentLiving.size,
    get: (sectorId: SectorId) => bySectorId.get(sectorId),
  };

  return Object.assign(reportBase, sectorsById) as AtlasColonySectorMetricsReport;
}

/**
 * Pins the founding sector of `colonyIndex` from `(q, r)` on an atlas planet if not already recorded.
 * Once a colony has a founding sector, subsequent movements, territory claims, or structures in other
 * sectors NEVER overwrite its founding sector unless `opts.overwrite` is explicitly true (pre-deploy pod relocate).
 */
export function recordAtlasColonyFounding(
  state: PlanetState,
  colonyIndex: number,
  q: number,
  r: number,
  tick: number = state.meta.tick,
  opts?: { overwrite?: boolean },
): SectorId | null {
  const blob = getAtlasBlob(state);
  if (!blob || !Number.isInteger(colonyIndex) || colonyIndex < 0) return null;
  const col = state.colonies[colonyIndex];
  const existing =
    blob.foundingSectorByColony?.[colonyIndex] ??
    (typeof col?.foundingSectorId === 'string' ? (col.foundingSectorId as SectorId) : undefined);
  if (existing && !opts?.overwrite) return existing;

  const sectorId = globalTileToSector(q, r, blob.sectorRadius).sectorId;
  if (!blob.sectors.some((s) => s.sectorId === sectorId)) return existing ?? null;

  if (col && col.foundingSectorId !== sectorId) {
    col.foundingSectorId = sectorId;
    col.changedAt = tick;
  }
  const nextFounding = { ...(blob.foundingSectorByColony ?? {}), [colonyIndex]: sectorId };
  setBlob(state, 'atlas', { ...blob, foundingSectorByColony: nextFounding }, tick);
  return sectorId;
}

function sameSectorList(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hasFoundingOrPresentChanged(
  blob: NonNullable<ReturnType<typeof getAtlasBlob>>,
  report: AtlasColonySectorMetricsReport,
): boolean {
  const prevFounding = blob.foundingSectorByColony ?? {};
  const nextFoundingKeys = Object.keys(report.foundingSectorByColony);
  if (Object.keys(prevFounding).length !== nextFoundingKeys.length) return true;
  for (const k of nextFoundingKeys) {
    const idx = Number(k);
    if (prevFounding[idx] !== report.foundingSectorByColony[idx]) return true;
  }
  const prevPresent = blob.presentSectorsByColony ?? {};
  const nextPresentKeys = Object.keys(report.presentSectorsByColony);
  if (Object.keys(prevPresent).length !== nextPresentKeys.length) return true;
  for (const k of nextPresentKeys) {
    const idx = Number(k);
    if (!sameSectorList(prevPresent[idx], report.presentSectorsByColony[idx] ?? [])) return true;
  }
  return false;
}

/**
 * Synchronizes `state.colonies[].foundingSectorId` / `presentSectorIds` and `state.blobs.atlas`
 * when a colony spawns, moves across a sector seam, claims territory, or builds/removes structures.
 */
export function syncAtlasColonySectorState(
  state: PlanetState,
  tick: number = state.meta.tick,
): AtlasColonySectorMetricsReport | null {
  const blob = getAtlasBlob(state);
  if (!blob) return null;
  const report = computeAtlasSectorColonyMetrics(state);

  for (const col of state.colonies) {
    if (!col || col.index < 0) continue;
    const fSec = report.foundingSectorByColony[col.index];
    if (fSec && !col.foundingSectorId) {
      col.foundingSectorId = fSec;
      col.changedAt = tick;
    }
    const pSecs = report.presentSectorsByColony[col.index] ?? [];
    if (!sameSectorList(col.presentSectorIds as string[] | undefined, pSecs)) {
      col.presentSectorIds = [...pSecs];
      col.changedAt = tick;
    }
  }

  let blobChanged = hasFoundingOrPresentChanged(blob, report);
  const nextSectors: AtlasSectorBlobSummary[] = blob.sectors.map((s) => {
    const m = report.bySectorId.get(s.sectorId);
    if (!m) return s;
    if (
      s.foundedSeats !== m.foundedSeats ||
      s.freeSeats !== m.freeSeats ||
      s.livingColonies !== m.livingColonies ||
      s.presentColonies !== m.presentColonies
    ) {
      blobChanged = true;
    }
    return {
      ...s,
      foundedSeats: m.foundedSeats,
      freeSeats: m.freeSeats,
      livingColonies: m.livingColonies,
      presentColonies: m.presentColonies,
    };
  });

  if (blobChanged) {
    setBlob(
      state,
      'atlas',
      {
        ...blob,
        sectors: nextSectors,
        foundingSectorByColony: report.foundingSectorByColony,
        presentSectorsByColony: report.presentSectorsByColony,
      },
      tick,
    );
  }
  return report;
}
