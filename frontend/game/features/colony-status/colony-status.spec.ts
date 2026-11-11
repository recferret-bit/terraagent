// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { installMockDocument } from '../test-dom';
import {
  applyColonyStatusSimEvent,
  colonyStatusFeature,
  createColonyStatusHud,
  extractColonyStatusView,
  formatCriticalCountdown,
  mountColonyStatusHud,
  type ColonyStatusView,
} from './index';

function testCtx(flags: readonly string[] = ['W18'], extraServices: Record<string, unknown> = {}): FeatureContext {
  return {
    flags: new Set(flags),
    host: 'server',
    services: {
      track: () => {},
      ...extraServices,
    },
  };
}

describe('colony-status: formatCriticalCountdown', () => {
  it('formats boundary intervals accurately (0, 59, 60, 600)', () => {
    expect(formatCriticalCountdown(0)).toBe('00:00');
    expect(formatCriticalCountdown(59)).toBe('00:59');
    expect(formatCriticalCountdown(60)).toBe('01:00');
    expect(formatCriticalCountdown(600)).toBe('10:00');
  });

  it('handles negative, non-finite, and NaN values gracefully', () => {
    expect(formatCriticalCountdown(-1)).toBe('00:00');
    expect(formatCriticalCountdown(-500)).toBe('00:00');
    expect(formatCriticalCountdown(NaN)).toBe('00:00');
    expect(formatCriticalCountdown(Infinity)).toBe('00:00');
  });
});

describe('colony-status: extractColonyStatusView', () => {
  it('returns default active state on empty or null view', () => {
    const view = extractColonyStatusView(null, 0);
    expect(view).toEqual({
      colonyIndex: 0,
      status: 'active',
      hqDown: false,
      criticalDeadlineTick: null,
      criticalRemainingSeconds: 0,
      eliminatedAtTick: null,
      eliminatedReason: null,
      eliminatedByColonyId: null,
      currentTick: 0,
    });
  });

  it('extracts critical status from criticalDeadlineTick and computes 5 Hz remaining seconds', () => {
    const raw = {
      tick: 100,
      blobs: {
        elimination: {
          value: {
            byColony: {
              0: { colonyIndex: 0, hqDown: true, criticalDeadlineTick: 400 },
            },
          },
        },
      },
    };
    const view = extractColonyStatusView(raw, 0);
    expect(view.status).toBe('critical');
    expect(view.hqDown).toBe(true);
    expect(view.criticalDeadlineTick).toBe(400);
    expect(view.criticalRemainingSeconds).toBe(60);
  });

  it('extracts critical status from explicit status and remainingSeconds', () => {
    const raw = {
      tick: 50,
      colonies: [{ index: 0, status: 'critical', remainingSeconds: 120 }],
    };
    const view = extractColonyStatusView(raw, 0);
    expect(view.status).toBe('critical');
    expect(view.criticalRemainingSeconds).toBe(120);
  });

  it('extracts eliminated status from eliminatedAtTick or status eliminated', () => {
    const raw = {
      tick: 500,
      colonies: [
        {
          index: 1,
          status: 'eliminated',
          eliminatedAtTick: 450,
          eliminatedReason: 'Hub destroyed by bombardment',
          eliminatedByColonyId: 'colony-beta',
        },
      ],
    };
    const view = extractColonyStatusView(raw, 1);
    expect(view.status).toBe('eliminated');
    expect(view.eliminatedAtTick).toBe(450);
    expect(view.eliminatedReason).toBe('Hub destroyed by bombardment');
    expect(view.eliminatedByColonyId).toBe('colony-beta');
    expect(view.criticalRemainingSeconds).toBe(0);
  });
});

