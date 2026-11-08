import {
  W11_DEFAULT_SECTOR_RADIUS,
  type AtlasManifestV1,
  type MapLayerId,
  type PlanetSummaryV1,
  type SectorId,
} from '@terra/contracts';
import { globalTileToSector, inHex, type AtlasBlobValue } from '@terra/sim';
import type { FeatureContext, GameView } from '../core/registry/types';
import type { ClientTiles, ClientView } from '../store/replica/viewCodec';
import {
  bindSectorChooserEvents,
  normalizeSectorIntent,
  renderSectorChooserHtml,
  type SectorIntentInput,
  type SectorIntentV1,
} from '../ui/lobby';
import type { AtlasMapAdapter } from './atlasMapAdapter';
import type { CompositeMapRenderResult } from './builtinLayers';
import type { TrapezoidCorner } from './cameraTrapezoid';
import type { GlobalMapOverlay } from './GlobalMapOverlay';
import type { GlobalMapViewport } from './globalMapViewport';
import type { MapLayerChipController } from './layerChipsState';
import type { MapLayerRegistry } from './layerRegistry';
import type { GlobalMapOpenCloseController } from './openCloseController';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  mapScaleForRadius,
  type PlanetRasterCache,
  type PlanetRasterEntry,
} from './rasterCache';
import type { MapRedrawScheduler } from './redrawScheduler';
import type { MapLayer, MapLayerDrawView, MinimapStats } from './types';

export function extractViewAtlasBlob(
  cv: Partial<ClientView> | undefined,
  view?: GameView,
): AtlasBlobValue | null {
  const raw = (cv?.blobs?.atlas ?? (view as { blobs?: Record<string, unknown> } | undefined)?.blobs?.atlas) as
    | AtlasBlobValue
    | { value?: AtlasBlobValue }
    | undefined;
  if (!raw || typeof raw !== 'object') return null;
  if ('value' in raw && raw.value && typeof raw.value === 'object') return raw.value;
  if ('sectors' in raw && Array.isArray((raw as AtlasBlobValue).sectors)) return raw as AtlasBlobValue;
  return null;
}

export class SectorSelectionController {
  selectedSectorId: SectorId | null = null;
  sectorIntent: SectorIntentV1 = { mode: 'auto' };
  homeSectorId: SectorId | null = null;
  homeTile: { q: number; r: number } | null = null;
  currentSectorId: SectorId | null = null;
  cameraTile: { q: number; r: number } | null = null;
  planetSummary: PlanetSummaryV1 | null = null;
  atlasManifest: AtlasManifestV1 | null = null;

  private readonly listeners = new Set<(intent: SectorIntentV1) => void>();
  private readonly onStateChange?: () => void;

  constructor(opts?: { readonly onStateChange?: () => void }) {
    this.onStateChange = opts?.onStateChange;
  }

