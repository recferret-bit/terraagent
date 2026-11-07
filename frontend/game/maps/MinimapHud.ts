import type { CompiledDataLike } from '@terra/sim';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  getSafe2dContext,
  mapScaleForRadius,
  type PlanetRasterCache,
  type PlanetRasterEntry,
} from './rasterCache';
import type { MapLayerDrawView } from './types';
import type { ClientTiles, ClientView } from '../store/replica/viewCodec';
import './minimap.css';

export const MINIMAP_DESKTOP_PX = 180;
export const MINIMAP_COMPACT_PX = 140;

export interface MinimapHudOptions {
  readonly parent: HTMLElement;
  readonly rasterCache: PlanetRasterCache;
  readonly onExpandClick?: () => void;
  readonly onResourcesToggle?: (next: boolean) => void;
  readonly onOverlayDraw?: (ctx: CanvasRenderingContext2D, view: MapLayerDrawView) => void;
}

export function isCompactLandscapeViewport(
  width: number = typeof window !== 'undefined' ? window.innerWidth : 1280,
  height: number = typeof window !== 'undefined' ? window.innerHeight : 720,
): boolean {
  return height <= 500 || (width <= 900 && width > height);
}

export function resolveMinimapSizePx(
  width?: number,
  height?: number,
): number {
  return isCompactLandscapeViewport(width, height)
    ? MINIMAP_COMPACT_PX
    : MINIMAP_DESKTOP_PX;
}

export class MinimapHud {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly expandBtn: HTMLButtonElement;
  readonly resourcesBtn: HTMLButtonElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rasterCache: PlanetRasterCache;
  private readonly onExpandClick?: () => void;
  private readonly onOverlayDraw?: (ctx: CanvasRenderingContext2D, view: MapLayerDrawView) => void;
  private readonly onResizeBound: () => void;
  private lastEntry: PlanetRasterEntry | null = null;
  private lastTiles: ClientTiles | null = null;
  private lastClientView: ClientView | null = null;
  private ownColonySlot = 0;
  private sizePx = MINIMAP_DESKTOP_PX;

  constructor(opts: MinimapHudOptions) {
    this.rasterCache = opts.rasterCache;
    this.onExpandClick = opts.onExpandClick;
    const onResourcesToggle = opts.onResourcesToggle;
    this.onOverlayDraw = opts.onOverlayDraw;

    this.el = document.createElement('section');
    this.el.className = 'ta-minimap plate-sm';
    this.el.dataset.testid = 'minimap-hud';
    this.el.setAttribute('aria-label', 'Planet minimap');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ta-minimap__canvas';
    this.canvas.dataset.testid = 'minimap-canvas';

    const bar = document.createElement('div');
    bar.className = 'ta-minimap__bar';

    const title = document.createElement('span');
    title.className = 'ta-minimap__title';
    title.textContent = 'MAP [M]';

    this.expandBtn = document.createElement('button');
    this.expandBtn.type = 'button';
    this.expandBtn.className = 'ta-minimap__expand';
    this.expandBtn.dataset.testid = 'minimap-expand';
    this.expandBtn.setAttribute('aria-label', 'Expand global map (M)');
    this.expandBtn.title = 'Expand global map (M)';
    this.expandBtn.textContent = '⤢';
    this.expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onExpandClick?.();
    });

    this.resourcesBtn = document.createElement('button');
    this.resourcesBtn.type = 'button';
    this.resourcesBtn.className = 'ta-minimap__expand ta-minimap__toggle';
    this.resourcesBtn.dataset.testid = 'minimap-resources-toggle';
    this.resourcesBtn.dataset.active = 'false';
    this.resourcesBtn.setAttribute('aria-pressed', 'false');
    this.resourcesBtn.setAttribute('aria-label', 'Toggle resource deposits on map');
    this.resourcesBtn.title = 'Resources on/off';
    this.resourcesBtn.textContent = '◆';
    this.resourcesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onResourcesToggle?.(this.resourcesBtn.dataset.active !== 'true');
    });

    const actions = document.createElement('div');
    actions.className = 'ta-minimap__actions';
    actions.append(this.resourcesBtn, this.expandBtn);
    bar.append(title, actions);
    this.el.append(this.canvas, bar);
    opts.parent.appendChild(this.el);

    this.ctx = getSafe2dContext(this.canvas);
    this.syncSize();

    this.onResizeBound = () => {
      this.syncSize();
      this.render();
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', this.onResizeBound);
    }
  }

  get currentSizePx(): number {
    return this.sizePx;
  }

  syncSize(width?: number, height?: number): number {
    const next = resolveMinimapSizePx(width, height);
    this.sizePx = next;
    this.el.style.width = `${next}px`;
    this.el.style.height = `${next}px`;
    this.el.dataset.size = String(next);
    if (this.canvas.width !== next || this.canvas.height !== next) {
      this.canvas.width = next;
      this.canvas.height = next;
    }
    return next;
  }

  setResourcesActive(active: boolean): void {
    this.resourcesBtn.dataset.active = active ? 'true' : 'false';
    this.resourcesBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? '' : 'none';
  }

  private simData?: CompiledDataLike;

  updateData(opts: {
    simData?: CompiledDataLike;
    entry?: PlanetRasterEntry | null;
    tiles?: ClientTiles | null;
    clientView?: ClientView | null;
    ownColonySlot?: number;
  }): void {
    this.simData = opts.simData;
    if (opts.entry !== undefined) this.lastEntry = opts.entry;
    if (opts.tiles !== undefined) this.lastTiles = opts.tiles;
    if (opts.clientView !== undefined) this.lastClientView = opts.clientView;
    if (opts.ownColonySlot !== undefined) this.ownColonySlot = opts.ownColonySlot;
  }

  buildDrawView(): MapLayerDrawView {
    const radius = this.lastEntry?.radius ?? this.rasterCache.lastRadius ?? 6;
    const size = this.sizePx;
    const scale = mapScaleForRadius(size, radius);
    return {
      selectedEntityId: this.selectedEntityId,
      width: size,
      height: size,
      planetId: this.lastEntry?.planetKey ?? undefined,
      radius,
      tiles: this.lastTiles,
      clientView: this.lastClientView,
      simData: this.simData,
      ownColonySlot: this.ownColonySlot,
      axialToPixel: (q, r) => axialToCanvasPixel(q, r, size, radius),
      pixelToAxial: (x, y) => canvasPixelToAxial(x, y, size, radius),
      tilePixelRadius: Math.max(1.25, scale / Math.sqrt(3)),
      rasterCanvas: this.lastEntry?.canvas ?? null,
    };
  }

  selectedEntityId: number | null = null;

  render(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = '#0B0E13';
    this.ctx.fillRect(0, 0, w, h);

    if (this.lastEntry?.canvas) {
      this.ctx.drawImage(this.lastEntry.canvas, 0, 0, w, h);
    }

    if (this.onOverlayDraw) {
      this.onOverlayDraw(this.ctx, this.buildDrawView());
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this.onResizeBound);
    }
    this.el.remove();
  }
}
