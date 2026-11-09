import {
  deriveSectorOccupancy,
  MAP_LAYER_META,
  W11_DEFAULT_SECTOR_RADIUS,
  type SectorId,
  type SectorKind,
  type SectorSummaryV1,
  type WorldAvailability,
} from '@terra/contracts';
import {
  ENTITY_KIND,
  globalTileToSector,
  HEX_DIRS,
  type AtlasBlobValue,
  type AtlasSectorBlobSummary,
} from '@terra/sim';
import { forEachEntity } from '../store/replica/viewCodec';
import { resolveMapAdapterForView, type AtlasMapAdapter } from './atlasMapAdapter';
import { extractViewAtlasBlob, SectorSelectionController } from './sectorSelection';
import type { MapLayer, MapLayerDrawView } from './types';

export { SectorSelectionController };

export interface SectorOverlayEntrySummary {
  readonly sectorId: SectorId;
  readonly kind: SectorKind;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly freeSeats: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly availability: WorldAvailability;
  readonly label: string;
  readonly occupancyText: string;
  readonly isSelected: boolean;
  readonly isHome: boolean;
  readonly isCurrentLocation: boolean;
}

export interface SectorMarkerCue {
  readonly sectorId: SectorId;
  readonly q: number;
  readonly r: number;
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface SectorLayerDrawSummary {
  readonly drawnSectorCount: number;
  readonly landSectorCount: number;
  readonly oceanSectorCount: number;
  readonly borderSegmentCount: number;
  readonly selectedSectorId: SectorId | null;
  readonly homeSectorId: SectorId | null;
  readonly currentSectorId: SectorId | null;
  readonly homeMarker: SectorMarkerCue | null;
  readonly locationMarker: SectorMarkerCue | null;
  readonly sectors: readonly SectorOverlayEntrySummary[];
}

function formatSectorOccupancyBadge(
  kind: SectorKind,
  freeSeats: number,
  validatedCapacity: number,
  availability: WorldAvailability,
): string {
  if (kind === 'ocean') return 'OCEAN';
  const ratio = `${freeSeats}/${validatedCapacity}`;
  if (availability === 'paused') return `${ratio} · PAUSED`;
  if (availability === 'faulted') return `${ratio} · FAULT`;
  if (freeSeats <= 0 || availability === 'full') return `${ratio} · FULL`;
  return ratio;
}

function resolveHomeAndLocationCue(
  view: MapLayerDrawView,
  sectorRadius: number,
  knownSectorIds: ReadonlySet<SectorId>,
  blob: AtlasBlobValue | null,
): {
  homeSectorId: SectorId | null;
  homeTile: { q: number; r: number } | null;
  currentSectorId: SectorId | null;
  cameraTile: { q: number; r: number } | null;
} {
  const ownColony = view.ownColonySlot ?? 0;
  let homeSectorId: SectorId | null =
    view.homeSectorId && knownSectorIds.has(view.homeSectorId) ? view.homeSectorId : null;
  let homeTile: { q: number; r: number } | null = view.homeTile ?? null;

  if (!homeSectorId && blob?.foundingSectorByColony?.[ownColony]) {
    const candidate = blob.foundingSectorByColony[ownColony]!;
    if (knownSectorIds.has(candidate)) homeSectorId = candidate;
  }
  if (!homeSectorId && view.clientView?.colonies) {
    const col = view.clientView.colonies.find((c) => c.index === ownColony) as
      | { foundingSectorId?: string }
      | undefined;
    if (col?.foundingSectorId && knownSectorIds.has(col.foundingSectorId)) {
      homeSectorId = col.foundingSectorId;
    }
  }
  if (!homeTile && view.clientView?.entities) {
    forEachEntity(view.clientView.entities, view.clientView.count, (row) => {
      if (row.owner !== ownColony || row.hp <= 0) return;
      if (
        row.kind === ENTITY_KIND.commandHub ||
        row.kind === ENTITY_KIND.pod ||
        row.kind === ENTITY_KIND.hq
      ) {
        homeTile = { q: Math.round(row.q), r: Math.round(row.r) };
        return false;
      }
      return undefined;
    });
  }
  if (!homeSectorId && homeTile) {
    const secId = globalTileToSector(homeTile.q, homeTile.r, sectorRadius).sectorId;
    if (knownSectorIds.has(secId)) homeSectorId = secId;
  }

  const cameraTile = view.cameraTile ?? null;
  let currentSectorId: SectorId | null =
    view.currentSectorId && knownSectorIds.has(view.currentSectorId) ? view.currentSectorId : null;
  if (!currentSectorId && cameraTile) {
    const secId = globalTileToSector(cameraTile.q, cameraTile.r, sectorRadius).sectorId;
    if (knownSectorIds.has(secId)) currentSectorId = secId;
  }
  if (!currentSectorId && blob?.presentSectorsByColony?.[ownColony]?.length) {
    const first = blob.presentSectorsByColony[ownColony]![0]!;
    if (knownSectorIds.has(first)) currentSectorId = first;
  }
  if (!currentSectorId && homeSectorId) {
    currentSectorId = homeSectorId;
  }

  return { homeSectorId, homeTile, currentSectorId, cameraTile };
}

interface RawSectorOverlaySource {
  readonly sectorId: SectorId;
  readonly kind: SectorKind;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly availability: WorldAvailability;
}

function collectRawSectorSources(
  view: MapLayerDrawView,
  adapter: AtlasMapAdapter,
  blob: AtlasBlobValue | null,
): { sectorRadius: number; list: RawSectorOverlaySource[] } {
  const sectorRadius =
    adapter.isAtlas
      ? adapter.sectorRadius
      : (blob?.sectorRadius ?? view.atlasManifest?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS);
  const summaryById = new Map<SectorId, SectorSummaryV1>(
    view.sectorSummaries?.map((s) => [s.sectorId, s]) ?? [],
  );
  const blobById = new Map<SectorId, AtlasSectorBlobSummary>(
    blob?.sectors.map((s) => [s.sectorId, s]) ?? [],
  );

  const manifestSectors = view.atlasManifest?.sectors ?? adapter.manifest?.sectors ?? null;
  const partitionSectors = adapter.partition?.sectors ?? null;
  const ids: SectorId[] = [];
  const seen = new Set<SectorId>();
  const addId = (id: SectorId) => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  manifestSectors?.forEach((s) => addId(s.sectorId));
  blob?.sectors.forEach((s) => addId(s.sectorId));
  view.sectorSummaries?.forEach((s) => addId(s.sectorId));
  partitionSectors?.forEach((s) => addId(s.sectorId));

  const manifestById = new Map(manifestSectors?.map((s) => [s.sectorId, s]) ?? []);
  const partById = new Map(partitionSectors?.map((s) => [s.sectorId, s]) ?? []);

  const list: RawSectorOverlaySource[] = [];
  for (const id of ids) {
    const sum = summaryById.get(id);
    const bl = blobById.get(id);
    const man = manifestById.get(id);
    const part = partById.get(id);
    const kind: SectorKind = sum?.kind ?? bl?.kind ?? man?.kind ?? part?.kind ?? 'land';
    const foundingCapacity =
      kind === 'ocean' ? 0 : (sum?.foundingCapacity ?? bl?.foundingCapacity ?? man?.foundingCapacity ?? 4);
    const validatedCapacity =
      kind === 'ocean'
        ? 0
        : (sum?.validatedCapacity ?? bl?.validatedSafeSites ?? man?.validatedSafeSites ?? foundingCapacity);
    const reservedSeats = kind === 'ocean' ? 0 : (sum?.reservedSeats ?? 0);
    const foundedSeats = kind === 'ocean' ? 0 : (sum?.foundedSeats ?? bl?.foundedSeats ?? 0);
    const derived = deriveSectorOccupancy({
      kind,
      foundingCapacity,
      validatedCapacity,
      reservedSeats,
      foundedSeats,
      livingColonies: sum?.livingColonies ?? bl?.livingColonies ?? foundedSeats,
      presentColonies: sum?.presentColonies ?? bl?.presentColonies ?? foundedSeats,
      onlinePlayers: sum?.onlinePlayers ?? 0,
    });
    const freeSeats = kind === 'ocean' ? 0 : (sum?.freeSeats ?? bl?.freeSeats ?? derived.freeSeats);
    const availability: WorldAvailability =
      kind === 'ocean' ? 'full' : (sum?.availability ?? (freeSeats <= 0 ? 'full' : derived.availability));
    list.push({
      sectorId: id,
      kind,
      macroQ: sum?.macroQ ?? bl?.macroQ ?? man?.macroQ ?? part?.macroQ ?? 0,
      macroR: sum?.macroR ?? bl?.macroR ?? man?.macroR ?? part?.macroR ?? 0,
      centerQ: sum?.centerQ ?? bl?.centerQ ?? man?.centerQ ?? part?.centerQ ?? 0,
      centerR: sum?.centerR ?? bl?.centerR ?? man?.centerR ?? part?.centerR ?? 0,
      radius: bl?.radius ?? man?.radius ?? part?.radius ?? sectorRadius,
      foundingCapacity,
      validatedCapacity,
      reservedSeats,
      foundedSeats,
      freeSeats,
      availability,
    });
  }
  return { sectorRadius, list };
}

function buildMarkerCue(
  view: MapLayerDrawView,
  sec: SectorOverlayEntrySummary | undefined,
  tile: { q: number; r: number } | null,
  prefix: 'HOME' | 'LOC',
): SectorMarkerCue | null {
  if (!sec) return null;
  const q = tile?.q ?? sec.centerQ;
  const r = tile?.r ?? sec.centerR;
  const pos = view.axialToPixel(q, r);
  return {
    sectorId: sec.sectorId,
    q,
    r,
    x: pos.x,
    y: pos.y,
    label: `${prefix} · ${sec.sectorId}`,
  };
}

export function resolveSectorOverlayModel(view: MapLayerDrawView): SectorLayerDrawSummary {
  const adapter = resolveMapAdapterForView(view);
  const blob = extractViewAtlasBlob(view.clientView ?? undefined);
  const { sectorRadius, list } = collectRawSectorSources(view, adapter, blob);
  if (list.length === 0) {
    return {
      drawnSectorCount: 0,
      landSectorCount: 0,
      oceanSectorCount: 0,
      borderSegmentCount: 0,
      selectedSectorId: null,
      homeSectorId: null,
      currentSectorId: null,
      homeMarker: null,
      locationMarker: null,
      sectors: [],
    };
  }

  const knownSectorIds = new Set<SectorId>(list.map((s) => s.sectorId));
  const selectedSectorId =
    view.selectedSectorId && knownSectorIds.has(view.selectedSectorId) ? view.selectedSectorId : null;
  const { homeSectorId, homeTile, currentSectorId, cameraTile } = resolveHomeAndLocationCue(
    view,
    sectorRadius,
    knownSectorIds,
    blob,
  );

  let landSectorCount = 0;
  let oceanSectorCount = 0;
  const sectors: SectorOverlayEntrySummary[] = list.map((raw) => {
    if (raw.kind === 'land') landSectorCount++;
    else oceanSectorCount++;
    const { x: pixelX, y: pixelY } = view.axialToPixel(raw.centerQ, raw.centerR);
    return {
      sectorId: raw.sectorId,
      kind: raw.kind,
      macroQ: raw.macroQ,
      macroR: raw.macroR,
      centerQ: raw.centerQ,
      centerR: raw.centerR,
      radius: raw.radius,
      pixelX,
      pixelY,
      freeSeats: raw.freeSeats,
      validatedCapacity: raw.validatedCapacity,
      reservedSeats: raw.reservedSeats,
      foundedSeats: raw.foundedSeats,
      availability: raw.availability,
      label: raw.sectorId,
      occupancyText: formatSectorOccupancyBadge(
        raw.kind,
        raw.freeSeats,
        raw.validatedCapacity,
        raw.availability,
      ),
      isSelected: raw.sectorId === selectedSectorId,
      isHome: raw.sectorId === homeSectorId,
      isCurrentLocation: raw.sectorId === currentSectorId,
    };
  });

  const byId = new Map(sectors.map((s) => [s.sectorId, s]));
  const homeMarker = buildMarkerCue(
    view,
    homeSectorId ? byId.get(homeSectorId) : undefined,
    homeTile,
    'HOME',
  );
  const locationMarker = buildMarkerCue(
    view,
    currentSectorId ? byId.get(currentSectorId) : undefined,
    cameraTile,
    'LOC',
  );

  return {
    drawnSectorCount: sectors.length,
    landSectorCount,
    oceanSectorCount,
    borderSegmentCount: sectors.length * 6,
    selectedSectorId,
    homeSectorId,
    currentSectorId,
    homeMarker,
    locationMarker,
    sectors,
  };
}

function drawSectorMacroHexBoundary(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  sec: SectorOverlayEntrySummary,
): void {
  ctx.beginPath();
  const reach = sec.radius + 0.5;
  for (let k = 0; k < HEX_DIRS.length; k++) {
    const [dq, dr] = HEX_DIRS[k]!;
    const { x, y } = view.axialToPixel(sec.centerQ + dq * reach, sec.centerR + dr * reach);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintSingleSectorOverlay(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  sec: SectorOverlayEntrySummary,
): void {
  drawSectorMacroHexBoundary(ctx, view, sec);
  if (sec.isSelected) {
    ctx.fillStyle = 'rgba(255, 107, 26, 0.16)';
    ctx.fill();
    ctx.setLineDash([7, 2]);
    ctx.strokeStyle = '#FF6B1A';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  } else if (sec.isHome) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.fill();
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (sec.kind === 'land') {
    ctx.fillStyle = sec.isCurrentLocation ? 'rgba(56, 189, 248, 0.08)' : 'rgba(30, 58, 95, 0.24)';
    ctx.fill();
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = 'rgba(82, 180, 255, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(14, 34, 58, 0.38)';
    ctx.fill();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(138, 147, 166, 0.48)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = sec.kind === 'land' ? 'bold 10px monospace' : '9px monospace';
  ctx.fillStyle = sec.isSelected ? '#FF6B1A' : sec.kind === 'land' ? '#F2F5FA' : '#8A93A6';
  ctx.fillText(sec.label, sec.pixelX, sec.pixelY - 5);

  ctx.font = '9px monospace';
  ctx.fillStyle =
    sec.availability === 'full' && sec.kind === 'land'
      ? '#F04848'
      : sec.isSelected
        ? '#FF6B1A'
        : '#52B4FF';
  ctx.fillText(sec.occupancyText, sec.pixelX, sec.pixelY + 6);

  if (sec.isSelected) {
    ctx.fillStyle = '#FF6B1A';
    ctx.fillText('SELECTED', sec.pixelX, sec.pixelY + 16);
  }
}

export function drawSectorsLayer(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
): SectorLayerDrawSummary {
  const summary = resolveSectorOverlayModel(view);
  if (summary.drawnSectorCount === 0) return summary;

  ctx.save();
  for (const sec of summary.sectors) {
    paintSingleSectorOverlay(ctx, view, sec);
  }

  if (summary.homeMarker) {
    const hm = summary.homeMarker;
    ctx.setLineDash([]);
    ctx.fillStyle = '#38BDF8';
    ctx.strokeStyle = '#0B0E13';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hm.x, hm.y, Math.max(3.5, view.tilePixelRadius * 0.9), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 9px monospace';
    ctx.fillText(hm.label, hm.x, hm.y - 12);
  }

  if (
    summary.locationMarker &&
    (!summary.homeMarker || summary.locationMarker.sectorId !== summary.homeMarker.sectorId)
  ) {
    const lm = summary.locationMarker;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#F2F5FA';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lm.x, lm.y, Math.max(3, view.tilePixelRadius * 0.75), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#F2F5FA';
    ctx.font = '9px monospace';
    ctx.fillText(lm.label, lm.x, lm.y + 14);
  }

  ctx.restore();
  return summary;
}

export function createSectorsMapLayer(): MapLayer {
  return {
    ...MAP_LAYER_META.sectors,
    draw(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): void {
      drawSectorsLayer(ctx, view);
    },
  };
}
