// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { loadFeatures } from '../../core/registry';
import type { FeatureContext } from '../../core/registry/types';
import defaultFeature, {
  formatDwellCountdown,
  formatItemList,
  formatItemLabel,
  isWaveOn,
  mountStageTrackHud,
  showStageToast,
  StageTrackHud,
} from './index';
import { expectToastUnlocks, makeMockContext, makeMockTransport } from './stageTestHelpers';

describe('W08-12 formatDwellCountdown', () => {
  it('formats various dwell times accurately as M:SS', () => {
    expect(formatDwellCountdown(80)).toBe('1:20');
    expect(formatDwellCountdown(60)).toBe('1:00');
    expect(formatDwellCountdown(5)).toBe('0:05');
    expect(formatDwellCountdown(0)).toBe('0:00');
    expect(formatDwellCountdown(-10)).toBe('0:00');
    expect(formatDwellCountdown(120)).toBe('2:00');
    expect(formatDwellCountdown(125)).toBe('2:05');
  });
});

describe('W08-12 Acceptance Check', () => {
  let container: HTMLElement;
  let ctx: FeatureContext;

  beforeEach(() => {
    container = document.createElement('div');
    ctx = makeMockContext();
  });

  it('renders 11 segments (S0–S10) with S1 lit, S2 pending with condition text, and 80s dwell formatted as 1:20', () => {
    const mounted = mountStageTrackHud(container, ctx);
    expect(mounted.hud).toBeInstanceOf(StageTrackHud);

    // Initial state at S0
    const hudEl = container.querySelector('[data-testid="stage-track-hud"]');
    expect(hudEl).not.toBeNull();

    // Verify 11 segments exist (S0..S10)
    const segmentsContainer = container.querySelector('[data-testid="stage-track-segments"]');
    expect(segmentsContainer).not.toBeNull();
    const segments = segmentsContainer?.querySelectorAll('.ta-stage-segment');
    expect(segments?.length).toBe(11);

    for (let i = 0; i <= 10; i++) {
      const seg = container.querySelector(`[data-testid="stage-segment-S${i}"]`);
      expect(seg).not.toBeNull();
      expect(seg?.getAttribute('data-stage')).toBe(String(i));
    }

    // Now update view to stage 1 with 80 seconds dwell remaining
    mounted.update?.({
      colonies: [
        {
          index: 0,
          stage: 1,
          stageDwellRemainingS: 80,
          nextStageConditionText: 'extractor + generator · 2 min',
        },
      ],
    });

    // Check S1 is current (lit)
    const s1 = container.querySelector('[data-testid="stage-segment-S1"]');
    expect(s1?.classList.contains('is-current')).toBe(true);
    expect(s1?.getAttribute('data-state')).toBe('current');

    // Check S0 is completed
    const s0 = container.querySelector('[data-testid="stage-segment-S0"]');
    expect(s0?.classList.contains('is-completed')).toBe(true);
    expect(s0?.getAttribute('data-state')).toBe('completed');

    // Check S2 is next (pending)
    const s2 = container.querySelector('[data-testid="stage-segment-S2"]');
    expect(s2?.classList.contains('is-next')).toBe(true);
    expect(s2?.getAttribute('data-state')).toBe('pending');

    // Check S3..S10 are locked
    for (let i = 3; i <= 10; i++) {
      const seg = container.querySelector(`[data-testid="stage-segment-S${i}"]`);
      expect(seg?.classList.contains('is-locked')).toBe(true);
      expect(seg?.getAttribute('data-state')).toBe('locked');
    }

    // Header labels
    expect(container.querySelector('[data-testid="stage-current-label"]')?.textContent).toBe('S1 First Light');
    expect(container.querySelector('[data-testid="stage-current-teaches"]')?.textContent).toContain(
      'Resources flow, and everything costs energy',
    );

    // Next stage condition
    expect(container.querySelector('[data-testid="stage-next-condition"]')?.textContent).toBe(
      'extractor + generator · 2 min',
    );

    // Dwell countdown: 80 seconds formatted as 1:20
    const dwellEl = container.querySelector('[data-testid="stage-dwell-countdown"]');
    expect(dwellEl?.textContent).toBe('1:20');
    expect(dwellEl?.getAttribute('data-active')).toBe('true');

    mounted.dispose();
  });
});

