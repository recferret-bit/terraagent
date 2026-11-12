// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { sizeColonyViewport, type ViewportSizeState } from './createColonyViewport';
import { buildPixelArtFrag, createPixelArtPass, setPixelArt } from './pixelArtPass';
import { disposeCrt, initCrt, resetCrtParams, setCrtParams } from '../ui/crt';

describe('pixelArtPass & viewport sizing', () => {
  const origDpr = window.devicePixelRatio;

  beforeEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  });

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: origDpr });
    disposeCrt();
  });

  it('supports preserveAlpha option for transparent planet cards while defaulting opaque', () => {
    const opaque = createPixelArtPass(280, 280);
    const alpha = createPixelArtPass(280, 280, { preserveAlpha: true });
    expect(opaque.uniforms.uPreserveAlpha!.value).toBe(0);
    expect(alpha.uniforms.uPreserveAlpha!.value).toBe(1);
    expect(buildPixelArtFrag()).toContain('uPreserveAlpha');
    opaque.dispose();
    alpha.dispose();
  });

  it('keeps pixel-art uResolution locked to display DPR across AUTO render-scale steps and skips no-op resizes', () => {
    const setPixelRatio = vi.fn();
    const setSize = vi.fn();
    const compSetPixelRatio = vi.fn();
    const compSetSize = vi.fn();
    const renderer = { setPixelRatio, setSize, domElement: { width: 0, height: 0 } } as unknown as THREE.WebGLRenderer;
    const composer = { setPixelRatio: compSetPixelRatio, setSize: compSetSize } as unknown as EffectComposer;
    const bloom = { resolution: new THREE.Vector2() } as unknown as UnrealBloomPass;
    const pixelArt = createPixelArtPass(100, 100);
    const cam = new THREE.PerspectiveCamera(28, 1, 1, 100);
    const renderPass = { camera: cam } as unknown as RenderPass;
    const state: ViewportSizeState = { rw: -1, rh: -1, dpr: -1, pixelDpr: -1, aspect: -1 };

    // Initial size at dpr = 2 (800x500 CSS -> 1600x1000 pixel-art grid)
    sizeColonyViewport(renderer, composer, bloom, pixelArt, renderPass, cam, 800, 500, null, 2, state);
    expect(setSize).toHaveBeenCalledTimes(1);
    expect(pixelArt.uniforms.uResolution!.value.x).toBe(1600);
    expect(pixelArt.uniforms.uResolution!.value.y).toBe(1000);

    // Redundant ResizeObserver callback with unchanged dimensions/dpr must NOT call renderer.setSize (which clears WebGL)
    sizeColonyViewport(renderer, composer, bloom, pixelArt, renderPass, cam, 800, 500, null, 2, state);
    expect(setSize).toHaveBeenCalledTimes(1);

    // AdaptiveScale drops dpr from 2 -> 1: backing buffer resizes, pixel-art grid stays at 1600x1000
    sizeColonyViewport(renderer, composer, bloom, pixelArt, renderPass, cam, 800, 500, null, 1, state);
    expect(setSize).toHaveBeenCalledTimes(2);
    expect(pixelArt.uniforms.uResolution!.value.x).toBe(1600);
    expect(pixelArt.uniforms.uResolution!.value.y).toBe(1000);

    // Custom fixed preset uses 1x DPR
    sizeColonyViewport(renderer, composer, bloom, pixelArt, renderPass, cam, 800, 500, { width: 1280, height: 720 }, 1, state);
    expect(pixelArt.uniforms.uResolution!.value.x).toBe(1280);
    expect(pixelArt.uniforms.uResolution!.value.y).toBe(720);

    pixelArt.dispose();
  });

  it('uses 2x2 fallback pixel filter, zero-Y centered CRT wave, and preserves CSS pixel filter during wave', () => {
    vi.useFakeTimers();
    const rafQueue: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    try {
      document.body.innerHTML = '<div id="host"><canvas id="c"></canvas></div>';
      const host = document.getElementById('host')!;
      const canvas = document.getElementById('c')!;
      setPixelArt(true, false);
      initCrt([host], { showControls: false, showFps: false });
      setCrtParams({ waveInterval: 2 });

      const pxFilter = document.getElementById('pixel-svg-filter')!;
      expect(pxFilter.querySelector('feComposite')?.getAttribute('width')).toBe('2');
      expect(pxFilter.querySelector('feMorphology')?.getAttribute('radius')).toBe('1');

      const waveFilter = document.getElementById('crt-wave')!;
      expect(waveFilter.querySelector('feTurbulence')?.getAttribute('type')).toBe('fractalNoise');
      expect(waveFilter.querySelector('feFlood')?.getAttribute('flood-color')).toBe('#808080');
      expect(waveFilter.querySelector('feDisplacementMap')?.getAttribute('yChannelSelector')).toBe('G');

      // Advance past max wave delay (2 * 1.35s = 2.7s) while rAF is paused so wave() is captured mid-flight
      vi.advanceTimersByTime(3000);
      expect(canvas.style.filter).toContain('url(#pixel-svg-filter)');
      expect(canvas.style.filter).toContain('url(#crt-wave)');

      // Completing the wave restores original inline filter
      const cb = rafQueue.shift()!;
      cb(performance.now() + 2000);
      expect(canvas.style.filter).toBe('');
    } finally {
      rafSpy.mockRestore();
      resetCrtParams();
      vi.useRealTimers();
    }
  });
});
