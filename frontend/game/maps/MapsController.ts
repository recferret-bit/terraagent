import type { AtlasManifestV1, PlanetSummaryV1, SectorId } from '@terra/contracts';
import type { FeatureContext, GameView } from '../core/registry/types';
import type { ClientTiles, ClientView } from '../store/replica/viewCodec';
import type { SectorIntentInput, SectorIntentV1 } from '../ui/lobby';
import { createAtlasMapAdapter, type AtlasMapAdapter } from './atlasMapAdapter';
import { createBuiltinW04Layers, renderCompositeMapLayers, type CompositeMapRenderResult } from './builtinLayers';
import { drawCameraTrapezoid, type TrapezoidCorner } from './cameraTrapezoid';
import { drawEntityDots } from './entityDots';
import { GLOBAL_MAP_CANVAS_SIZE, GlobalMapOverlay } from './GlobalMapOverlay';
import { GlobalMapViewport } from './globalMapViewport';
import { MapLayerChipController } from './layerChipsState';
import { mapLayerRegistry, type MapLayerRegistry } from './layerRegistry';
import { MinimapHud } from './MinimapHud';
import { bindMinimapInput } from './minimapInput';
import { GlobalMapOpenCloseController, type MapNavAction } from './openCloseController';
import { PlanetRasterCache, type PlanetRasterEntry } from './rasterCache';
import { MapRedrawScheduler } from './redrawScheduler';
import { drawResourcesLayer } from './resourceLayer';
import {
  bindGlobalOverlayPointerInteraction,
  buildGlobalMapDrawView,
  createMinimapStatsProxy,
  extractViewAtlasBlob,
  formatGlobalMapReadoutText,
  projectGlobalCanvasPxToTile,
  projectTileToGlobalCanvasPx,
  SectorSelectionController,
} from './sectorSelection';
import { resolveTileColorFromTokens } from './tileColors';
import type { MapLayerDrawView, MinimapStats } from './types';
import { drawMapFog } from './visibility';

export interface MapsControllerOptions {
  readonly el: HTMLElement;
  readonly ctx: FeatureContext;
  readonly registry?: MapLayerRegistry;
  readonly rasterCache?: PlanetRasterCache;
}

export class MapsController {
  readonly registry: MapLayerRegistry;
  readonly rasterCache: PlanetRasterCache;
  readonly minimapHud: MinimapHud;
  readonly globalOverlay: GlobalMapOverlay;
  readonly globalViewport: GlobalMapViewport;
  readonly chipController: MapLayerChipController;
  readonly openClose: GlobalMapOpenCloseController;
  readonly scheduler: MapRedrawScheduler;
  readonly sectorSelection: SectorSelectionController;
  readonly stats: MinimapStats;

  private readonly ctx: FeatureContext;
  private readonly inputHandle: { dispose(): void; isDragging(): boolean };
  private readonly unbindOverlayPointer: () => void;
  private unregisterLayers: (() => void) | null = null;
  private lastEntry: PlanetRasterEntry | null = null;
  private lastTiles: ClientTiles | null = null;
  private lastClientView: ClientView | null = null;
  private currentAdapter: AtlasMapAdapter | null = null;
  private lastWorldContextKey = '';
  private lastPlanetId: string | null = null;
  private lastAtlasHash: string | null = null;
  private lastDotCount = 0;
  private lastTrapezoid: TrapezoidCorner[] = [];
  private lastComposite: CompositeMapRenderResult | null = null;
  private initialPainted = false;
  private prevCamKey = '';
  private cursorPx: { x: number; y: number } | null = null;
  private registeredFlagKey = '';