describe('W08-12 Stage Transitions (S0 -> S1 -> S2 -> S3)', () => {
  let container: HTMLElement;
  let ctx: FeatureContext;

  beforeEach(() => {
    container = document.createElement('div');
    ctx = makeMockContext();
  });

  it('updates labels, teaches text, segment states and conditions smoothly across stage transitions', () => {
    const mounted = mountStageTrackHud(container, ctx);

    // S0: Landing
    mounted.update?.({
      colonies: [{ index: 0, stage: 0, stageDwellRemainingS: null }],
    });
    expect(container.querySelector('[data-testid="stage-current-label"]')?.textContent).toBe('S0 Landing');
    expect(container.querySelector('[data-testid="stage-current-teaches"]')?.textContent).toBe(
      'Prepare ground, then build',
    );
    expect(container.querySelector('[data-testid="stage-segment-S0"]')?.getAttribute('data-state')).toBe('current');
    expect(container.querySelector('[data-testid="stage-segment-S1"]')?.getAttribute('data-state')).toBe('pending');
    expect(container.querySelector('[data-testid="stage-segment-S2"]')?.getAttribute('data-state')).toBe('locked');
    expect(container.querySelector('[data-testid="stage-dwell-countdown"]')?.textContent).toBe('—');

    // S1: First Light
    mounted.update?.({
      colonies: [{ index: 0, stage: 1, stageDwellRemainingS: 60 }],
    });
    expect(container.querySelector('[data-testid="stage-current-label"]')?.textContent).toBe('S1 First Light');
    expect(container.querySelector('[data-testid="stage-segment-S0"]')?.getAttribute('data-state')).toBe('completed');
    expect(container.querySelector('[data-testid="stage-segment-S1"]')?.getAttribute('data-state')).toBe('current');
    expect(container.querySelector('[data-testid="stage-segment-S2"]')?.getAttribute('data-state')).toBe('pending');
    expect(container.querySelector('[data-testid="stage-segment-S3"]')?.getAttribute('data-state')).toBe('locked');
    expect(container.querySelector('[data-testid="stage-dwell-countdown"]')?.textContent).toBe('1:00');

    // S2: The Grid
    mounted.update?.({
      colonies: [{ index: 0, stage: 2, stageDwellRemainingS: 120 }],
    });
    expect(container.querySelector('[data-testid="stage-current-label"]')?.textContent).toBe('S2 The Grid');
    expect(container.querySelector('[data-testid="stage-current-teaches"]')?.textContent).toBe(
      'Grid reach, parallel workers, storage, night',
    );
    expect(container.querySelector('[data-testid="stage-segment-S1"]')?.getAttribute('data-state')).toBe('completed');
    expect(container.querySelector('[data-testid="stage-segment-S2"]')?.getAttribute('data-state')).toBe('current');
    expect(container.querySelector('[data-testid="stage-segment-S3"]')?.getAttribute('data-state')).toBe('pending');
    expect(container.querySelector('[data-testid="stage-next-condition"]')?.textContent).toBe(
      '6 buildings + 2nd extractor · 3 min',
    );
    expect(container.querySelector('[data-testid="stage-dwell-countdown"]')?.textContent).toBe('2:00');

    // S3: First Contact
    mounted.update?.({
      colonies: [{ index: 0, stage: 3, stageDwellRemainingS: 0 }],
    });
    expect(container.querySelector('[data-testid="stage-current-label"]')?.textContent).toBe('S3 First Contact');
    expect(container.querySelector('[data-testid="stage-current-teaches"]')?.textContent).toBe(
      'Threat and defense, supply cap',
    );
    expect(container.querySelector('[data-testid="stage-segment-S2"]')?.getAttribute('data-state')).toBe('completed');
    expect(container.querySelector('[data-testid="stage-segment-S3"]')?.getAttribute('data-state')).toBe('current');
    expect(container.querySelector('[data-testid="stage-segment-S4"]')?.getAttribute('data-state')).toBe('pending');
    expect(container.querySelector('[data-testid="stage-dwell-countdown"]')?.textContent).toBe('—');

    mounted.dispose();
  });

  it('supports dwell remaining specified via dwellRemainingTicks (5 ticks per second)', () => {
    const mounted = mountStageTrackHud(container, ctx);
    mounted.update?.({
      colonies: [{ index: 0, stage: 1, dwellRemainingTicks: 250 }], // 250 / 5 = 50s
    });

    expect(container.querySelector('[data-testid="stage-dwell-countdown"]')?.textContent).toBe('0:50');
    mounted.dispose();
  });

  it('handles terminal stage S10 correctly without a next pending stage', () => {
    const mounted = mountStageTrackHud(container, ctx);
    mounted.update?.({
      colonies: [{ index: 0, stage: 10, stageDwellRemainingS: 0 }],
    });

    expect(container.querySelector('[data-testid="stage-current-label"]')?.textContent).toBe('S10 Ascendant');
    expect(container.querySelector('[data-testid="stage-segment-S10"]')?.getAttribute('data-state')).toBe('current');
    for (let i = 0; i < 10; i++) {
      expect(container.querySelector(`[data-testid="stage-segment-S${i}"]`)?.getAttribute('data-state')).toBe(
        'completed',
      );
    }
    expect(container.querySelectorAll('.is-next').length).toBe(0);
    mounted.dispose();
  });
});

