// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createLabStore } from '../core/labStore';
import {
  getPerfParams, getRenderScaleMode, isFocusRingOn, isPerfOn, parsePerfUrl, perfTelemetry, PERF_RANGES,
  getTargetFps, resetPerfParams, setPerf, setPerfParams, skipDaySecondaryShadow, skipNightSunShadow,
} from '../core/perfConfig';
import { createRenderScaleController } from '../core/renderScale';
import { getViewFocusMargin, isViewFocusEnabled, setViewFocusEnabled, setViewFocusMargin, VIEW_FOCUS_MARGIN } from '../core/viewFocus';
import { createViewFocusRing } from '../core/viewFocusRing';
import { daySecondaryShadowFade, nightSunShadowFade } from '../core/shadowFit';
import { disposePixelDialog, initPixelDialog, selectVisualTab, togglePixelDialog } from './pixelDialog';
import { PERF_SLIDERS } from './visualLabSpecs';
import { getVisualLabTab } from './visualLabTabs';

function restore() {
  resetPerfParams();
  setPerf(true);
  setViewFocusEnabled(true);
}

describe('F8 → PERF store', () => {
  beforeEach(restore);
  afterEach(restore);

  it('defaults: AUTO scale at the display rate, margin 1.0, no ring, daytime secondary + night sun shadow skipped', () => {
    expect(getPerfParams()).toEqual({
      renderScale: 0, targetFps: 0, focusMargin: VIEW_FOCUS_MARGIN, focusRing: 0, daySecondaryShadow: 0, nightSunShadow: 0,
    });
    expect(VIEW_FOCUS_MARGIN).toBe(1);
    expect(getRenderScaleMode()).toBe('auto');
    expect(getTargetFps()).toBe('display');
    expect(skipDaySecondaryShadow()).toBe(true);
    expect(skipNightSunShadow()).toBe(true);
    setPerfParams({ targetFps: 2 });
    expect(getTargetFps()).toBe(120);
    expect(parsePerfUrl(new URLSearchParams('fps=60')).targetFps).toBe(1);
    expect(isFocusRingOn()).toBe(false);
    expect(PERF_SLIDERS.map((s) => s.key).sort()).toEqual(Object.keys(PERF_RANGES).sort());
  });

  it('the margin reaches viewFocus (clamped); OFF = native DPR, focus off, secondary shadow on; ON restores the focus', () => {
    setPerfParams({ focusMargin: 2.2 });
    expect(getViewFocusMargin()).toBeCloseTo(2.2, 5);
    setPerfParams({ focusMargin: 9 });
    expect(getViewFocusMargin()).toBe(2.5);
    expect(setViewFocusMargin(0.2)).toBe(1);
    setPerfParams({ renderScale: 3, focusRing: 1 });
    expect(getRenderScaleMode()).toBe(1.5);
    setPerf(false);
    expect(getRenderScaleMode()).toBe('native');
    expect(isViewFocusEnabled()).toBe(false);
    expect(skipDaySecondaryShadow()).toBe(false);
    expect(skipNightSunShadow()).toBe(false);
    expect(isFocusRingOn()).toBe(false);
    setPerfParams({ focusMargin: 1.2 }); // a param edit while OFF must not switch the focus back on
    expect(isViewFocusEnabled()).toBe(false);
    setPerf(true);
    expect(isViewFocusEnabled()).toBe(true);
  });

  it('parses ?scale= and ?focusRing= and the lab store applies URL params without persisting them', () => {
    expect(parsePerfUrl(new URLSearchParams('scale=auto&focusRing=1'))).toEqual({ renderScale: 0, focusRing: 1 });
    expect(parsePerfUrl(new URLSearchParams('scale=1.25'))).toEqual({ renderScale: 2 });
    expect(parsePerfUrl(new URLSearchParams('scale=2&focusRing=0'))).toEqual({ renderScale: 4, focusRing: 0 });
    expect(parsePerfUrl(new URLSearchParams('scale=3'))).toEqual({});
    localStorage.removeItem('test.url.params.v1');
    const s = createLabStore<{ a: number }>({
      key: 'test.url', version: 1, urlFlag: 'testurl', defaultOn: true, defaults: { a: 1 }, ranges: { a: [0, 2] },
      urlParams: () => ({ a: 7 }),
    });
    expect(s.get().a).toBe(2);
    expect(localStorage.getItem('test.url.params.v1')).toBeNull();
  });

  it('render-scale controller: fixed ratio capped at the ceiling, native when OFF, resize only on a mode change', () => {
    let resizes = 0;
    const c = createRenderScaleController(() => { resizes++; });
    expect(c.resolve(2)).toBe(2); // AUTO starts at the top
    setPerfParams({ renderScale: 3 });
    expect(resizes).toBe(1);
    expect(c.resolve(2)).toBe(1.5);
    expect(c.resolve(1)).toBe(1);
    setPerfParams({ focusMargin: 2 });
    expect(resizes).toBe(1);
    setPerf(false);
    expect(c.resolve(2)).toBe(2);
    expect(resizes).toBe(2);
    let t = 1000;
    for (let i = 0; i < 30; i++) expect(c.frame((t += 16))).toBe(false);
    expect(perfTelemetry.frameMs).toBeCloseTo(16, 3);
    c.dispose();
  });

});