describe('colony-status: applyColonyStatusSimEvent', () => {
  const baseState: ColonyStatusView = {
    colonyIndex: 0,
    status: 'active',
    hqDown: false,
    criticalDeadlineTick: null,
    criticalRemainingSeconds: 0,
    eliminatedAtTick: null,
    eliminatedReason: null,
    eliminatedByColonyId: null,
    currentTick: 100,
  };

  it('handles colonyCritical event transitioning to critical state', () => {
    const next = applyColonyStatusSimEvent(baseState, {
      kind: 'colonyCritical',
      colonyIndex: 0,
      atTick: 100,
      deadlineTick: 3100,
      timerS: 600,
    });
    expect(next.status).toBe('critical');
    expect(next.criticalDeadlineTick).toBe(3100);
    expect(next.criticalRemainingSeconds).toBe(600);
    expect(next.hqDown).toBe(true);
  });

  it('handles colonyEliminated event transitioning to eliminated state', () => {
    const criticalState: ColonyStatusView = {
      ...baseState,
      status: 'critical',
      criticalDeadlineTick: 3100,
      criticalRemainingSeconds: 500,
    };
    const next = applyColonyStatusSimEvent(criticalState, {
      kind: 'colonyEliminated',
      colonyIndex: 0,
      atTick: 3105,
      reason: 'rebuild_deadline_expired',
      byColony: 'colony_omega',
    });
    expect(next.status).toBe('eliminated');
    expect(next.criticalRemainingSeconds).toBe(0);
    expect(next.eliminatedAtTick).toBe(3105);
    expect(next.eliminatedReason).toBe('rebuild_deadline_expired');
    expect(next.eliminatedByColonyId).toBe('colony_omega');
  });

  it('handles buildingCompleted commandHub event returning critical colony to active', () => {
    const criticalState: ColonyStatusView = {
      ...baseState,
      status: 'critical',
      criticalDeadlineTick: 3100,
      criticalRemainingSeconds: 500,
      hqDown: true,
    };
    const next = applyColonyStatusSimEvent(criticalState, {
      kind: 'buildingCompleted',
      colonyIndex: 0,
      buildingKind: 'commandHub',
    });
    expect(next.status).toBe('active');
    expect(next.criticalDeadlineTick).toBe(null);
    expect(next.criticalRemainingSeconds).toBe(0);
    expect(next.hqDown).toBe(false);
  });

  it('ignores events intended for other colonies', () => {
    const next = applyColonyStatusSimEvent(baseState, {
      kind: 'colonyCritical',
      colonyIndex: 2,
      deadlineTick: 500,
    });
    expect(next).toBe(baseState);
  });
});

describe('colony-status: critical banner UI', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => { restoreDoc = installMockDocument(); });
  afterEach(() => { restoreDoc?.(); vi.useRealTimers(); });

  it('renders critical banner with exact text and handles Place Hub button click', () => {
    const container = document.createElement('div');
    const onPlaceHub = vi.fn();
    const startHubPlacement = vi.fn();
    const ctx = testCtx(['W18'], { startHubPlacement });

    const hud = createColonyStatusHud(container, ctx, { onPlaceHub });
    const banner = container.querySelector('[data-testid="colony-critical-banner"]') as HTMLElement;
    const eliminated = container.querySelector('[data-testid="colony-eliminated-screen"]') as HTMLElement;
    expect(banner.hidden).toBe(true);
    expect(eliminated.hidden).toBe(true);

    hud.update({
      tick: 0,
      colonies: [{ index: 0, status: 'critical', remainingSeconds: 600 }],
    });

    expect(banner.hidden).toBe(false);
    expect(eliminated.hidden).toBe(true);

    const title = container.querySelector('[data-testid="colony-critical-title"]') as HTMLElement;
    expect(title.textContent).toBe('HUB LOST — REBUILD WITHIN 10:00');

    const placeBtn = container.querySelector('[data-testid="colony-critical-place-hub"]') as HTMLButtonElement;
    expect(placeBtn.textContent).toBe('Place Hub');

    let eventFired = false;
    const onCustomEvent = () => { eventFired = true; };
    window.addEventListener('ta:place-hub', onCustomEvent);

    placeBtn.click();
    expect(onPlaceHub).toHaveBeenCalledTimes(1);
    expect(startHubPlacement).toHaveBeenCalledTimes(1);
    expect(eventFired).toBe(true);

    window.removeEventListener('ta:place-hub', onCustomEvent);
    hud.dispose();
  });
});