describe('W08-12 Wave Gating & Registry', () => {
  it('mountStageTrackHud hides container and skips HUD when W08 flag is disabled', () => {
    const container = document.createElement('div');
    const ctx = makeMockContext('..07'); // W08 disabled
    const mounted = mountStageTrackHud(container, ctx);

    expect(container.hidden).toBe(true);
    expect(container.querySelector('[data-testid="stage-track-hud"]')).toBeNull();
    expect(mounted.hud).toBeUndefined();

    mounted.dispose();
  });

  it('isWaveOn accurately inspects context flags', () => {
    const onCtx = makeMockContext('..08');
    const offCtx = makeMockContext('..07');

    expect(isWaveOn(onCtx)).toBe(true);
    expect(isWaveOn(offCtx)).toBe(false);
  });

  it('loadFeatures excludes stages when W08 flag is off and includes it when W08 is on', () => {
    const flagsWithoutW08 = new Set(parseWaves('..07').list);
    const loadedWithout = loadFeatures({ flags: flagsWithoutW08, host: 'server' });
    expect(loadedWithout.map((f) => f.id)).not.toContain('stages');

    const flagsWithW08 = new Set(parseWaves('..08').list);
    const loadedWith = loadFeatures({ flags: flagsWithW08, host: 'server' });
    expect(loadedWith.map((f) => f.id)).toContain('stages');
  });

  it('feature definition matches requirements', () => {
    expect(defaultFeature.id).toBe('stages');
    expect(defaultFeature.wave).toBe('W08');
    expect(defaultFeature.hud).toHaveLength(1);
    expect(defaultFeature.hud?.[0].id).toBe('stage-track-hud');
    expect(defaultFeature.hud?.[0].slot).toBe('top-left');
    expect(defaultFeature.hud?.[0].order).toBe(15);
  });
});

describe('W08-13 Acceptance Check: Reach S2 and Unlock Reveal Panel', () => {
  let container: HTMLElement;
  let ctx: FeatureContext;

  beforeEach(() => {
    container = document.createElement('div');
    ctx = makeMockContext();
  });

  it('advance stage from 1 to 2 -> toast "S2 The Grid" appears and unlock reveal lists Builder, Pylon, and Depot (plus Capacitor and Fill/Bridge/Dismantle)', () => {
    const mounted = mountStageTrackHud(container, ctx);

    // Initial baseline at stage 1
    mounted.update?.({ colonies: [{ index: 0, stage: 1 }] });
    expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();

    // Advance to stage 2
    mounted.update?.({ colonies: [{ index: 0, stage: 2 }] });

    const toast = container.querySelector('[data-testid="stage-reached-toast"]');
    expect(toast).not.toBeNull();
    expect(container.querySelector('[data-testid="stage-toast-title"]')?.textContent).toBe('S2 The Grid');
    expect(container.querySelector('[data-testid="stage-toast-teaches"]')?.textContent).toContain(
      'Grid reach, parallel workers, storage, night',
    );

    // Unlock Reveal Panel. S2 no longer lists a drone (the T2 worker is a production tier, not a stage unit id).
    expect(container.querySelector('[data-testid="stage-unlock-units"]')?.textContent ?? '').toBe('');
    expectToastUnlocks(container, {
      buildings: ['Pylon', 'Depot', 'Capacitor', 'Wind Turbine', 'Water Extractor', 'Petroleum Well', 'Supply Depot'],
      orders: ['Fill', 'Bridge', 'Dismantle'],
    });

    mounted.dispose();
  });
});

