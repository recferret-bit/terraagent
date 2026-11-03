// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_MAP_MAX_HZ,
  GLOBAL_MAP_MIN_INTERVAL_MS,
  MINIMAP_MAX_HZ,
  MINIMAP_MIN_INTERVAL_MS,
  MapRedrawScheduler,
} from './redrawScheduler';

describe('W04-22 Constants', () => {
  it('exports correct max Hz and interval constants', () => {
    expect(MINIMAP_MAX_HZ).toBe(4);
    expect(MINIMAP_MIN_INTERVAL_MS).toBe(250);
    expect(GLOBAL_MAP_MAX_HZ).toBe(2);
    expect(GLOBAL_MAP_MIN_INTERVAL_MS).toBe(500);
  });
});

describe('W04-22 10 Hz delta streaming rate limits', () => {
  it('redraws minimap at <= 4 Hz and global map at <= 2 Hz over 1,000 ms', () => {
    let mockTime = 0;
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
      now: () => mockTime,
      autoSchedule: false,
    });

    // Stream 10 Hz deltas at t = 0, 100, 200, ..., 900 ms
    for (let t = 0; t <= 900; t += 100) {
      mockTime = t;
      scheduler.markDirty();
    }

    // Advance to t = 1000 and run tick
    mockTime = 1000;
    scheduler.tick(1000);

    // Over the 1,000 ms window ending at t = 1000:
    // Minimap: redrew at t = 0, 300, 600, 900 (total 4 redraws) -> <= 4 Hz
    // Global map: redrew at t = 0, 500, 1000 -> <= 2 Hz in the (0, 1000] sliding window
    expect(scheduler.minimapHz(1000)).toBeLessThanOrEqual(4);
    expect(scheduler.globalMapHz(1000)).toBeLessThanOrEqual(2);

    expect(onMinimap).toHaveBeenCalledTimes(4);
    expect(scheduler.minimapRedraws).toBe(4);
    expect(onGlobal).toHaveBeenCalledTimes(3);
    expect(scheduler.globalMapRedraws).toBe(3);

    scheduler.dispose();
  });

  it('coalesces rapid markDirty calls within the same interval', () => {
    let mockTime = 0;
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
      now: () => mockTime,
      autoSchedule: false,
    });

    // t = 0: first delta triggers immediate redraw
    scheduler.markDirty();
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);

    // t = 50: rapid deltas coalesce without triggering redraws
    mockTime = 50;
    scheduler.markDirty();
    scheduler.markDirty();
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);
    expect(scheduler.minimapPending).toBe(true);
    expect(scheduler.globalMapPending).toBe(true);

    scheduler.dispose();
  });
});

describe('W04-22 Tab hidden pausing', () => {
  it('produces 0 Hz when isHidden is true', () => {
    let mockTime = 0;
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
      isHidden: () => true,
      now: () => mockTime,
      autoSchedule: false,
    });

    // Stream 10 deltas while hidden
    for (let t = 0; t <= 900; t += 100) {
      mockTime = t;
      scheduler.markDirty();
    }
    mockTime = 1000;
    scheduler.tick(1000);

    expect(onMinimap).toHaveBeenCalledTimes(0);
    expect(onGlobal).toHaveBeenCalledTimes(0);
    expect(scheduler.minimapRedraws).toBe(0);
    expect(scheduler.globalMapRedraws).toBe(0);
    expect(scheduler.minimapHz(1000)).toBe(0);
    expect(scheduler.globalMapHz(1000)).toBe(0);
    expect(scheduler.minimapPending).toBe(true);
    expect(scheduler.globalMapPending).toBe(true);

    scheduler.dispose();
  });
});