describe('colony-status: eliminated screen UI', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => { restoreDoc = installMockDocument(); });
  afterEach(() => { restoreDoc?.(); vi.useRealTimers(); });

  it('renders eliminated screen with title, detail, and handles Found New Colony CTA click', () => {
    const container = document.createElement('div');
    const onFoundNewColony = vi.fn();
    const ctx = testCtx(['W18']);

    const hud = createColonyStatusHud(container, ctx, { onFoundNewColony });
    hud.update({
      tick: 3000,
      colonies: [
        {
          index: 0,
          status: 'eliminated',
          eliminatedReason: 'Hub lost and timer expired',
          eliminatedByColonyId: 'Rival-Colony-42',
        },
      ],
    });

    const banner = container.querySelector('[data-testid="colony-critical-banner"]') as HTMLElement;
    const eliminated = container.querySelector('[data-testid="colony-eliminated-screen"]') as HTMLElement;
    expect(banner.hidden).toBe(true);
    expect(eliminated.hidden).toBe(false);

    const title = container.querySelector('[data-testid="colony-eliminated-title"]') as HTMLElement;
    expect(title.textContent).toBe('COLONY ELIMINATED');

    const detail = container.querySelector('[data-testid="colony-eliminated-detail"]') as HTMLElement;
    expect(detail.textContent).toContain('Rival-Colony-42');

    const ctaBtn = container.querySelector('[data-testid="found-new-colony-btn"]') as HTMLButtonElement;
    expect(ctaBtn.textContent).toBe('Found New Colony');

    let customEventFired = false;
    const onCustomEvent = () => { customEventFired = true; };
    window.addEventListener('ta:found-new-colony', onCustomEvent);

    ctaBtn.click();
    expect(onFoundNewColony).toHaveBeenCalledTimes(1);
    expect(customEventFired).toBe(true);

    window.removeEventListener('ta:found-new-colony', onCustomEvent);
    hud.dispose();
  });
});

describe('colony-status: countdown timer and wave gating', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => { restoreDoc = installMockDocument(); });
  afterEach(() => { restoreDoc?.(); vi.useRealTimers(); });

  it('ticks down remaining seconds in critical state on real-time countdown interval', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const ctx = testCtx(['W18']);
    const hud = createColonyStatusHud(container, ctx);

    hud.update({
      tick: 0,
      colonies: [{ index: 0, status: 'critical', remainingSeconds: 60 }],
    });

    const title = container.querySelector('[data-testid="colony-critical-title"]') as HTMLElement;
    expect(title.textContent).toBe('HUB LOST — REBUILD WITHIN 01:00');

    vi.advanceTimersByTime(1000);
    expect(title.textContent).toBe('HUB LOST — REBUILD WITHIN 00:59');

    vi.advanceTimersByTime(59000);
    expect(title.textContent).toBe('HUB LOST — REBUILD WITHIN 00:00');
    hud.dispose();
  });

  it('respects wave flag gating and registers feature definition', () => {
    const elOff = document.createElement('div');
    const ctxOff = testCtx([]);
    const panelOff = mountColonyStatusHud(elOff, ctxOff);
    expect(elOff.hidden).toBe(true);
    expect(panelOff.hud).toBeUndefined();

    const elOn = document.createElement('div');
    const ctxOn = testCtx(['W18']);
    const panelOn = mountColonyStatusHud(elOn, ctxOn);
    expect(elOn.hidden).toBe(false);
    expect(panelOn.hud).toBeDefined();
    panelOn.dispose();

    expect(colonyStatusFeature.id).toBe('colony-status');
    expect(colonyStatusFeature.wave).toBe('W18');
    expect(colonyStatusFeature.hud?.[0]).toMatchObject({
      id: 'colony-status-hud',
      slot: 'top',
      order: 5,
    });
  });
});