  constructor(opts: MapsControllerOptions) {
    this.ctx = opts.ctx;
    this.registry = opts.registry ?? mapLayerRegistry;
    this.rasterCache = opts.rasterCache ?? new PlanetRasterCache(resolveTileColorFromTokens);
    this.rasterCache.setColorResolver((tiles, idx, col) =>
      resolveTileColorFromTokens(tiles, idx, col ?? this.ctx.services.colonyId ?? 0),
    );
    this.sectorSelection = new SectorSelectionController({
      onStateChange: () => {
        this.updateReadout();
        this.scheduler.markDirty({ minimap: true, globalMap: true });
        if (this.openClose.isOpen) this.globalOverlay.render();
      },
    });
    this.chipController = new MapLayerChipController({
      registry: this.registry,
      getFlags: () => this.ctx.flags,
      onChange: () => {
        this.syncOverlayChips();
        this.minimapHud.setResourcesActive(this.chipController.isLayerActive('resources'));
        this.scheduler.forceRedrawMinimap();
        this.scheduler.forceRedrawGlobalMap();
      },
    });
    this.openClose = new GlobalMapOpenCloseController({
      isWaveEnabled: () => this.ctx.flags.has('W04'),
      getRtsCamera: () => this.ctx.services.rtsCamera ?? null,
      onNavigate: (action) => this.navigateGlobalMap(action),
      onStateChange: (open) => {
        this.globalOverlay.setOpen(open);
        if (open) {
          this.syncOverlayChips();
          this.scheduler.forceRedrawGlobalMap();
        }
      },
    });
    this.minimapHud = new MinimapHud({
      parent: opts.el,
      rasterCache: this.rasterCache,
      onExpandClick: () => this.openClose.open(),
      onResourcesToggle: (next) => this.chipController.setLayerActive('resources', next),
      onOverlayDraw: (ctx2d, drawView) => this.drawMinimapOverlays(ctx2d, drawView),
    });
    this.inputHandle = bindMinimapInput({
      container: this.minimapHud.el,
      canvas: this.minimapHud.canvas,
      expandButton: this.minimapHud.expandBtn,
      getRadius: () => this.getActiveRadius(),
      getAdapter: () => this.getActiveAdapter(),
      onPanToTile: (q, r) => this.panToTile(q, r),
    });
    this.globalOverlay = new GlobalMapOverlay({
      parent: opts.el.ownerDocument?.body ?? opts.el,
      onCloseClick: () => this.openClose.close(),
      onChipToggle: (id, active) => this.chipController.setLayerActive(id, active),
      onRender: (ctx2d, canvas) => this.drawGlobalMap(ctx2d, canvas),
      onRecenterClick: () => this.globalViewport.reset(),
    });
    this.globalViewport = new GlobalMapViewport({
      canvas: this.globalOverlay.canvas,
      baseSize: GLOBAL_MAP_CANVAS_SIZE,
      onChange: () => { if (this.openClose.isOpen) this.globalOverlay.render(); },
    });
    this.scheduler = new MapRedrawScheduler({
      isGlobalMapOpen: () => this.openClose.isOpen,
      onRedrawMinimap: () => this.minimapHud.render(),
      onRedrawGlobalMap: () => this.globalOverlay.render(),
    });
    this.unbindOverlayPointer = this.initOverlayPointer();
    this.stats = this.initStatsProxy();
    this.syncRegistration();
    this.syncOverlayChips();
  }

  private initOverlayPointer(): () => void {
    return bindGlobalOverlayPointerInteraction({
      overlay: this.globalOverlay,
      onHoverPx: (pt) => {
        this.cursorPx = pt;
        this.updateReadout();
      },
      onClickPx: (pt) => {
        if (this.ctx.flags.has('W11') && this.chipController.isLayerActive('sectors')) {
          this.selectSectorAtCanvasPx(pt.x, pt.y);
        }
      },
    });
  }

  private initStatsProxy(): MinimapStats {
    return createMinimapStatsProxy({
      rasterCache: this.rasterCache,
      scheduler: this.scheduler,
      openClose: this.openClose,
      chipController: this.chipController,
      registry: this.registry,
      globalViewport: this.globalViewport,
      sectorSelection: this.sectorSelection,
      getDotCount: () => this.lastDotCount,
      setDotCount: (v) => { this.lastDotCount = v; },
      getTrapezoid: () => this.lastTrapezoid,
      getLastComposite: () => this.lastComposite,
      getLastAtlasHash: () => this.lastAtlasHash,
    });
  }

  get atlasAdapter(): AtlasMapAdapter | null {
    return this.currentAdapter;
  }

  private navigateGlobalMap(action: MapNavAction): void {
    const vp = this.globalViewport;
    if (action.kind === 'reset') vp.reset();
    else if (action.kind === 'zoom') vp.setZoom(vp.transform.zoom * action.factor);
    else {
      const step = action.fast ? 160 : 56;
      vp.panBy(action.dx * step, action.dy * step);
    }
  }

  private getActiveRadius(): number {
    if (this.currentAdapter?.isAtlas) return this.currentAdapter.projectionRadius;
    return this.lastEntry?.radius ?? this.rasterCache.lastRadius ?? 12;
  }