describe('F8 → PERF shadow fades', () => {
  it('daytime secondary fade: 0 by day, smooth to 1 toward night, always 1 when not skipped', () => {
    expect(daySecondaryShadowFade(0, true)).toBe(0);
    expect(daySecondaryShadowFade(0.02, true)).toBe(0);
    expect(daySecondaryShadowFade(0.26, true)).toBeCloseTo(0.5, 5);
    expect(daySecondaryShadowFade(1, true)).toBe(1);
    expect(daySecondaryShadowFade(0, false)).toBe(1);
  });

  it('night sun shadow fade: full by day and at sunset, 0 an hour after it, always 1 when not skipped', () => {
    expect(nightSunShadowFade(0, true)).toBe(1);
    expect(nightSunShadowFade(0.5, true)).toBe(1);
    expect(nightSunShadowFade(0.775, true)).toBeCloseTo(0.5, 5);
    expect(nightSunShadowFade(0.95, true)).toBe(0);
    expect(nightSunShadowFade(1, false)).toBe(1);
  });

  it('focus ring: built lazily, follows the focus radii, hidden when off', () => {
    const ring = createViewFocusRing();
    const scene = new THREE.Scene();
    const focus = { x: 5, z: -3, radius: 60, visibleRadius: 40, enabled: true };
    ring.update(scene, focus, 0, false);
    expect(scene.children.length).toBe(0);
    ring.update(scene, focus, 0, true);
    const g = scene.getObjectByName('viewFocusRing')!;
    expect(g.visible).toBe(true);
    expect(g.position.x).toBe(5);
    expect(g.children.slice(0, 2).map((m) => m.scale.x)).toEqual([60, 40]);
    expect(g.children[2]).toBeInstanceOf(THREE.LineLoop); // the focus quad outline
    ring.update(scene, { ...focus, enabled: false }, 0, true);
    expect(g.visible).toBe(false);
    ring.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('F8 dialog PERF tab', () => {
  beforeEach(() => { restore(); document.body.innerHTML = ''; });
  afterEach(() => { disposePixelDialog(); restore(); });

  it('renders the live readout + scale picks, the sliders write through, and the switch is PERF OPTIMISATIONS', () => {
    initPixelDialog();
    togglePixelDialog(true);
    const dlg = document.getElementById('pixel-dlg')!;
    selectVisualTab('perf');
    expect(dlg.querySelector('#pd-status-lbl')?.textContent).toBe('PERF OPTIMISATIONS');
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(PERF_SLIDERS.length);
    expect(dlg.querySelector('#pd-perf-read')?.textContent).toContain('AUTO');
    expect(dlg.querySelector('[data-val="renderScale"]')?.textContent).toBe('AUTO (DYNAMIC)');
    dlg.querySelector<HTMLButtonElement>('[data-perf-scale="1"]')!.click();
    expect(getPerfParams().renderScale).toBe(1);
    expect(dlg.querySelector('[data-val="renderScale"]')?.textContent).toBe('×1.00 FIXED');
    const m = dlg.querySelector<HTMLInputElement>('input[data-key="focusMargin"]')!;
    m.value = '1';
    m.dispatchEvent(new Event('input'));
    expect(getViewFocusMargin()).toBe(1);
    dlg.querySelector<HTMLButtonElement>('#pd-enable')!.click();
    expect(isPerfOn()).toBe(false);
    expect(isViewFocusEnabled()).toBe(false);
    expect(dlg.querySelector('#pd-perf-read')?.textContent).toContain('NATIVE');
    getVisualLabTab('perf').setParam('focusRing', 1); // a slider edit switches PERF back on
    expect(isPerfOn()).toBe(true);
    expect(isFocusRingOn()).toBe(true);
  });
});