describe('W08-13 Stage Transitions & Safety Overrides', () => {
  let container: HTMLElement;
  let ctx: FeatureContext;

  beforeEach(() => {
    container = document.createElement('div');
    ctx = makeMockContext();
  });

  it('reaching S1 shows "S1 First Light" without override badge', () => {
    const mounted = mountStageTrackHud(container, ctx);

    // Baseline at S0
    mounted.update?.({ colonies: [{ index: 0, stage: 0 }] });
    expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();

    // Advance to S1
    mounted.update?.({ colonies: [{ index: 0, stage: 1 }] });

    expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="stage-toast-title"]')?.textContent).toBe('S1 First Light');
    expect(container.querySelector('[data-testid="stage-toast-teaches"]')?.textContent).toContain(
      'Resources flow, and everything costs energy',
    );
    expect(container.querySelector('[data-testid="stage-toast-override"]')).toBeNull();

    expectToastUnlocks(container, {
      units: ['Worker Drone'],
      buildings: ['Metals Extractor', 'Solar Collector'],
      orders: ['Harvest'],
    });
    expect(container.querySelector('[data-testid="stage-unlock-buildings"]')?.textContent ?? '').not.toContain('Wind');

    mounted.dispose();
  });

  it('reaching S3 with override "fauna" shows "S3 First Contact" and override badge', () => {
    const mounted = mountStageTrackHud(container, ctx);

    // Baseline at S2
    mounted.update?.({ colonies: [{ index: 0, stage: 2 }] });
    expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();

    // Advance to S3 with override 'fauna'
    mounted.update?.({ colonies: [{ index: 0, stage: 3, stageOverride: 'fauna' }] });

    expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="stage-toast-title"]')?.textContent).toBe('S3 First Contact');
    expect(container.querySelector('[data-testid="stage-toast-teaches"]')?.textContent).toContain(
      'Threat and defense, supply cap',
    );

    const overrideBadge = container.querySelector('[data-testid="stage-toast-override"]');
    expect(overrideBadge).not.toBeNull();
    expect(overrideBadge?.textContent).toBe('Safety Override: fauna');

    expectToastUnlocks(container, {
      units: ['Scout', 'Guard'],
      buildings: ['Robotics Factory', 'Turret', 'Thermal Plant'],
      orders: ['Patrol', 'Hold', 'Guard'],
    });

    mounted.dispose();
  });
});

describe('W08-13 Toast Dismiss & Auto-Dismiss Timer', () => {
  let container: HTMLElement;
  let ctx: FeatureContext;

  beforeEach(() => {
    container = document.createElement('div');
    ctx = makeMockContext();
  });

  it('dismiss button hides the toast immediately when clicked', () => {
    const mounted = mountStageTrackHud(container, ctx);

    mounted.hud?.showStageToast(2);
    expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();

    const dismissBtn = container.querySelector('[data-testid="stage-toast-dismiss"]') as HTMLButtonElement | null;
    expect(dismissBtn).not.toBeNull();

    dismissBtn?.click();
    expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();

    mounted.dispose();
  });

  it('auto-dismisses toast after default 30000ms timer', () => {
    vi.useFakeTimers();
    try {
      const mounted = mountStageTrackHud(container, ctx);
      mounted.hud?.showStageToast(1);

      expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();
      vi.advanceTimersByTime(29999);
      expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();

      mounted.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels auto-dismiss timer cleanly on dispose', () => {
    vi.useFakeTimers();
    try {
      const mounted = mountStageTrackHud(container, ctx);
      mounted.hud?.showStageToast(2);
      expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();

      mounted.dispose();
      expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();
      vi.advanceTimersByTime(10000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('W08-13 Transport stageReached Event & Direct API', () => {
  it('shows toast when stageReached event is received over transport.onMessage', () => {
    const container = document.createElement('div');
    const { transport, emit } = makeMockTransport();
    const ctx = makeMockContext('..08', transport);
    const mounted = mountStageTrackHud(container, ctx);

    expect(container.querySelector('[data-testid="stage-reached-toast"]')).toBeNull();

    emit({
      t: 'event',
      d: {
        kind: 'stageReached',
        data: {
          colonyIndex: 0,
          stage: 2,
          title: 'S2 The Grid',
          teaches: 'Grid reach, parallel workers, storage, night',
        },
      },
    });

    expect(container.querySelector('[data-testid="stage-reached-toast"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="stage-toast-title"]')?.textContent).toBe('S2 The Grid');
    expectToastUnlocks(container, {
      buildings: ['Pylon'],
    });
    expect(container.querySelector('[data-testid="stage-unlock-units"]')?.textContent ?? '').toBe('');

    mounted.dispose();
  });

  it('showStageToast module function works with active HUD', () => {
    const container = document.createElement('div');
    const ctx = makeMockContext();
    const mounted = mountStageTrackHud(container, ctx);

    const toastEl = showStageToast(4);
    expect(toastEl).not.toBeNull();
    expect(container.querySelector('[data-testid="stage-toast-title"]')?.textContent).toBe('S4 Neighbor');

    mounted.dispose();
    expect(showStageToast(4)).toBeNull();
  });

  it('formatItemLabel and formatItemList format and deduplicate labels properly', () => {
    expect(formatItemLabel('worker_t2')).toBe('Worker Drone T2');
    expect(formatItemLabel('metalsExtractor')).toBe('Metals Extractor');
    expect(formatItemLabel('solar')).toBe('Solar Collector');
    expect(formatItemLabel('wind')).toBe('Wind Turbine');
    expect(formatItemLabel('custom_building_name')).toBe('Custom building name');

    const formatted = formatItemList(['roboticsFactory', 'robotics_factory', 'turret', 'turret']);
    expect(formatted).toEqual(['Robotics Factory', 'Turret']);
  });
});