  onIntentChange(fn: (intent: SectorIntentV1) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emitIntent(): void {
    for (const fn of this.listeners) fn(this.sectorIntent);
    this.onStateChange?.();
  }

  isSelectableLandSector(sectorId: SectorId, adapter?: AtlasMapAdapter | null): boolean {
    if (this.planetSummary) {
      const sec = this.planetSummary.sectors.find((s) => s.sectorId === sectorId);
      if (sec) return sec.kind === 'land';
    }
    const manifest = this.atlasManifest ?? adapter?.manifest;
    if (manifest) {
      const sec = manifest.sectors.find((s) => s.sectorId === sectorId);
      if (sec) return sec.kind === 'land';
    }
    if (adapter?.partition) {
      const sec = adapter.partition.sectorById.get(sectorId);
      if (sec) return sec.kind === 'land';
    }
    return /^sec_-?\d+_-?\d+$/.test(sectorId);
  }

  selectSector(
    sectorId: SectorId | 'auto' | null,
    adapter?: AtlasMapAdapter | null,
  ): SectorIntentV1 {
    if (!sectorId || sectorId === 'auto') {
      this.selectedSectorId = null;
      this.sectorIntent = { mode: 'auto' };
      this.emitIntent();
      return this.sectorIntent;
    }
    if (!this.isSelectableLandSector(sectorId, adapter)) {
      return this.sectorIntent;
    }
    this.selectedSectorId = sectorId;
    this.sectorIntent = { mode: 'chosen', sectorId };
    this.emitIntent();
    return this.sectorIntent;
  }

  setSectorIntent(
    input: SectorIntentInput,
    adapter?: AtlasMapAdapter | null,
  ): SectorIntentV1 {
    const normalized = normalizeSectorIntent(input);
    return normalized.mode === 'chosen'
      ? this.selectSector(normalized.sectorId, adapter)
      : this.selectSector('auto', adapter);
  }

  selectSectorAtTile(
    q: number,
    r: number,
    adapter: AtlasMapAdapter,
  ): SectorIntentV1 | null {
    const picked = adapter.pickTile(q, r);
    if (!picked.inAtlas || !picked.playable || picked.kind !== 'land' || !picked.sectorId) {
      return null;
    }
    return this.selectSector(picked.sectorId, adapter);
  }

  setHomeContext(opts: {
    readonly homeSectorId?: SectorId | null;
    readonly homeTile?: { readonly q: number; readonly r: number } | null;
    readonly currentSectorId?: SectorId | null;
    readonly cameraTile?: { readonly q: number; readonly r: number } | null;
    readonly sectorRadius?: number;
  }): void {
    const r = opts.sectorRadius ?? this.atlasManifest?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
    if (opts.homeTile !== undefined) {
      this.homeTile = opts.homeTile ? { q: opts.homeTile.q, r: opts.homeTile.r } : null;
    }
    if (opts.homeSectorId !== undefined) {
      this.homeSectorId = opts.homeSectorId ?? null;
    } else if (this.homeTile) {
      this.homeSectorId = globalTileToSector(this.homeTile.q, this.homeTile.r, r).sectorId;
    }
    if (opts.cameraTile !== undefined) {
      this.cameraTile = opts.cameraTile ? { q: opts.cameraTile.q, r: opts.cameraTile.r } : null;
    }
    if (opts.currentSectorId !== undefined) {
      this.currentSectorId = opts.currentSectorId ?? null;
    } else if (this.cameraTile) {
      this.currentSectorId = globalTileToSector(this.cameraTile.q, this.cameraTile.r, r).sectorId;
    }
    this.onStateChange?.();
  }

  reset(): void {
    this.selectedSectorId = null;
    this.sectorIntent = { mode: 'auto' };
    this.homeSectorId = null;
    this.homeTile = null;
    this.currentSectorId = null;
    this.cameraTile = null;
    this.onStateChange?.();
  }

  bindSectorPicker(
    container: HTMLElement,
    summary: PlanetSummaryV1,
    onSelect?: (intent: SectorIntentV1) => void,
    queuePaused = false,
  ): () => void {
    this.planetSummary = summary;
    container.innerHTML = renderSectorChooserHtml(
      summary.look,
      summary,
      this.sectorIntent,
      queuePaused,
    );
    bindSectorChooserEvents(container, (intent) => {
      this.setSectorIntent(intent);
    });
    return this.onIntentChange((intent) => {
      container.querySelectorAll<HTMLElement>('.sector-opt').forEach((btn) => {
        const isChosen =
          intent.mode === 'chosen' &&
          btn.dataset.sectorMode === 'chosen' &&
          btn.dataset.sectorId === intent.sectorId;
        const isAuto = intent.mode === 'auto' && btn.dataset.sectorMode === 'auto';
        const active = isChosen || isAuto;
        btn.classList.toggle('sel', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      onSelect?.(intent);
    });
  }
}

export function projectTileToGlobalCanvasPx(
  q: number,
  r: number,
  canvas: HTMLCanvasElement,
  viewport: GlobalMapViewport,
  adapter: AtlasMapAdapter,
): { x: number; y: number } {
  const { zoom, panX, panY } = viewport.transform;
  const S = Math.max(1, Math.min(canvas.width, canvas.height));
  const { x: sx, y: sy } = adapter.axialToPixel(q, r, S);
  return {
    x: (sx + (canvas.width - S) / 2 - canvas.width / 2) * zoom + canvas.width / 2 + panX,
    y: (sy + (canvas.height - S) / 2 - canvas.height / 2) * zoom + canvas.height / 2 + panY,
  };
}

export function projectGlobalCanvasPxToTile(
  px: number,
  py: number,
  canvas: HTMLCanvasElement,
  viewport: GlobalMapViewport,
  adapter: AtlasMapAdapter,
  radius: number,
  tileCount?: number,
): {
  q: number;
  r: number;
  inside: boolean;
  playable: boolean;
  sectorId: SectorId | null;
} {
  const { zoom, panX, panY } = viewport.transform;
  const S = Math.max(1, Math.min(canvas.width, canvas.height));
  const sx = (px - canvas.width / 2 - panX) / zoom + canvas.width / 2 - (canvas.width - S) / 2;
  const sy = (py - canvas.height / 2 - panY) / zoom + canvas.height / 2 - (canvas.height - S) / 2;
  const { q, r } = adapter.pixelToAxial(sx, sy, S);
  if (adapter.isAtlas) {
    const picked = adapter.pickTile(q, r, tileCount);
    return {
      q: picked.q,
      r: picked.r,
      inside: picked.inAtlas,
      playable: picked.playable,
      sectorId: picked.sectorId,
    };
  }
  const inside = inHex(q, r, radius);
  return { q, r, inside, playable: inside, sectorId: null };
}

export function formatGlobalMapReadoutText(params: {
  readonly zoom: number;
  readonly centre: { q: number; r: number; inside: boolean; sectorId: SectorId | null };
  readonly cursor: { q: number; r: number; inside: boolean; sectorId: SectorId | null } | null;
  readonly w11Enabled: boolean;
  readonly selectedSectorId: SectorId | null;
  readonly homeSectorId: SectorId | null;
}): string {
  const fmt = (t: { q: number; r: number; inside: boolean; sectorId: SectorId | null }) =>
    `${t.q},${t.r}${t.sectorId ? ` [${t.sectorId}]` : ''}${t.inside ? '' : ' (out)'}`;
  let text = `ZOOM ${params.zoom.toFixed(2)}×   CENTER ${fmt(params.centre)}`;
  if (params.cursor) text += `   CURSOR ${fmt(params.cursor)}`;
  if (params.w11Enabled && params.selectedSectorId) text += `   SECTOR ${params.selectedSectorId}`;
  if (params.w11Enabled && params.homeSectorId) text += `   HOME ${params.homeSectorId}`;
  return text;
}

export function bindGlobalOverlayPointerInteraction(opts: {
  readonly overlay: GlobalMapOverlay;
  readonly onHoverPx: (pt: { x: number; y: number } | null) => void;
  readonly onClickPx: (pt: { x: number; y: number }) => void;
}): () => void {
  const { canvas } = opts.overlay;
  let downPx: { x: number; y: number } | null = null;
  const toPx = (e: PointerEvent): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : canvas.width;
    const h = rect.height > 0 ? rect.height : canvas.height;
    if (w <= 0 || h <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / w) * canvas.width,
      y: ((e.clientY - rect.top) / h) * canvas.height,
    };
  };
  const onMove = (e: PointerEvent) => opts.onHoverPx(toPx(e));
  const onLeave = () => opts.onHoverPx(null);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    downPx = toPx(e);
  };
  const onUp = (e: PointerEvent) => {
    const up = toPx(e);
    const down = downPx;
    downPx = null;
    if (!down || !up || Math.hypot(up.x - down.x, up.y - down.y) > 4) return;
    opts.onClickPx(up);
  };
  opts.overlay.watchResize(() => opts.overlay.render());
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
  };
}

