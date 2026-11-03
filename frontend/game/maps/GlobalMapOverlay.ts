import type { MapLayerId } from '@terra/contracts';
import { getSafe2dContext } from './rasterCache';
import { getTileLegendEntries, RESOURCE_LEGEND, type TileLegendEntry } from './tileColors';
import type { MapLayer } from './types';
import './global-map.css';

export const GLOBAL_MAP_CANVAS_SIZE = 640;

export interface GlobalMapOverlayOptions {
  readonly parent: HTMLElement;
  readonly onCloseClick?: () => void;
  readonly onChipToggle?: (layerId: MapLayerId, active: boolean) => void;
  readonly onRender?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void;
  readonly onRecenterClick?: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function buildHeaderDom(onClose?: () => void): {
  header: HTMLElement;
  chipBar: HTMLElement;
  closeBtn: HTMLButtonElement;
} {
  const header = document.createElement('header');
  header.className = 'ta-global-map__header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'ta-global-map__title-group';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'ta-global-map__eyebrow';
  eyebrow.textContent = 'ORBITAL SURVEY';

  const title = document.createElement('h2');
  title.className = 'ta-global-map__title';
  title.textContent = 'GLOBAL SECTOR MAP';
  titleGroup.append(eyebrow, title);

  const chipBar = document.createElement('div');
  chipBar.className = 'ta-global-map__chips';
  chipBar.dataset.testid = 'global-map-chips';
  chipBar.setAttribute('role', 'toolbar');
  chipBar.setAttribute('aria-label', 'Map layers');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm plate-sm ta-global-map__close';
  closeBtn.dataset.testid = 'global-map-close';
  closeBtn.setAttribute('aria-label', 'Close global map (Esc)');
  closeBtn.textContent = 'CLOSE [ESC]';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose?.();
  });

  header.append(titleGroup, chipBar, closeBtn);
  return { header, chipBar, closeBtn };
}

export class GlobalMapOverlay {
  readonly el: HTMLElement;
  readonly headerEl: HTMLElement;
  readonly chipBarEl: HTMLElement;
  readonly closeBtn: HTMLButtonElement;
  readonly stageEl: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly legendEl: HTMLElement;
  readonly readoutEl: HTMLElement;
  readonly recenterBtn: HTMLButtonElement;
  readonly ctx: CanvasRenderingContext2D;

  private readonly onCloseClick?: () => void;
  private readonly onChipToggle?: (layerId: MapLayerId, active: boolean) => void;
  private readonly onRender?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void;
  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private previouslyFocused: HTMLElement | null = null;
  private openState = false;
  private resizeObserver: ResizeObserver | null = null;
  private readonly readoutText: HTMLElement;

