// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFramePacer } from './framePacer';
import {
  getFpsCap,
  parseFpsLimit,
  resetPerfParams,
  setFpsCap,
  setPerf,
  setPerfParams,
  type FpsLimit,
} from './perfConfig';
import { createRenderScaleController, targetRefreshMs } from './renderScale';
import { disposeFpsCounter, initFpsCounter, noteRenderedFrame } from '../ui/fps';

function resetPerfState(): void {
  localStorage.clear();
  setFpsCap(0);
  resetPerfParams();
  setPerf(true);
}

describe('FPS Cap Parsing & Persistence', () => {
  beforeEach(resetPerfState);
  afterEach(() => {
    disposeFpsCounter();
    setFpsCap(0);
  });

  it('parses valid FPS limits and rejects out-of-range or malformed inputs', () => {
    expect(parseFpsLimit(0)).toBe(0);
    expect(parseFpsLimit('0')).toBe(0);
    expect(parseFpsLimit('uncapped')).toBe(0);
    expect(parseFpsLimit('max')).toBe(0);
    expect(parseFpsLimit(60)).toBe(60);
    expect(parseFpsLimit('60')).toBe(60);
    expect(parseFpsLimit('90')).toBe(90);
    expect(parseFpsLimit(120)).toBe(120);
    expect(parseFpsLimit(30)).toBe(30);
    expect(parseFpsLimit('')).toBeNull();
    expect(parseFpsLimit(null)).toBeNull();
    expect(parseFpsLimit(undefined)).toBeNull();
    expect(parseFpsLimit('75')).toBeNull();
    expect(parseFpsLimit(-60)).toBeNull();
  });

  it('persists FPS cap in localStorage and notifies subscribers', () => {
    expect(getFpsCap()).toBe(0);
    expect(setFpsCap(60)).toBe(60);
    expect(getFpsCap()).toBe(60);
    expect(localStorage.getItem('terraagent.fpsCap')).toBe('60');
    expect(setFpsCap(999 as FpsLimit)).toBe(60);
    resetPerfParams();
    expect(getFpsCap()).toBe(0);
    expect(localStorage.getItem('terraagent.fpsCap')).toBe('0');
  });
});

describe('FramePacer VSync Phase-Locking', () => {
  it('locks 120 Hz ProMotion rAF stream to rock-solid 60 FPS (every 2nd VSync) even under VSync jitter', () => {
    let cap: FpsLimit = 60;
    const pacer = createFramePacer({
      getCap: () => cap,
      getRefreshMs: () => 1000 / 120,
    });

    const renderedAt: number[] = [];
    const dts: number[] = [];
    for (let i = 0; i <= 240; i++) {
      const jitter = i === 0 ? 0 : Math.sin(i * 1.9) * 0.35;
      const dt = pacer.next(i * (1000 / 120) + jitter);
      if (dt !== null) {
        renderedAt.push(i);
        dts.push(dt);
      }
    }

    expect(renderedAt.length).toBe(121);
    for (let k = 0; k < renderedAt.length; k++) expect(renderedAt[k]).toBe(k * 2);
    for (let k = 1; k < dts.length; k++) {
      expect(dts[k]).toBeGreaterThan(0.0155);
      expect(dts[k]).toBeLessThan(0.0178);
    }

    cap = 0;
    let uncappedCount = 0;
    for (let i = 241; i <= 260; i++) {
      if (pacer.next(i * (1000 / 120)) !== null) uncappedCount++;
    }
    expect(uncappedCount).toBe(20);
  });

  it('never drops a 60 Hz display down to 30 FPS when capped at 60 FPS', () => {
    const pacer = createFramePacer({ getCap: () => 60, getRefreshMs: () => 1000 / 60 });
    let rendered = 0;
    for (let i = 0; i <= 120; i++) {
      const jitter = i === 0 ? 0 : Math.cos(i * 2.3) * 0.4;
      if (pacer.next(i * (1000 / 60) + jitter) !== null) rendered++;
    }
    expect(rendered).toBe(121);
  });

  it('holds accurate average 60 FPS and 30 FPS on non-integer 144 Hz displays and clamps long background gaps', () => {
    let cap: FpsLimit = 60;
    const pacer = createFramePacer({ maxDt: 0.05, getCap: () => cap, getRefreshMs: () => 1000 / 144 });

    let rendered60 = 0;
    let now = 0;
    for (let i = 0; i < 1440; i++) {
      now = i * (1000 / 144);
      if (pacer.next(now) !== null) rendered60++;
    }
    expect(rendered60).toBeGreaterThanOrEqual(598);
    expect(rendered60).toBeLessThanOrEqual(602);

    expect(pacer.next(now + 5000)).toBe(0.05);
    expect(pacer.next(now + 5000 + 6.94)).toBeNull();

    cap = 30;
    let rendered30 = 0;
    const base = now + 6000;
    for (let i = 0; i < 144; i++) {
      if (pacer.next(base + i * (1000 / 144)) !== null) rendered30++;
    }
    expect(rendered30).toBeGreaterThanOrEqual(29);
    expect(rendered30).toBeLessThanOrEqual(31);
  });
});