export function buildGlobalMapDrawView(params: {
  readonly size: number;
  readonly radius: number;
  readonly adapter: AtlasMapAdapter;
  readonly lastEntry: PlanetRasterEntry | null;
  readonly lastTiles: ClientTiles | null;
  readonly lastClientView: ClientView | null;
  readonly ctx: FeatureContext;
  readonly viewport: GlobalMapViewport;
  readonly sectorSelection: SectorSelectionController;
}): MapLayerDrawView {
  const { size, radius, adapter, lastEntry, lastTiles, lastClientView, ctx, viewport, sectorSelection } =
    params;
  const scale = mapScaleForRadius(size, radius);
  return {
    width: size,
    height: size,
    planetId: lastEntry?.planetKey ?? undefined,
    radius,
    tiles: lastTiles,
    clientView: lastClientView,
    simData: ctx.services.store?.simData?.() ?? undefined,
    ownColonySlot: ctx.services.colonyId ?? 0,
    axialToPixel: (q, r) =>
      adapter.isAtlas ? adapter.axialToPixel(q, r, size) : axialToCanvasPixel(q, r, size, radius),
    pixelToAxial: (x, y) =>
      adapter.isAtlas ? adapter.pixelToAxial(x, y, size) : canvasPixelToAxial(x, y, size, radius),
    tilePixelRadius: Math.max(2, scale / Math.sqrt(3)),
    transform: viewport.transform,
    rasterCanvas: lastEntry?.canvas ?? null,
    atlasAdapter: adapter.isAtlas ? adapter : null,
    atlasManifest: sectorSelection.atlasManifest ?? adapter.manifest,
    sectorSummaries: sectorSelection.planetSummary?.sectors ?? null,
    selectedSectorId: sectorSelection.selectedSectorId,
    homeSectorId: sectorSelection.homeSectorId,
    homeTile: sectorSelection.homeTile,
    currentSectorId: sectorSelection.currentSectorId,
    cameraTile: sectorSelection.cameraTile,
  };
}