  constructor(opts: GlobalMapOverlayOptions) {
    this.onCloseClick = opts.onCloseClick;
    this.onChipToggle = opts.onChipToggle;
    this.onRender = opts.onRender;

    this.el = document.createElement('div');
    this.el.className = 'ta-global-map plate';
    this.el.dataset.testid = 'global-map-overlay';
    this.el.dataset.open = 'false';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Global Planet Map');
    this.el.hidden = true;

    const { header, chipBar, closeBtn } = buildHeaderDom(() => this.onCloseClick?.());
    this.headerEl = header;
    this.chipBarEl = chipBar;
    this.closeBtn = closeBtn;

    const body = document.createElement('div');
    body.className = 'ta-global-map__body';

    this.stageEl = document.createElement('div');
    this.stageEl.className = 'ta-global-map__stage';
    this.stageEl.dataset.testid = 'global-map-stage';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ta-global-map__canvas';
    this.canvas.dataset.testid = 'global-map-canvas';
    this.canvas.width = GLOBAL_MAP_CANVAS_SIZE;
    this.canvas.height = GLOBAL_MAP_CANVAS_SIZE;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Global map canvas');
    this.stageEl.appendChild(this.canvas);

    this.readoutEl = document.createElement('div');
    this.readoutEl.className = 'ta-global-map__readout plate-sm';
    this.readoutEl.dataset.testid = 'global-map-readout';
    this.readoutText = document.createElement('span');
    this.readoutText.className = 'ta-global-map__readout-text';
    this.recenterBtn = document.createElement('button');
    this.recenterBtn.type = 'button';
    this.recenterBtn.className = 'ta-global-map__recenter';
    this.recenterBtn.dataset.testid = 'global-map-recenter';
    this.recenterBtn.textContent = 'RESET [0]';
    this.recenterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRecenterClick?.();
    });
    const hint = document.createElement('span');
    hint.className = 'ta-global-map__hint';
    hint.textContent = 'DRAG / WASD PAN · WHEEL / Q E ZOOM';
    this.readoutEl.append(this.readoutText, this.recenterBtn, hint);
    this.stageEl.appendChild(this.readoutEl);

    this.legendEl = document.createElement('aside');
    this.legendEl.className = 'ta-global-map__legend plate-sm';
    this.legendEl.dataset.testid = 'global-map-legend';
    this.legendEl.setAttribute('aria-label', 'Map legend');

    body.append(this.stageEl, this.legendEl);
    this.el.append(this.headerEl, body);
    opts.parent.appendChild(this.el);

    this.ctx = getSafe2dContext(this.canvas);
    this.renderLegend();

    this.onKeyDownBound = (e: KeyboardEvent) => this.handleFocusTrap(e);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDownBound, true);
    }
  }

  get isOpen(): boolean {
    return this.openState;
  }

  setOpen(open: boolean): void {
    if (this.openState === open) return;
    this.openState = open;
    this.el.hidden = !open;
    this.el.dataset.open = open ? 'true' : 'false';
    if (open) {
      this.previouslyFocused =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.renderLegend();
      this.fitCanvasToStage();
      this.render();
      const focusables = this.getFocusableElements();
      (focusables[0] ?? this.closeBtn).focus();
    } else {
      this.previouslyFocused?.focus?.();
      this.previouslyFocused = null;
    }
  }

  /** Sizes the canvas backing store (1 px = 1 CSS px) to the stage so the map fills the whole screen. */
  fitCanvasToStage(): boolean {
    const w = Math.round(this.stageEl.clientWidth);
    const h = Math.round(this.stageEl.clientHeight);
    if (w < 16 || h < 16) return false;
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  watchResize(onResize: () => void): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.openState && this.fitCanvasToStage()) onResize();
    });
    this.resizeObserver.observe(this.stageEl);
  }

  setReadout(text: string): void {
    this.readoutText.textContent = text;
  }

  renderLegend(entries: readonly TileLegendEntry[] = getTileLegendEntries()): void {
    this.legendEl.replaceChildren();
    const title = document.createElement('div');
    title.className = 'ta-global-map__legend-title';
    title.textContent = 'TERRAIN LEGEND';
    this.legendEl.appendChild(title);

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'ta-global-map__legend-item';
      row.dataset.legendKey = entry.key;

      const swatch = document.createElement('span');
      swatch.className = 'ta-global-map__legend-swatch';
      swatch.dataset.legendSwatch = entry.key;
      swatch.style.backgroundColor = entry.color;

      const label = document.createElement('span');
      label.textContent = entry.label;

      row.append(swatch, label);
      this.legendEl.appendChild(row);
    }

    const resTitle = document.createElement('div');
    resTitle.className = 'ta-global-map__legend-title';
    resTitle.textContent = 'RESOURCE DEPOSITS';
    this.legendEl.appendChild(resTitle);
    for (const res of RESOURCE_LEGEND) {
      const row = document.createElement('div');
      row.className = 'ta-global-map__legend-item';
      row.dataset.legendKey = `res-${res.key}`;
      const swatch = document.createElement('span');
      swatch.className = 'ta-global-map__legend-swatch ta-global-map__legend-swatch--dot';
      swatch.dataset.legendSwatch = `res-${res.key}`;
      swatch.style.backgroundColor = res.color;
      const label = document.createElement('span');
      label.textContent = res.label;
      row.append(swatch, label);
      this.legendEl.appendChild(row);
    }
  }

  renderChips(
    visibleLayers: readonly MapLayer[],
    activeSet: ReadonlySet<MapLayerId>,
  ): void {
    const existing = Array.from(this.chipBarEl.querySelectorAll<HTMLButtonElement>('button[data-layer]'));
    const sameOrder =
      existing.length === visibleLayers.length &&
      existing.every((btn, idx) => btn.dataset.layer === visibleLayers[idx]?.id);

    if (sameOrder) {
      for (let i = 0; i < existing.length; i++) {
        const btn = existing[i]!;
        const layer = visibleLayers[i]!;
        const active = activeSet.has(layer.id);
        btn.dataset.active = active ? 'true' : 'false';
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.textContent = layer.label;
      }
      return;
    }

    this.chipBarEl.replaceChildren();
    for (const layer of visibleLayers) {
      const active = activeSet.has(layer.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-global-map__chip';
      btn.dataset.testid = `map-layer-chip-${layer.id}`;
      btn.dataset.layer = layer.id;
      btn.dataset.active = active ? 'true' : 'false';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.textContent = layer.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = btn.dataset.active !== 'true';
        this.onChipToggle?.(layer.id, next);
      });
      this.chipBarEl.appendChild(btn);
    }
  }

  getFocusableElements(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  private handleFocusTrap(e: KeyboardEvent): void {
    if (!this.openState || e.key !== 'Tab') return;
    const focusables = this.getFocusableElements();
    if (focusables.length === 0) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    const active =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const idx = active ? focusables.indexOf(active) : -1;
    const step = e.shiftKey ? -1 : 1;
    const nextIdx =
      idx < 0
        ? e.shiftKey
          ? focusables.length - 1
          : 0
        : (idx + step + focusables.length) % focusables.length;
    focusables[nextIdx]!.focus();
  }

  render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onRender?.(this.ctx, this.canvas);
  }

  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDownBound, true);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.el.remove();
  }
}
