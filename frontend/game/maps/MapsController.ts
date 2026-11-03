import type { MapLayerId } from '@terra/contracts';
import type { FeatureContext, GameView } from '../core/registry/types';
import type { ClientTiles, ClientView } from '../store/replica/viewCodec';
import {
  createBuiltinW04Layers,
  renderCompositeMapLayers,
  type CompositeMapRenderResult,
} from './builtinLayers';
import { drawCameraTrapezoid, type TrapezoidCorner } from './cameraTrapezoid';
import { drawEntityDots } from './entityDots';
import { GLOBAL_MAP_CANVAS_SIZE, GlobalMapOverlay } from './GlobalMapOverlay';
import { GlobalMapViewport } from './globalMapViewport';
import { MapLayerChipController } from './layerChipsState';
import { mapLayerRegistry, type MapLayerRegistry } from './layerRegistry';
import { MinimapHud } from './MinimapHud';
import { bindMinimapInput } from './minimapInput';
import { GlobalMapOpenCloseController, type MapNavAction } from './openCloseController';
import { drawResourcesLayer } from './resourceLayer';
import { inHex } from '@terra/sim/grid/hex';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  mapScaleForRadius,
  PlanetRasterCache,
  type PlanetRasterEntry,
} from './rasterCache';
import { MapRedrawScheduler } from './redrawScheduler';
import { resolveTileColorFromTokens } from './tileColors';
import type { MapLayer, MapLayerDrawView, MinimapStats } from './types';

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
  readonly stats: MinimapStats;

  private readonly ctx: FeatureContext;
  private readonly inputHandle: { dispose(): void; isDragging(): boolean };
  private unregisterLayers: (() => void) | null = null;
  private lastEntry: PlanetRasterEntry | null = null;
  private lastTiles: ClientTiles | null = null;
  private lastClientView: ClientView | null = null;
  private lastDotCount = 0;
  private lastTrapezoid: TrapezoidCorner[] = [];
  private lastComposite: CompositeMapRenderResult | null = null;
  private initialPainted = false;
  private prevCamKey = '';

  constructor(opts: MapsControllerOptions) {
    this.ctx = opts.ctx;
    this.registry = opts.registry ?? mapLayerRegistry;
    this.rasterCache = opts.rasterCache ?? new PlanetRasterCache(resolveTileColorFromTokens);
    this.rasterCache.setColorResolver(resolveTileColorFromTokens);

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
      getRadius: () => this.lastEntry?.radius ?? this.rasterCache.lastRadius ?? 12,
      onPanToTile: (q, r) => this.panToTile(q, r),
    });

    const overlayParent = opts.el.ownerDocument?.body ?? opts.el;
    this.globalOverlay = new GlobalMapOverlay({
      parent: overlayParent,
      onCloseClick: () => this.openClose.close(),
      onChipToggle: (id, active) => {
        this.chipController.setLayerActive(id, active);
      },
      onRender: (ctx2d, canvas) => this.drawGlobalMap(ctx2d, canvas),
      onRecenterClick: () => this.globalViewport.reset(),
    });

    this.globalViewport = new GlobalMapViewport({
      canvas: this.globalOverlay.canvas,
      baseSize: GLOBAL_MAP_CANVAS_SIZE,
      onChange: () => {
        if (this.openClose.isOpen) {
          this.globalOverlay.render();
        }
      },
    });

    this.scheduler = new MapRedrawScheduler({
      isGlobalMapOpen: () => this.openClose.isOpen,
      onRedrawMinimap: () => this.minimapHud.render(),
      onRedrawGlobalMap: () => this.globalOverlay.render(),
    });

    this.globalOverlay.watchResize(() => this.globalOverlay.render());
    this.globalOverlay.canvas.addEventListener('pointermove', this.onGlobalPointerMove);
    this.globalOverlay.canvas.addEventListener('pointerleave', this.onGlobalPointerLeave);

    this.stats = this.createStatsProxy();
    this.syncRegistration();
    this.syncOverlayChips();
  }

  private cursorPx: { x: number; y: number } | null = null;

  private readonly onGlobalPointerMove = (e: PointerEvent): void => {
    const canvas = this.globalOverlay.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.cursorPx = {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
    this.updateReadout();
  };

  private readonly onGlobalPointerLeave = (): void => {
    this.cursorPx = null;
    this.updateReadout();
  };

  private navigateGlobalMap(action: MapNavAction): void {
    const vp = this.globalViewport;
    if (action.kind === 'reset') vp.reset();
    else if (action.kind === 'zoom') vp.setZoom(vp.transform.zoom * action.factor);
    else {
      const step = action.fast ? 160 : 56;
      vp.panBy(action.dx * step, action.dy * step);
    }
  }

  /** Planet-square side used by the global map (shorter canvas edge). */
  private globalSquare(): number {
    const c = this.globalOverlay.canvas;
    return Math.max(1, Math.min(c.width, c.height));
  }

  /** Canvas pixel → axial tile on the planet (unclamped; `inside` tells whether it is a real tile). */
  private canvasPxToTile(px: number, py: number): { q: number; r: number; inside: boolean } {
    const c = this.globalOverlay.canvas;
    const { zoom, panX, panY } = this.globalViewport.transform;
    const S = this.globalSquare();
    const sx = (px - c.width / 2 - panX) / zoom + c.width / 2 - (c.width - S) / 2;
    const sy = (py - c.height / 2 - panY) / zoom + c.height / 2 - (c.height - S) / 2;
    const radius = this.lastEntry?.radius ?? this.rasterCache.lastRadius ?? 12;
    const { q, r } = canvasPixelToAxial(sx, sy, S, radius);
    return { q, r, inside: inHex(q, r, radius) };
  }

  private updateReadout(): void {
    if (!this.openClose.isOpen) return;
    const c = this.globalOverlay.canvas;
    const { zoom } = this.globalViewport.transform;
    const centre = this.canvasPxToTile(c.width / 2, c.height / 2);
    const fmt = (t: { q: number; r: number; inside: boolean }) =>
      `${t.q},${t.r}${t.inside ? '' : ' (out)'}`;
    let text = `ZOOM ${zoom.toFixed(2)}×   CENTER ${fmt(centre)}`;
    if (this.cursorPx) text += `   CURSOR ${fmt(this.canvasPxToTile(this.cursorPx.x, this.cursorPx.y))}`;
    this.globalOverlay.setReadout(text);
  }

  private drawMinimapOverlays(
    ctx2d: CanvasRenderingContext2D,
    drawView: MapLayerDrawView,
  ): void {
    if (this.chipController.isLayerActive('resources')) drawResourcesLayer(ctx2d, drawView);
    const dots = drawEntityDots(ctx2d, drawView);
    this.lastDotCount = dots.length;
    this.lastTrapezoid = drawCameraTrapezoid(ctx2d, drawView, {
      camera: this.ctx.services.camera ?? null,
      rtsCamera: this.ctx.services.rtsCamera ?? null,
    });
  }

  private drawGlobalMap(
    ctx2d: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const w = canvas.width || GLOBAL_MAP_CANVAS_SIZE;
    const h = canvas.height || GLOBAL_MAP_CANVAS_SIZE;
    const size = Math.max(1, Math.min(w, h));
    const radius = this.lastEntry?.radius ?? this.rasterCache.lastRadius ?? 12;
    const scale = mapScaleForRadius(size, radius);
    const drawView: MapLayerDrawView = {
      width: size,
      height: size,
      planetId: this.lastEntry?.planetKey ?? undefined,
      radius,
      tiles: this.lastTiles,
      clientView: this.lastClientView,
      ownColonySlot: this.ctx.services.colonyId ?? 0,
      axialToPixel: (q, r) => axialToCanvasPixel(q, r, size, radius),
      pixelToAxial: (x, y) => canvasPixelToAxial(x, y, size, radius),
      tilePixelRadius: Math.max(2, scale / Math.sqrt(3)),
      transform: this.globalViewport.transform,
      rasterCanvas: this.lastEntry?.canvas ?? null,
    };

    ctx2d.save();
    this.globalViewport.applyToContext(ctx2d, w, h);
    ctx2d.translate((w - size) / 2, (h - size) / 2);
    ctx2d.imageSmoothingEnabled = false;
    const active = this.chipController.getActiveSet();
    const visible = this.chipController.getVisibleLayers();
    this.lastComposite = renderCompositeMapLayers(ctx2d, drawView, active, visible);
    if (this.lastComposite.unitDots > 0) {
      this.lastDotCount = this.lastComposite.unitDots;
    }
    drawCameraTrapezoid(ctx2d, drawView, {
      camera: this.ctx.services.camera ?? null,
      rtsCamera: this.ctx.services.rtsCamera ?? null,
    });
    ctx2d.restore();
    this.updateReadout();
  }

  panToTile(q: number, r: number): void {
    this.ctx.services.focusTile?.(q, r, true);
    this.minimapHud.render();
    if (this.openClose.isOpen) {
      this.globalOverlay.render();
    }
  }

  private registeredFlagKey = '';

  syncRegistration(): void {
    const enabled = this.ctx.flags.has('W04');
    this.minimapHud.setVisible(enabled);
    const flagKey = enabled ? [...this.ctx.flags].sort().join(',') : '';
    if (enabled && flagKey !== this.registeredFlagKey) {
      if (this.unregisterLayers) {
        this.unregisterLayers();
        this.unregisterLayers = null;
      }
      const builtins = createBuiltinW04Layers();
      const cleanups: Array<() => void> = [];
      for (const layer of Object.values(builtins)) {
        if (this.ctx.flags.has(layer.wave)) {
          cleanups.push(this.registry.register(layer));
        }
      }
      this.unregisterLayers = () => {
        for (const fn of cleanups) fn();
      };
      this.registeredFlagKey = flagKey;
      this.syncOverlayChips();
    } else if (!enabled && this.unregisterLayers) {
      this.unregisterLayers();
      this.unregisterLayers = null;
      this.registeredFlagKey = '';
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
    if (cv && typeof cv.count === 'number' && cv.entities) {
      this.lastClientView = cv as ClientView;
    }
    if (tiles && tiles.terrain && tiles.prep && tiles.owner) {
      this.lastTiles = tiles;
      const planetId =
        cv.planet?.id ??
        view.planet?.id ??
        this.ctx.services.session?.planetId?.() ??
        'default';
      const radius = cv.planet?.radius ?? view.planet?.radius;
      const { entry } = this.rasterCache.update(tiles, { planetId, radius });
      this.lastEntry = entry;
    }

    this.minimapHud.updateData({
      entry: this.lastEntry,
      tiles: this.lastTiles,
      clientView: this.lastClientView,
      ownColonySlot: this.ctx.services.colonyId ?? 0,
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
      this.minimapHud.render();
      if (this.openClose.isOpen) {
        this.globalOverlay.render();
      }
    }
  }

  private createStatsProxy(): MinimapStats {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get dirtyTiles() { return self.rasterCache.dirtyTiles; },
      set dirtyTiles(v: number) { self.rasterCache.dirtyTiles = v; },
      get totalRepaints() { return self.rasterCache.totalRepaints; },
      set totalRepaints(v: number) { self.rasterCache.totalRepaints = v; },
      get lastRadius() { return self.rasterCache.lastRadius; },
      set lastRadius(v: number) { self.rasterCache.lastRadius = v; },
      get lastPlanetId() { return self.rasterCache.lastPlanetKey; },
      set lastPlanetId(v: string | null) { self.rasterCache.lastPlanetKey = v; },
      get minimapRedraws() { return self.scheduler.minimapRedraws; },
      set minimapRedraws(_v: number) {},
      get globalMapRedraws() { return self.scheduler.globalMapRedraws; },
      set globalMapRedraws(_v: number) {},
      get minimapHz() { return self.scheduler.minimapHz(); },
      set minimapHz(_v: number) {},
      get globalMapHz() { return self.scheduler.globalMapHz(); },
      set globalMapHz(_v: number) {},
      get entityDotCount() { return self.lastDotCount; },
      set entityDotCount(v: number) { self.lastDotCount = v; },
      get globalMapOpen() { return self.openClose.isOpen; },
      set globalMapOpen(v: boolean) { if (v) self.openClose.open(); else self.openClose.close(); },
      get activeLayers() { return self.chipController.getActiveLayerIds(); },
      set activeLayers(_v: MapLayerId[]) {},
      get registeredLayers() { return self.registry.all().map((l: MapLayer) => l.id); },
      set registeredLayers(_v: MapLayerId[]) {},
      get visibleLayers() { return self.chipController.getVisibleLayers().map((l: MapLayer) => l.id); },
      get trapezoid() { return self.lastTrapezoid; },
      get zoom() { return self.globalViewport.transform.zoom; },
      get panX() { return self.globalViewport.transform.panX; },
      get panY() { return self.globalViewport.transform.panY; },
      get lastComposite() { return self.lastComposite; },
    };
  }

  dispose(): void {
    this.globalOverlay.canvas.removeEventListener('pointermove', this.onGlobalPointerMove);
    this.globalOverlay.canvas.removeEventListener('pointerleave', this.onGlobalPointerLeave);
    this.scheduler.dispose();
    this.inputHandle.dispose();
    this.globalViewport.dispose();
    this.openClose.dispose();
    this.globalOverlay.dispose();
    this.minimapHud.dispose();
    if (this.unregisterLayers) {
      this.unregisterLayers();
      this.unregisterLayers = null;
    }
    this.rasterCache.clear();
  }
}