export interface StatsProxySource {
  readonly rasterCache: PlanetRasterCache;
  readonly scheduler: MapRedrawScheduler;
  readonly openClose: GlobalMapOpenCloseController;
  readonly chipController: MapLayerChipController;
  readonly registry: MapLayerRegistry;
  readonly globalViewport: GlobalMapViewport;
  readonly sectorSelection: SectorSelectionController;
  getDotCount(): number;
  setDotCount(v: number): void;
  getTrapezoid(): TrapezoidCorner[];
  getLastComposite(): CompositeMapRenderResult | null;
  getLastAtlasHash(): string | null;
}

export function createMinimapStatsProxy(src: StatsProxySource): MinimapStats {
  return {
    get dirtyTiles() { return src.rasterCache.dirtyTiles; },
    set dirtyTiles(v: number) { src.rasterCache.dirtyTiles = v; },
    get totalRepaints() { return src.rasterCache.totalRepaints; },
    set totalRepaints(v: number) { src.rasterCache.totalRepaints = v; },
    get lastRadius() { return src.rasterCache.lastRadius; },
    set lastRadius(v: number) { src.rasterCache.lastRadius = v; },
    get lastPlanetId() { return src.rasterCache.lastPlanetKey; },
    set lastPlanetId(v: string | null) { src.rasterCache.lastPlanetKey = v; },
    get minimapRedraws() { return src.scheduler.minimapRedraws; },
    set minimapRedraws(_v: number) {},
    get globalMapRedraws() { return src.scheduler.globalMapRedraws; },
    set globalMapRedraws(_v: number) {},
    get minimapHz() { return src.scheduler.minimapHz(); },
    set minimapHz(_v: number) {},
    get globalMapHz() { return src.scheduler.globalMapHz(); },
    set globalMapHz(_v: number) {},
    get entityDotCount() { return src.getDotCount(); },
    set entityDotCount(v: number) { src.setDotCount(v); },
    get globalMapOpen() { return src.openClose.isOpen; },
    set globalMapOpen(v: boolean) { if (v) src.openClose.open(); else src.openClose.close(); },
    get activeLayers() { return src.chipController.getActiveLayerIds(); },
    set activeLayers(_v: MapLayerId[]) {},
    get registeredLayers() { return src.registry.all().map((l: MapLayer) => l.id); },
    set registeredLayers(_v: MapLayerId[]) {},
    get visibleLayers() { return src.chipController.getVisibleLayers().map((l: MapLayer) => l.id); },
    get trapezoid() { return src.getTrapezoid(); },
    get zoom() { return src.globalViewport.transform.zoom; },
    get panX() { return src.globalViewport.transform.panX; },
    get panY() { return src.globalViewport.transform.panY; },
    get lastComposite() { return src.getLastComposite(); },
    get selectedSectorId() { return src.sectorSelection.selectedSectorId; },
    get homeSectorId() { return src.sectorSelection.homeSectorId; },
    get sectorIntent() { return src.sectorSelection.sectorIntent; },
    get atlasHash() { return src.getLastAtlasHash(); },
    get viewerColony() { return src.rasterCache.lastViewerColony; },
  };
}