  getActiveAdapter(): AtlasMapAdapter {
    if (this.currentAdapter) return this.currentAdapter;
    return createAtlasMapAdapter({
      w11Enabled: this.ctx.flags.has('W11'),
      radius: this.lastEntry?.radius ?? this.rasterCache.lastRadius ?? 12,
      tileCount: this.lastTiles?.count,
      manifest: this.sectorSelection.atlasManifest,
      planetSummary: this.sectorSelection.planetSummary,
    });
  }

  tileToGlobalCanvasPx(q: number, r: number): { x: number; y: number } {
    return projectTileToGlobalCanvasPx(q, r, this.globalOverlay.canvas, this.globalViewport, this.getActiveAdapter());
  }

  globalCanvasPxToTile(px: number, py: number) {
    return projectGlobalCanvasPxToTile(
      px, py, this.globalOverlay.canvas, this.globalViewport,
      this.getActiveAdapter(), this.getActiveRadius(), this.lastTiles?.count,
    );
  }

  private updateReadout(): void {
    if (!this.openClose.isOpen) return;
    const c = this.globalOverlay.canvas;
    this.globalOverlay.setReadout(
      formatGlobalMapReadoutText({
        zoom: this.globalViewport.transform.zoom,
        centre: this.globalCanvasPxToTile(c.width / 2, c.height / 2),
        cursor: this.cursorPx ? this.globalCanvasPxToTile(this.cursorPx.x, this.cursorPx.y) : null,
        w11Enabled: this.ctx.flags.has('W11'),
        selectedSectorId: this.sectorSelection.selectedSectorId,
        homeSectorId: this.sectorSelection.homeSectorId,
      }),
    );
  }

  selectSector(sectorId: SectorId | 'auto' | null): SectorIntentV1 {
    return this.ctx.flags.has('W11')
      ? this.sectorSelection.selectSector(sectorId, this.getActiveAdapter())
      : { mode: 'auto' };
  }

  setSectorIntent(intent: SectorIntentInput): SectorIntentV1 {
    return this.ctx.flags.has('W11')
      ? this.sectorSelection.setSectorIntent(intent, this.getActiveAdapter())
      : { mode: 'auto' };
  }

  getSectorIntent(): SectorIntentV1 { return this.sectorSelection.sectorIntent; }
  getSelectedSectorId(): SectorId | null { return this.sectorSelection.selectedSectorId; }

  selectSectorAtTile(q: number, r: number): SectorIntentV1 | null {
    return this.ctx.flags.has('W11')
      ? this.sectorSelection.selectSectorAtTile(q, r, this.getActiveAdapter())
      : null;
  }

  selectSectorAtCanvasPx(px: number, py: number): SectorIntentV1 | null {
    if (!this.ctx.flags.has('W11')) return null;
    const tile = this.globalCanvasPxToTile(px, py);
    return tile.inside && tile.playable && tile.sectorId ? this.selectSector(tile.sectorId) : null;
  }

  setHomeContext(opts: {
    readonly homeSectorId?: SectorId | null;
    readonly homeTile?: { readonly q: number; readonly r: number } | null;
    readonly currentSectorId?: SectorId | null;
    readonly cameraTile?: { readonly q: number; readonly r: number } | null;
  }): void {
    this.sectorSelection.setHomeContext(opts);
  }

  setPlanetSummary(summary: PlanetSummaryV1 | null): void {
    const prevId = this.sectorSelection.planetSummary?.id ?? null;
    const prevHash = this.sectorSelection.planetSummary?.atlasHash ?? null;
    if (summary && (prevId !== summary.id || prevHash !== (summary.atlasHash ?? null))) {
      this.sectorSelection.reset();
      this.currentAdapter = null;
      this.lastTiles = null;
    }
    this.sectorSelection.planetSummary = summary;
    this.scheduler.markDirty({ minimap: true, globalMap: true });
  }

  setAtlasManifest(manifest: AtlasManifestV1 | null): void {
    const prevHash = this.sectorSelection.atlasManifest?.atlasHash ?? null;
    if (manifest && prevHash && prevHash !== manifest.atlasHash) {
      this.sectorSelection.reset();
      this.currentAdapter = null;
      this.lastTiles = null;
    }
    this.sectorSelection.atlasManifest = manifest;
    this.scheduler.markDirty({ minimap: true, globalMap: true });
  }

