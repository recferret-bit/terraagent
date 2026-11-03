import type { MapViewportTransform } from './types';

export const GLOBAL_MAP_MIN_ZOOM = 1;
export const GLOBAL_MAP_MAX_ZOOM = 4;
export const GLOBAL_MAP_DEFAULT_BASE_SIZE = 640;

export interface GlobalMapViewportOptions {
  readonly canvas?: HTMLCanvasElement | null;
  readonly baseSize?: number;
  readonly onChange?: (transform: MapViewportTransform) => void;
}

interface PointerCoord {
  x: number;
  y: number;
}

export function calculateWheelFactor(deltaY: number): number {
  if (deltaY === 0 || !Number.isFinite(deltaY)) return 1;
  if (Math.abs(deltaY) <= 4) {
    return deltaY < 0 ? 1.25 : 0.8;
  }
  const exponent = Math.max(-0.6, Math.min(0.6, -deltaY * 0.002));
  return Math.exp(exponent);
}

export class GlobalMapViewport {
  private zoom = GLOBAL_MAP_MIN_ZOOM;
  private panX = 0;
  private panY = 0;

  private readonly canvas: HTMLCanvasElement | null;
  private readonly options: GlobalMapViewportOptions;

  private readonly activePointers = new Map<number, PointerCoord>();
  private lastDragX = 0;
  private lastDragY = 0;
  private lastPinchDist = 0;

  constructor(options: GlobalMapViewportOptions = {}) {
    this.options = options;
    this.canvas = options.canvas ?? null;
    this.bindEvents();
  }

  get transform(): MapViewportTransform {
    return {
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  reset(): void {
    this.zoom = GLOBAL_MAP_MIN_ZOOM;
    this.panX = 0;
    this.panY = 0;
    this.notifyChange();
  }

  setZoom(nextZoom: number, anchorX?: number, anchorY?: number): MapViewportTransform {
    const rawTarget = Number.isFinite(nextZoom) ? nextZoom : GLOBAL_MAP_MIN_ZOOM;
    const clampedTarget = Math.max(GLOBAL_MAP_MIN_ZOOM, Math.min(GLOBAL_MAP_MAX_ZOOM, rawTarget));

    if (clampedTarget <= GLOBAL_MAP_MIN_ZOOM) {
      this.zoom = GLOBAL_MAP_MIN_ZOOM;
      this.panX = 0;
      this.panY = 0;
      this.notifyChange();
      return this.transform;
    }

    const baseSize = this.getBaseSize();
    const cx = (this.canvas?.width || baseSize) / 2;
    const cy = (this.canvas?.height || baseSize) / 2;
    const ax = anchorX ?? cx;
    const ay = anchorY ?? cy;

    const prevZoom = this.zoom > 0 ? this.zoom : GLOBAL_MAP_MIN_ZOOM;
    const ratio = clampedTarget / prevZoom;

    const rawPanX = (ax - cx) * (1 - ratio) + ratio * this.panX;
    const rawPanY = (ay - cy) * (1 - ratio) + ratio * this.panY;

    this.zoom = clampedTarget;
    const maxPan = (baseSize * (this.zoom - 1)) / 2;
    this.panX = Math.max(-maxPan, Math.min(maxPan, rawPanX));
    this.panY = Math.max(-maxPan, Math.min(maxPan, rawPanY));
    this.notifyChange();
    return this.transform;
  }

  wheelZoom(deltaY: number, anchorX?: number, anchorY?: number): MapViewportTransform {
    if (deltaY === 0 || !Number.isFinite(deltaY)) return this.transform;
    const factor = calculateWheelFactor(deltaY);
    return this.setZoom(this.zoom * factor, anchorX, anchorY);
  }

  pinchZoom(scaleFactor: number, anchorX?: number, anchorY?: number): MapViewportTransform {
    if (scaleFactor <= 0 || !Number.isFinite(scaleFactor)) return this.transform;
    return this.setZoom(this.zoom * scaleFactor, anchorX, anchorY);
  }

  panBy(dx: number, dy: number): MapViewportTransform {
    if (this.zoom <= GLOBAL_MAP_MIN_ZOOM) {
      this.panX = 0;
      this.panY = 0;
      this.notifyChange();
      return this.transform;
    }

    const baseSize = this.getBaseSize();
    const maxPan = (baseSize * (this.zoom - 1)) / 2;
    const targetX = this.panX + (Number.isFinite(dx) ? dx : 0);
    const targetY = this.panY + (Number.isFinite(dy) ? dy : 0);

    this.panX = Math.max(-maxPan, Math.min(maxPan, targetX));
    this.panY = Math.max(-maxPan, Math.min(maxPan, targetY));
    this.notifyChange();
    return this.transform;
  }

  applyToContext(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const cx = width / 2;
    const cy = height / 2;
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-cx, -cy);
  }

  dispose(): void {
    if (this.canvas && typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    }
    this.activePointers.clear();
    this.lastPinchDist = 0;
  }

  private getBaseSize(): number {
    return this.canvas?.width || this.options.baseSize || GLOBAL_MAP_DEFAULT_BASE_SIZE;
  }

  private notifyChange(): void {
    this.options.onChange?.(this.transform);
  }

  private bindEvents(): void {
    if (!this.canvas || typeof this.canvas.addEventListener !== 'function') return;
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheelZoom(e.deltaY);
  };

  private readonly onPointerDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    const pointerId = typeof e.pointerId === 'number' ? e.pointerId : 1;
    try {
      (this.canvas as Partial<Element>)?.setPointerCapture?.(pointerId);
    } catch {
      // Safe fallback in test environments
    }
    this.activePointers.set(pointerId, { x: e.clientX, y: e.clientY });
    if (this.activePointers.size === 1) {
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
    } else if (this.activePointers.size === 2) {
      const [p1, p2] = Array.from(this.activePointers.values());
      this.lastPinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
  };

  private readonly onPointerMove = (ev: Event): void => {
    const e = ev as PointerEvent;
    const pointerId = typeof e.pointerId === 'number' ? e.pointerId : 1;
    if (!this.activePointers.has(pointerId)) return;
    this.activePointers.set(pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size === 1) {
      const dx = e.clientX - this.lastDragX;
      const dy = e.clientY - this.lastDragY;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
      if (dx !== 0 || dy !== 0) {
        this.panBy(dx, dy);
      }
    } else if (this.activePointers.size === 2) {
      const [p1, p2] = Array.from(this.activePointers.values());
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (this.lastPinchDist > 0 && dist > 0) {
        const scaleFactor = dist / this.lastPinchDist;
        this.pinchZoom(scaleFactor);
      }
      this.lastPinchDist = dist;
    }
  };

  private readonly onPointerUp = (ev: Event): void => {
    const e = ev as PointerEvent;
    const pointerId = typeof e.pointerId === 'number' ? e.pointerId : 1;
    try {
      (this.canvas as Partial<Element>)?.releasePointerCapture?.(pointerId);
    } catch {
      // Safe fallback in test environments
    }
    this.activePointers.delete(pointerId);
    if (this.activePointers.size === 1) {
      const remaining = this.activePointers.values().next().value;
      if (remaining) {
        this.lastDragX = remaining.x;
        this.lastDragY = remaining.y;
      }
      this.lastPinchDist = 0;
    } else if (this.activePointers.size === 0) {
      this.lastPinchDist = 0;
    }
  };
}

export function createGlobalMapViewport(options?: GlobalMapViewportOptions): GlobalMapViewport {
  return new GlobalMapViewport(options);
}
