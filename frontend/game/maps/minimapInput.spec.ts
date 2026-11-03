// @vitest-environment jsdom
import { inHex } from '@terra/sim/grid/hex';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindMinimapInput,
  clampPixelToAxial,
  isExpandButtonTarget,
} from './minimapInput';

function createHarness(radius = 6) {
  const container = document.createElement('section');
  container.className = 'ta-minimap plate-sm';

  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 180;
  canvas.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 180,
    bottom: 180,
    width: 180,
    height: 180,
    toJSON: () => {},
  });

  const expandBtn = document.createElement('button');
  expandBtn.dataset.testid = 'minimap-expand';
  const expandIcon = document.createElement('span');
  expandIcon.textContent = '⤢';
  expandBtn.appendChild(expandIcon);

  container.append(canvas, expandBtn);
  document.body.appendChild(container);

  container.setPointerCapture = vi.fn();
  container.releasePointerCapture = vi.fn();

  const onPanToTile = vi.fn();
  const controller = bindMinimapInput({
    container,
    canvas,
    expandButton: expandBtn,
    getRadius: () => radius,
    onPanToTile,
  });

  return { container, canvas, expandBtn, expandIcon, onPanToTile, controller, radius };
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  opts: {
    clientX?: number;
    clientY?: number;
    button?: number;
    pointerId?: number;
    pointerType?: string;
  } = {},
): void {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: opts.pointerId ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: opts.pointerType ?? 'mouse' });
  target.dispatchEvent(ev);
}

describe('W04-10: minimap click & corner clamping', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('pans to centre tile (0, 0) when clicking at canvas centre', () => {
    const { canvas, onPanToTile, controller } = createHarness(6);
    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90 });
    expect(onPanToTile).toHaveBeenCalledWith(0, 0);
    controller.dispose();
  });

  it('clamps top-left far corner to planet hex boundary', () => {
    const { canvas, onPanToTile, radius, controller } = createHarness(6);
    dispatchPointer(canvas, 'pointerdown', { clientX: 0, clientY: 0 });
    expect(onPanToTile).toHaveBeenCalledTimes(1);
    const [q, r] = onPanToTile.mock.calls[0]!;
    expect(inHex(q, r, radius)).toBe(true);
    expect(q).toBeLessThanOrEqual(0);
    expect(r).toBeLessThan(0);
    controller.dispose();
  });

  it('clamps all 4 outer corners to valid boundary tiles', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 0, y: 180 },
      { x: 180, y: 180 },
    ];
    for (const { x, y } of corners) {
      const { q, r } = clampPixelToAxial(x, y, 180, 6);
      expect(inHex(q, r, 6)).toBe(true);
    }
  });

  it('ignores non-primary mouse clicks such as right-click', () => {
    const { canvas, onPanToTile, controller } = createHarness(6);
    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90, button: 2 });
    expect(onPanToTile).not.toHaveBeenCalled();
    expect(controller.isDragging()).toBe(false);
    controller.dispose();
  });
});

describe('W04-10: continuous drag & pointer capture', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('follows pointer drag continuously and captures/releases pointer', () => {
    const { container, canvas, onPanToTile, controller } = createHarness(6);

    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90, pointerId: 42 });
    expect(controller.isDragging()).toBe(true);
    expect(container.setPointerCapture).toHaveBeenCalledWith(42);
    expect(onPanToTile).toHaveBeenLastCalledWith(0, 0);

    dispatchPointer(container, 'pointermove', { clientX: 110, clientY: 90, pointerId: 42 });
    expect(onPanToTile).toHaveBeenCalledTimes(2);

    dispatchPointer(container, 'pointermove', { clientX: 130, clientY: 90, pointerId: 42 });
    expect(onPanToTile).toHaveBeenCalledTimes(3);

    dispatchPointer(container, 'pointerup', { clientX: 130, clientY: 90, pointerId: 42 });
    expect(controller.isDragging()).toBe(false);
    expect(container.releasePointerCapture).toHaveBeenCalledWith(42);

    controller.dispose();
  });

  it('ignores pointermove from different pointer IDs', () => {
    const { container, canvas, onPanToTile, controller } = createHarness(6);
    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90, pointerId: 10 });
    expect(onPanToTile).toHaveBeenCalledTimes(1);

    dispatchPointer(container, 'pointermove', { clientX: 120, clientY: 90, pointerId: 99 });
    expect(onPanToTile).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('releases capture and ends drag on pointercancel', () => {
    const { container, canvas, controller } = createHarness(6);
    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90, pointerId: 7 });
    expect(controller.isDragging()).toBe(true);

    dispatchPointer(container, 'pointercancel', { pointerId: 7 });
    expect(controller.isDragging()).toBe(false);
    expect(container.releasePointerCapture).toHaveBeenCalledWith(7);

    controller.dispose();
  });
});

describe('W04-10: expand button exclusion', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('does not pan or drag when click lands on expand button', () => {
    const { expandBtn, onPanToTile, controller } = createHarness(6);
    dispatchPointer(expandBtn, 'pointerdown', { clientX: 165, clientY: 15 });
    expect(onPanToTile).not.toHaveBeenCalled();
    expect(controller.isDragging()).toBe(false);
    controller.dispose();
  });

  it('does not pan when click lands on child icon of expand button', () => {
    const { expandIcon, onPanToTile, controller } = createHarness(6);
    dispatchPointer(expandIcon, 'pointerdown', { clientX: 165, clientY: 15 });
    expect(onPanToTile).not.toHaveBeenCalled();
    expect(controller.isDragging()).toBe(false);
    controller.dispose();
  });

  it('evaluates isExpandButtonTarget correctly for detached and arbitrary elements', () => {
    expect(isExpandButtonTarget(null)).toBe(false);
    const div = document.createElement('div');
    expect(isExpandButtonTarget(div)).toBe(false);
    const exp = document.createElement('button');
    exp.dataset.testid = 'minimap-expand';
    expect(isExpandButtonTarget(exp)).toBe(true);
  });
});

describe('W04-10: disposal cleanup', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('removes listeners and stops drag after dispose()', () => {
    const { container, canvas, onPanToTile, controller } = createHarness(6);
    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90, pointerId: 5 });
    expect(controller.isDragging()).toBe(true);

    controller.dispose();
    expect(controller.isDragging()).toBe(false);

    onPanToTile.mockClear();
    dispatchPointer(canvas, 'pointerdown', { clientX: 90, clientY: 90, pointerId: 6 });
    expect(onPanToTile).not.toHaveBeenCalled();
  });
});