describe('AdaptiveScale & FPS Counter Integration', () => {
  beforeEach(resetPerfState);
  afterEach(() => {
    disposeFpsCounter();
    setFpsCap(0);
  });

  it('aligns AdaptiveScale targetRefreshMs with fpsCap so 60 FPS cap on 120 Hz does not falsely drop resolution', () => {
    setFpsCap(60);
    expect(targetRefreshMs()).toBeCloseTo(1000 / 60, 3);
    const ctrl = createRenderScaleController(() => {});
    expect(ctrl.resolve(2)).toBe(2);
    let t = 1000;
    for (let i = 0; i < 180; i++) {
      t += 1000 / 60;
      expect(ctrl.frame(t)).toBe(false);
    }
    expect(ctrl.resolve(2)).toBe(2);
    ctrl.dispose();
  });

  it('holds DPR 2.0 under 30 FPS cap (including dynamic 0 -> 30 -> 0 transitions and 144 Hz cadence) without false resize hitches', () => {
    let resizeCalls = 0;
    const ctrl = createRenderScaleController(() => {
      resizeCalls++;
      ctrl.resolve(2);
    });
    expect(ctrl.resolve(2)).toBe(2);

    // Switch dynamically to 30 FPS cap
    setFpsCap(30);
    expect(targetRefreshMs()).toBeCloseTo(1000 / 30, 3);
    expect(resizeCalls).toBe(1);

    let t = 1000;
    // Simulate 10 seconds of 30 FPS on a 144 Hz monitor (alternating 4 VSyncs = 27.78ms and 5 VSyncs = 34.72ms)
    for (let i = 0; i < 300; i++) {
      t += i % 5 === 0 ? (4 * 1000) / 144 : (5 * 1000) / 144;
      expect(ctrl.frame(t)).toBe(false);
    }
    expect(ctrl.resolve(2)).toBe(2);

    // Simulate real GPU overload at 30 FPS cap (45 ms frames for > 1.2s) -> steps down once
    let steppedDown = false;
    for (let i = 0; i < 40; i++) {
      t += 45;
      if (ctrl.frame(t)) steppedDown = true;
    }
    expect(steppedDown).toBe(true);
    expect(ctrl.resolve(2)).toBe(1.75);

    // Switch back to uncapped -> resets to ceiling 2.0 and treats 33.3 ms GPU-bound frames as slow again
    setFpsCap(0);
    expect(ctrl.resolve(2)).toBe(2);
    let uncappedStepDown = false;
    for (let i = 0; i < 50; i++) {
      t += 1000 / 30;
      if (ctrl.frame(t)) uncappedStepDown = true;
    }
    expect(uncappedStepDown).toBe(true);
    expect(ctrl.resolve(2)).toBe(1.75);
    ctrl.dispose();
  });
});

describe('RenderScaleController High-Cap 60 Hz Safety & FPS Counter', () => {
  beforeEach(resetPerfState);
  afterEach(() => {
    disposeFpsCounter();
    setFpsCap(0);
  });

  it('does not falsely step down DPR on a 60 Hz display when fpsCap is 90 or 120 before displayRefresh warms up, and resets on targetFps change', () => {
    for (const cap of [120, 90] as const) {
      setFpsCap(cap);
      expect(targetRefreshMs()).toBeNull();
      const ctrl = createRenderScaleController(() => { ctrl.resolve(2); });
      expect(ctrl.resolve(2)).toBe(2);
      let t = 1000;
      for (let i = 0; i < 240; i++) {
        t += 1000 / 60;
        expect(ctrl.frame(t)).toBe(false);
      }
      expect(ctrl.resolve(2)).toBe(2);
      ctrl.dispose();
    }

    setFpsCap(0);
    setPerfParams({ targetFps: 2 }); // 120 FPS explicit target
    const ctrl = createRenderScaleController(() => { ctrl.resolve(2); });
    expect(ctrl.resolve(2)).toBe(2);
    let t = 1000;
    for (let i = 0; i < 90; i++) {
      t += 16.67;
      ctrl.frame(t);
    }
    expect(ctrl.resolve(2)).toBeLessThan(2);
    // Switching F8 TARGET FPS to 60 restarts AUTO at ceiling 2.0
    setPerfParams({ targetFps: 1 });
    expect(ctrl.resolve(2)).toBe(2);
    ctrl.dispose();
  });

  it('reports exact 60 FPS without 59/61 VSync window oscillation when noteRenderedFrame(now) is called', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    try {
      initFpsCounter();
      const base = performance.now();
      // Simulate 240 VSyncs at 120 Hz (8.3333 ms) with renders on every 2nd VSync (60 FPS = 16.6667 ms)
      for (let i = 1; i <= 240; i++) {
        const ts = base + (i * 1000) / 120;
        if (i % 2 === 0) noteRenderedFrame(ts);
        const cb = rafCallbacks.shift()!;
        cb(ts);
        if (i === 61 || i === 122 || i === 183) {
          expect(Number(document.querySelector('#fps-counter .fps-val')?.textContent)).toBe(60);
        }
      }
      expect(document.querySelector('#fps-counter .fps-ms')?.textContent).toBe('(16.7 ms)');
    } finally {
      window.requestAnimationFrame = origRaf;
    }
  });
});
