// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_MAP_MAX_ZOOM,
  GLOBAL_MAP_MIN_ZOOM,
  GlobalMapViewport,
  calculateWheelFactor,
  createGlobalMapViewport,
} from './globalMapViewport';

class MockPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
  }
}

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  (window as unknown as { PointerEvent: unknown }).PointerEvent = MockPointerEvent;
}

describe('GlobalMapViewport wheel and zoom clamping', () => {
  it('starts at 1x fit-to-screen and clamps manual zoom to [min, max]', () => {
    const vp = new GlobalMapViewport({ baseSize: 640 });
    expect(vp.transform).toEqual({ zoom: 1, panX: 0, panY: 0 });

    vp.setZoom(2.5);
    expect(vp.transform.zoom).toBe(2.5);

    vp.setZoom(10);
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MAX_ZOOM);

    vp.setZoom(0.05);
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MIN_ZOOM);
  });

  it('wheel-zooming in and out clamps between 1x and 4x and notifies listener', () => {
    const onChange = vi.fn();
    const vp = createGlobalMapViewport({ baseSize: 640, onChange });

    // Wheel zoom in (deltaY < 0)
    vp.wheelZoom(-100);
    expect(vp.transform.zoom).toBeGreaterThan(1);
    expect(onChange).toHaveBeenCalled();

    for (let i = 0; i < 40; i++) {
      vp.wheelZoom(-100);
    }
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MAX_ZOOM);

    for (let i = 0; i < 80; i++) {
      vp.wheelZoom(100);
    }
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MIN_ZOOM);
  });

  it('DOM wheel event on canvas prevents default and updates zoom', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const vp = new GlobalMapViewport({ canvas });

    const wheelEv = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    canvas.dispatchEvent(wheelEv);
    expect(wheelEv.defaultPrevented).toBe(true);
    expect(vp.transform.zoom).toBeGreaterThan(1);

    vp.dispose();
  });

  it('calculates expected wheel factor for small and standard deltas', () => {
    expect(calculateWheelFactor(0)).toBe(1);
    expect(calculateWheelFactor(-1)).toBe(1.25);
    expect(calculateWheelFactor(1)).toBe(0.8);
    expect(calculateWheelFactor(-100)).toBeGreaterThan(1.2);
    expect(calculateWheelFactor(100)).toBeLessThan(0.85);
  });
});

describe('GlobalMapViewport pinch zoom gestures', () => {
  it('pinchZoom multiplies zoom and clamps between 1x and 4x', () => {
    const vp = new GlobalMapViewport({ baseSize: 640 });
    vp.pinchZoom(2);
    expect(vp.transform.zoom).toBe(2);

    vp.pinchZoom(10);
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MAX_ZOOM);

    vp.pinchZoom(0.01);
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MIN_ZOOM);
  });

  it('two-pointer gestures on canvas pinch zoom within the zoom range', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const vp = new GlobalMapViewport({ canvas });

    // Pointer 1 down at (100, 100), Pointer 2 down at (200, 100) -> initial dist = 100
    canvas.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 }));

    // Pointer 2 moves to (300, 100) -> dist = 200 (scale factor 2x)
    canvas.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 2, clientX: 300, clientY: 100 }));
    expect(vp.transform.zoom).toBe(2);

    // Pointer 2 moves to (1600, 100) -> dist = 1500 (clamps at the max zoom)
    canvas.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 2, clientX: 1600, clientY: 100 }));
    expect(vp.transform.zoom).toBe(GLOBAL_MAP_MAX_ZOOM);

    // Pointer 2 moves closer to pointer 1 -> shrinks zoom
    canvas.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 2, clientX: 150, clientY: 100 }));
    expect(vp.transform.zoom).toBeLessThan(GLOBAL_MAP_MAX_ZOOM);

    canvas.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 2 }));
    canvas.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 1 }));
    vp.dispose();
  });
});

describe('GlobalMapViewport drag pan and planet bounds clamping', () => {
  it('pans freely at zoom 1 (the map is endless, not clamped to the planet)', () => {
    const vp = new GlobalMapViewport({ baseSize: 640 });
    expect(vp.transform.zoom).toBe(1);

    vp.panBy(50, 100);
    expect(vp.transform.panX).toBe(50);
    expect(vp.transform.panY).toBe(100);
  });

  it('at zoom > 1 drag pans (panX, panY) and clamps to [-maxPan, +maxPan]', () => {
    const vp = new GlobalMapViewport({ baseSize: 640 });
    // At zoom 2, maxPan = 640 * 2 / 2 + 640 / 4 = 800 (planet can leave the view, never entirely)
    vp.setZoom(2);
    expect(vp.transform.panX).toBe(0);
    expect(vp.transform.panY).toBe(0);

    vp.panBy(100, -50);
    expect(vp.transform.panX).toBe(100);
    expect(vp.transform.panY).toBe(-50);

    // Exceed bounds positive
    vp.panBy(2000, 2000);
    expect(vp.transform.panX).toBe(800);
    expect(vp.transform.panY).toBe(800);

    // Exceed bounds negative
    vp.panBy(-2000, -2000);
    expect(vp.transform.panX).toBe(-800);
    expect(vp.transform.panY).toBe(-800);
  });

  it('single-pointer dragging on canvas pans', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const vp = new GlobalMapViewport({ canvas });

    // Drag pans at zoom 1 too
    canvas.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 150 }));
    canvas.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 1 }));
    expect(vp.transform.panX).toBe(50);
    expect(vp.transform.panY).toBe(50);

    vp.reset();
    vp.setZoom(2);
    canvas.dispatchEvent(new MockPointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 200 }));
    canvas.dispatchEvent(new MockPointerEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 280 }));
    canvas.dispatchEvent(new MockPointerEvent('pointerup', { pointerId: 1 }));

    expect(vp.transform.panX).toBe(50);
    expect(vp.transform.panY).toBe(80);

    vp.dispose();
  });
});

describe('GlobalMapViewport context transform, reset, and lifecycle', () => {
  it('resets state to fit-to-screen and notifies listeners', () => {
    const onChange = vi.fn();
    const vp = new GlobalMapViewport({ baseSize: 640, onChange });
    vp.setZoom(3);
    vp.panBy(100, 100);
    onChange.mockClear();

    vp.reset();
    expect(vp.transform).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(onChange).toHaveBeenCalledWith({ zoom: 1, panX: 0, panY: 0 });
  });

  it('applies translate and scale to 2D canvas context', () => {
    const vp = new GlobalMapViewport({ baseSize: 640 });
    vp.setZoom(2);
    vp.panBy(40, -20);

    const translate = vi.fn();
    const scale = vi.fn();
    const mockCtx = { translate, scale } as unknown as CanvasRenderingContext2D;

    vp.applyToContext(mockCtx, 640, 640);
    expect(translate).toHaveBeenNthCalledWith(1, 320 + 40, 320 - 20);
    expect(scale).toHaveBeenCalledWith(2, 2);
    expect(translate).toHaveBeenNthCalledWith(2, -320, -320);
  });

  it('dispose detaches event listeners', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const vp = new GlobalMapViewport({ canvas });

    vp.dispose();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(vp.transform.zoom).toBe(1);
  });
});