  bindSectorPicker(
    container: HTMLElement,
    summary: PlanetSummaryV1,
    onSelect?: (intent: SectorIntentV1) => void,
    queuePaused = false,
  ): () => void {
    return this.sectorSelection.bindSectorPicker(container, summary, onSelect, queuePaused);
  }

  private drawMinimapOverlays(ctx2d: CanvasRenderingContext2D, drawView: MapLayerDrawView): void {
    if (this.chipController.isLayerActive('resources')) drawResourcesLayer(ctx2d, drawView);
    drawMapFog(ctx2d, drawView);
    this.lastDotCount = drawEntityDots(ctx2d, drawView).length;
    this.lastTrapezoid = drawCameraTrapezoid(ctx2d, drawView, {
      camera: this.ctx.services.camera ?? null,
      rtsCamera: this.ctx.services.rtsCamera ?? null,
    });
  }

  private drawGlobalMap(ctx2d: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const w = canvas.width || GLOBAL_MAP_CANVAS_SIZE;
    const h = canvas.height || GLOBAL_MAP_CANVAS_SIZE;
    const size = Math.max(1, Math.min(w, h));
    const drawView = buildGlobalMapDrawView({
      size,
      radius: this.getActiveRadius(),
      adapter: this.getActiveAdapter(),
      lastEntry: this.lastEntry,
      lastTiles: this.lastTiles,
      lastClientView: this.lastClientView,
      ctx: this.ctx,
      viewport: this.globalViewport,
      sectorSelection: this.sectorSelection,
    });
    ctx2d.save();
    this.globalViewport.applyToContext(ctx2d, w, h);
    ctx2d.translate((w - size) / 2, (h - size) / 2);
    ctx2d.imageSmoothingEnabled = false;
    this.lastComposite = renderCompositeMapLayers(
      ctx2d, drawView, this.chipController.getActiveSet(), this.chipController.getVisibleLayers(),
    );
    if (this.lastComposite.unitDots > 0) this.lastDotCount = this.lastComposite.unitDots;
    drawCameraTrapezoid(ctx2d, drawView, {
      camera: this.ctx.services.camera ?? null,
      rtsCamera: this.ctx.services.rtsCamera ?? null,
    });
    ctx2d.restore();
    this.updateReadout();
  }

  panToTile(q: number, r: number): void {
    this.ctx.services.focusTile?.(q, r, true);
    this.scheduler.forceRedrawMinimap();
    if (this.openClose.isOpen) this.scheduler.forceRedrawGlobalMap();
  }

  syncRegistration(): void {
    const enabled = this.ctx.flags.has('W04');
    const w11Enabled = this.ctx.flags.has('W11');
    this.minimapHud.setVisible(enabled);
    const flagKey = enabled ? [...this.ctx.flags].sort().join(',') : '';
    if (enabled && flagKey !== this.registeredFlagKey) {
      this.unregisterLayers?.();
      const builtins = createBuiltinW04Layers();
      const cleanups: Array<() => void> = [];
      for (const layer of Object.values(builtins)) {
        if (this.ctx.flags.has(layer.wave)) cleanups.push(this.registry.register(layer));
      }
      this.unregisterLayers = () => { for (const fn of cleanups) fn(); };
      if (!w11Enabled) {
        this.sectorSelection.reset();
        this.currentAdapter = null;
        this.lastTiles = null;
      }
      this.registeredFlagKey = flagKey;
      this.syncOverlayChips();
    } else if (!enabled && this.unregisterLayers) {
      this.unregisterLayers();
      this.unregisterLayers = null;
      this.registeredFlagKey = '';
      this.sectorSelection.reset();
      this.currentAdapter = null;
      this.lastTiles = null;
      this.openClose.close();
      this.rasterCache.clear();
    }
  }

  syncOverlayChips(): void {
    this.minimapHud.setResourcesActive(this.chipController.isLayerActive('resources'));
    this.globalOverlay.renderChips(
      this.chipController.getVisibleLayers(),
      this.chipController.getActiveSet(),
    );
  }