describe('W04-22 Resuming visibility flushing', () => {
  it('resuming visibility flushes the coalesced dirty state once', () => {
    let hidden = true;
    let mockTime = 0;
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
      isHidden: () => hidden,
      now: () => mockTime,
      autoSchedule: false,
    });

    // 10 deltas arrive while hidden
    for (let t = 0; t <= 900; t += 100) {
      mockTime = t;
      scheduler.markDirty();
    }
    expect(onMinimap).toHaveBeenCalledTimes(0);

    // Tab becomes visible
    hidden = false;
    mockTime = 1200;
    scheduler.flushPending();

    // Both redraw exactly once
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);
    expect(scheduler.minimapPending).toBe(false);
    expect(scheduler.globalMapPending).toBe(false);

    // Subsequent tick without new deltas does not redraw
    mockTime = 1500;
    scheduler.tick(1500);
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('handles document visibilitychange event automatically', () => {
    let mockTime = 0;
    const onMinimap = vi.fn();
    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      now: () => mockTime,
      autoSchedule: false,
    });

    // Mark pending while simulating hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    scheduler.markDirty();
    expect(onMinimap).toHaveBeenCalledTimes(0);
    expect(scheduler.minimapPending).toBe(true);

    // Make visible and dispatch event
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    mockTime = 500;
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(scheduler.minimapPending).toBe(false);

    scheduler.dispose();
  });
});

describe('W04-22 Global map open gating and force redraws', () => {
  it('does not redraw global map when isGlobalMapOpen is false', () => {
    let mockTime = 0;
    let globalOpen = false;
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
      isGlobalMapOpen: () => globalOpen,
      now: () => mockTime,
      autoSchedule: false,
    });

    // Mark dirty: minimap redraws, global map is gated but pending
    scheduler.markDirty();
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(0);
    expect(scheduler.globalMapPending).toBe(true);

    // Opening global map and ticking flushes the pending redraw
    globalOpen = true;
    mockTime = 600;
    scheduler.tick(600);
    expect(onGlobal).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('supports forceRedrawMinimap and forceRedrawGlobalMap immediately', () => {
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
      isGlobalMapOpen: () => false, // even if closed, force redraws
    });

    scheduler.forceRedrawMinimap();
    scheduler.forceRedrawGlobalMap();

    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);
    expect(scheduler.minimapRedraws).toBe(1);
    expect(scheduler.globalMapRedraws).toBe(1);

    scheduler.dispose();
  });

  it('supports selective markDirty options', () => {
    const onMinimap = vi.fn();
    const onGlobal = vi.fn();

    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      onRedrawGlobalMap: onGlobal,
    });

    scheduler.markDirty({ minimap: true, globalMap: false });
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(0);

    scheduler.markDirty({ minimap: false, globalMap: true });
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });
});

describe('W04-22 Timer autoSchedule, stats reset, and disposal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-schedules timeout to flush pending deltas after interval', () => {
    const onMinimap = vi.fn();
    const scheduler = new MapRedrawScheduler({
      onRedrawMinimap: onMinimap,
      autoSchedule: true,
    });

    // First markDirty fires immediately at t = 0
    scheduler.markDirty();
    expect(onMinimap).toHaveBeenCalledTimes(1);

    // Delta at t = 50 ms gets coalesced
    vi.advanceTimersByTime(50);
    scheduler.markDirty();
    expect(onMinimap).toHaveBeenCalledTimes(1);
    expect(scheduler.minimapPending).toBe(true);

    // Advance 200 ms to reach 250 ms interval -> timer fires
    vi.advanceTimersByTime(200);
    expect(onMinimap).toHaveBeenCalledTimes(2);
    expect(scheduler.minimapPending).toBe(false);

    scheduler.dispose();
  });

  it('resets stats with resetStats', () => {
    const scheduler = new MapRedrawScheduler();
    scheduler.forceRedrawMinimap();
    scheduler.forceRedrawGlobalMap();

    expect(scheduler.minimapRedraws).toBe(1);
    expect(scheduler.globalMapRedraws).toBe(1);

    scheduler.resetStats();
    expect(scheduler.minimapRedraws).toBe(0);
    expect(scheduler.globalMapRedraws).toBe(0);
    expect(scheduler.minimapHz(1000)).toBe(0);
    expect(scheduler.globalMapHz(1000)).toBe(0);

    scheduler.dispose();
  });
});
