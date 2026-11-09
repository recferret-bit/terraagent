import { inHex, planeToAxial } from '@terra/sim/grid/hex';
import type { AtlasMapAdapter } from './atlasMapAdapter';
import { canvasPixelToAxial, mapScaleForRadius } from './rasterCache';

export interface MinimapInputOptions {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly expandButton?: HTMLElement | null;
  readonly getRadius: () => number;
  readonly getAdapter?: () => AtlasMapAdapter | null;
  readonly onPanToTile: (q: number, r: number) => void;
}

export interface MinimapInputController {
  dispose(): void;
  isDragging(): boolean;
}

export function isExpandButtonTarget(
  target: EventTarget | null,
  expandButton?: HTMLElement | null,
): boolean {
  if (!target) return false;
  if (
    expandButton &&
    (target === expandButton ||
      (target instanceof Node && expandButton.contains(target)))
  ) {
    return true;
  }
  const el = target as HTMLElement | null;
  if (
    typeof el?.closest === 'function' &&
    el.closest('[data-testid="minimap-expand"], [data-testid="minimap-resources-toggle"]')
  ) {
    return true;
  }
  return false;
}

export function clampPixelToAxial(
  cx: number,
  cy: number,
  size: number,
  radius: number,
): { q: number; r: number } {
  const safeRadius = Math.max(0, radius);
  const { q, r } = canvasPixelToAxial(cx, cy, size, safeRadius);
  if (inHex(q, r, safeRadius)) {
    return { q, r };
  }
  const scale = mapScaleForRadius(size, safeRadius);
  const px = (cx - size * 0.5) / scale;
  const py = (cy - size * 0.5) / scale;
  const fr = (2 * py) / Math.sqrt(3);
  const fq = px - fr * 0.5;
  const fs = -fq - fr;
  const dist = Math.max(Math.abs(fq), Math.abs(fr), Math.abs(fs));
  if (dist <= 0) {
    return { q: 0, r: 0 };
  }
  let factor = safeRadius / dist;
  let [clampedQ, clampedR] = planeToAxial(px * factor, py * factor);
  let attempts = 0;
  while (!inHex(clampedQ, clampedR, safeRadius) && attempts < 10) {
    factor *= 0.95;
    [clampedQ, clampedR] = planeToAxial(px * factor, py * factor);
    attempts++;
  }
  return { q: clampedQ, r: clampedR };
}

export function clientToClampedAxial(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  radius: number,
  adapter?: AtlasMapAdapter | null,
): { q: number; r: number } {
  const rect = canvas.getBoundingClientRect();
  const canvasWidth = canvas.width || 180;
  const canvasHeight = canvas.height || 180;
  const w = rect.width > 0 ? rect.width : canvasWidth;
  const h = rect.height > 0 ? rect.height : canvasHeight;
  const cx = ((clientX - rect.left) / w) * canvasWidth;
  const cy = ((clientY - rect.top) / h) * canvasHeight;
  if (adapter && adapter.isAtlas) {
    return adapter.clampPixelToAxial(cx, cy, canvasWidth);
  }
  return clampPixelToAxial(cx, cy, canvasWidth, radius);
}

export function bindMinimapInput(
  opts: MinimapInputOptions,
): MinimapInputController {
  let activePointerId: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    if (isExpandButtonTarget(e.target, opts.expandButton)) {
      return;
    }
    e.preventDefault?.();
    e.stopPropagation?.();

    try {
      opts.container.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore unsupported or disconnected pointer capture
    }
    activePointerId = e.pointerId;

    const { q, r } = clientToClampedAxial(
      e.clientX,
      e.clientY,
      opts.canvas,
      opts.getRadius(),
      opts.getAdapter?.(),
    );
    opts.onPanToTile(q, r);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) {
      return;
    }
    e.preventDefault?.();
    const { q, r } = clientToClampedAxial(
      e.clientX,
      e.clientY,
      opts.canvas,
      opts.getRadius(),
      opts.getAdapter?.(),
    );
    opts.onPanToTile(q, r);
  };

  const endDrag = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) {
      return;
    }
    try {
      opts.container.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore unsupported or disconnected pointer capture
    }
    activePointerId = null;
  };

  const onLostCapture = () => {
    activePointerId = null;
  };

  opts.container.addEventListener('pointerdown', onPointerDown);
  opts.container.addEventListener('pointermove', onPointerMove);
  opts.container.addEventListener('pointerup', endDrag);
  opts.container.addEventListener('pointercancel', endDrag);
  opts.container.addEventListener('lostpointercapture', onLostCapture);

  return {
    dispose(): void {
      if (activePointerId !== null) {
        try {
          opts.container.releasePointerCapture?.(activePointerId);
        } catch {
          // Ignore
        }
        activePointerId = null;
      }
      opts.container.removeEventListener('pointerdown', onPointerDown);
      opts.container.removeEventListener('pointermove', onPointerMove);
      opts.container.removeEventListener('pointerup', endDrag);
      opts.container.removeEventListener('pointercancel', endDrag);
      opts.container.removeEventListener('lostpointercapture', onLostCapture);
    },
    isDragging(): boolean {
      return activePointerId !== null;
    },
  };
}