  updateFromView(view: GameView): void {
    this.syncRegistration();
    if (!this.ctx.flags.has('W04')) return;

    const cv = (view.sim?.view ?? this.ctx.services.getView?.() ?? view) as Partial<ClientView>;
    const tiles = (view.tiles ?? cv.tiles) as ClientTiles | undefined;
    if (cv && typeof cv.count === 'number' && cv.entities) this.lastClientView = cv as ClientView;

    const planetId =
      cv.planet?.id ?? view.planet?.id ?? this.ctx.services.session?.planetId?.() ?? 'default';
    const radius = cv.planet?.radius ?? view.planet?.radius;
    const viewerColony = this.ctx.services.colonyId ?? 0;
    const w11Enabled = this.ctx.flags.has('W11');
    const atlasBlob = extractViewAtlasBlob(cv, view);
    const manifest = this.sectorSelection.atlasManifest ?? atlasBlob?.manifest ?? null;
    const atlasHash =
      manifest?.atlasHash ?? atlasBlob?.atlasHash ?? this.sectorSelection.planetSummary?.atlasHash ?? null;
    const atlasVersion =
      manifest?.atlasVersion ?? atlasBlob?.atlasVersion ?? this.sectorSelection.planetSummary?.atlasVersion ?? null;
    const worldContextKey = `${planetId}|${atlasHash ?? ''}|${atlasVersion ?? ''}|${viewerColony}|${w11Enabled ? 1 : 0}`;
    if (worldContextKey !== this.lastWorldContextKey) {
      if (
        (this.lastPlanetId !== null && this.lastPlanetId !== planetId) ||
        (this.lastAtlasHash !== null && this.lastAtlasHash !== atlasHash) ||
        !w11Enabled
      ) {
        this.sectorSelection.reset();
      }
      this.lastWorldContextKey = worldContextKey;
      this.lastPlanetId = planetId;
      this.lastAtlasHash = atlasHash;
      this.currentAdapter = null;
      this.lastTiles = null;
    }

    if (tiles && tiles !== this.lastTiles && tiles.terrain && tiles.prep && tiles.owner) {
      this.lastTiles = tiles;
      this.currentAdapter = createAtlasMapAdapter({
        w11Enabled,
        radius,
        tileCount: tiles.count,
        manifest,
        atlasBlob,
        planetSummary: this.sectorSelection.planetSummary,
      });
      const useMetaKeys = Boolean(this.currentAdapter.isAtlas || atlasHash || viewerColony !== 0);
      const { entry } = this.rasterCache.update(tiles, {
        planetId,
        radius,
        ...(useMetaKeys
          ? { atlasHash, atlasVersion, viewerColony, flagKey: w11Enabled ? 'W11' : 'W04' }
          : {}),
        adapter: this.currentAdapter.isAtlas ? this.currentAdapter : null,
      });
      this.lastEntry = entry;
    }

    this.minimapHud.selectedEntityId = this.ctx.services.landfall?.getSelectedEntityId() ?? null;
    this.minimapHud.updateData({
      entry: this.lastEntry,
      tiles: this.lastTiles,
      clientView: this.lastClientView,
      simData: this.ctx.services.store?.simData?.() ?? undefined,
      ownColonySlot: viewerColony,
      atlasAdapter: this.currentAdapter?.isAtlas ? this.currentAdapter : null,
    });

    if (!this.initialPainted && this.lastEntry) {
      this.initialPainted = true;
      this.scheduler.forceRedrawMinimap();
      if (this.openClose.isOpen) this.scheduler.forceRedrawGlobalMap();
    } else {
      this.scheduler.markDirty({ minimap: true, globalMap: true });
    }
  }

  syncCameraFrame(): void {
    if (!this.ctx.flags.has('W04')) return;
    const rts = this.ctx.services.rtsCamera;
    const cam = this.ctx.services.camera;
    if (!rts) return;
    const cx = cam?.position.x ?? 0;
    const cy = cam?.position.y ?? 0;
    const cz = cam?.position.z ?? 0;
    const key = `${rts.target.x.toFixed(2)},${rts.target.z.toFixed(2)},${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}`;
    if (key !== this.prevCamKey) {
      this.prevCamKey = key;
      this.scheduler.markDirty({ minimap: true, globalMap: true });
    }
  }

  dispose(): void {
    this.unbindOverlayPointer();
    this.scheduler.dispose();
    this.inputHandle.dispose();
    this.globalViewport.dispose();
    this.openClose.dispose();
    this.globalOverlay.dispose();
    this.minimapHud.dispose();
    this.unregisterLayers?.();
    this.unregisterLayers = null;
    this.rasterCache.clear();
  }
}
