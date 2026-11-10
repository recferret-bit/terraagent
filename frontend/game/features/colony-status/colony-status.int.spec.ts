// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { installMockDocument } from '../test-dom';
import {
  mountColonyStatusHud,
  type ColonyStatusHudOptions,
} from './index';

interface MockStore {
  latest?: any;
  onView(fn: (v: any) => void): () => void;
  onServerEvents(fn: (evs: readonly any[]) => void): () => void;
  emitView(view: any): void;
  emitEvents(events: readonly any[]): void;
}

function createIntegrationHarness(flags = ['W18'], ownColony = 0, options: Partial<ColonyStatusHudOptions> = {}) {
  let viewListener: ((v: any) => void) | null = null;
  let serverEventsListener: ((evs: readonly any[]) => void) | null = null;

  const store: MockStore = {
    latest: {
      tick: 100,
      colonies: [{ index: ownColony, id: `col_${ownColony}`, status: 'active', hqDown: false }],
    },
    onView(fn) {
      viewListener = fn;
      return () => { if (viewListener === fn) viewListener = null; };
    },
    onServerEvents(fn) {
      serverEventsListener = fn;
      return () => { if (serverEventsListener === fn) serverEventsListener = null; };
    },
    emitView(view) { store.latest = view; viewListener?.(view); },
    emitEvents(events) { serverEventsListener?.(events); },
  };

  const startHubPlacement = vi.fn();
  const onPlaceHub = options.onPlaceHub ?? vi.fn();
  const onFoundNewColony = options.onFoundNewColony ?? vi.fn();
  const navigate = options.navigate ?? vi.fn();

  const ctx: FeatureContext = {
    flags: new Set(flags),
    host: 'server',
    services: {
      track: () => {},
      store: store as any,
      startHubPlacement,
      colonyId: ownColony,
    },
  };

  const el = document.createElement('div');
  const panel = mountColonyStatusHud(el, ctx, {
    ownColonyIndex: ownColony,
    onPlaceHub,
    onFoundNewColony,
    navigate,
    ...options,
  });

  return { el, panel, store, ctx, startHubPlacement, onPlaceHub, onFoundNewColony, navigate };
}

describe('colony-status integration: critical transition and rebuild flow', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => { restoreDoc = installMockDocument(); });
  afterEach(() => { restoreDoc?.(); });

  it('transitions active -> critical upon hub loss and hides banner upon hub rebuild', () => {
    const harness = createIntegrationHarness();
    const { el, store, panel, startHubPlacement, onPlaceHub } = harness;

    const banner = el.querySelector('[data-testid="colony-critical-banner"]') as HTMLElement;
    const eliminated = el.querySelector('[data-testid="colony-eliminated-screen"]') as HTMLElement;
    const title = el.querySelector('[data-testid="colony-critical-title"]') as HTMLElement;
    const placeBtn = el.querySelector('[data-testid="colony-critical-place-hub"]') as HTMLButtonElement;

    expect(banner.hidden).toBe(true);
    expect(eliminated.hidden).toBe(true);

    store.emitEvents([{
      kind: 'colonyCritical',
      colonyIndex: 0,
      atTick: 100,
      deadlineTick: 3100,
      timerS: 600,
    }]);

    expect(banner.hidden).toBe(false);
    expect(eliminated.hidden).toBe(true);
    expect(title.textContent).toBe('HUB LOST — REBUILD WITHIN 10:00');

    placeBtn.click();
    expect(onPlaceHub).toHaveBeenCalledTimes(1);
    expect(startHubPlacement).toHaveBeenCalledTimes(1);

    store.emitEvents([{
      kind: 'buildingCompleted',
      colonyIndex: 0,
      buildingKind: 'commandHub',
    }]);

    expect(banner.hidden).toBe(true);
    expect(eliminated.hidden).toBe(true);
    panel.dispose();
  });
});

describe('colony-status integration: elimination and multi-colony isolation', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => { restoreDoc = installMockDocument(); });
  afterEach(() => { restoreDoc?.(); });

  it('transitions to eliminated screen upon timeout and handles Found New Colony CTA', () => {
    const harness = createIntegrationHarness();
    const { el, store, panel, onFoundNewColony, navigate } = harness;

    const banner = el.querySelector('[data-testid="colony-critical-banner"]') as HTMLElement;
    const eliminated = el.querySelector('[data-testid="colony-eliminated-screen"]') as HTMLElement;
    const elimTitle = el.querySelector('[data-testid="colony-eliminated-title"]') as HTMLElement;
    const elimDetail = el.querySelector('[data-testid="colony-eliminated-detail"]') as HTMLElement;
    const foundNewColonyBtn = el.querySelector('[data-testid="found-new-colony-btn"]') as HTMLButtonElement;

    store.emitEvents([
      { kind: 'colonyCritical', colonyIndex: 0, atTick: 5000, timerS: 600 },
      { kind: 'colonyEliminated', colonyIndex: 0, atTick: 8005, cause: 'rebuild_deadline_expired', byColony: 'pirate_cove' },
    ]);

    expect(banner.hidden).toBe(true);
    expect(eliminated.hidden).toBe(false);
    expect(elimTitle.textContent).toBe('COLONY ELIMINATED');
    expect(elimDetail.textContent).toContain('pirate_cove');

    foundNewColonyBtn.click();
    expect(onFoundNewColony).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/play.html');

    panel.dispose();
  });

  it('updates state reactively via store.onView and isolates rival colony events', () => {
    const harness = createIntegrationHarness(['W18'], 0);
    const { el, store, panel } = harness;

    const banner = el.querySelector('[data-testid="colony-critical-banner"]') as HTMLElement;
    const eliminated = el.querySelector('[data-testid="colony-eliminated-screen"]') as HTMLElement;
    const title = el.querySelector('[data-testid="colony-critical-title"]') as HTMLElement;

    store.emitView({
      tick: 200,
      blobs: {
        elimination: {
          value: {
            byColony: {
              0: { colonyIndex: 0, hqDown: true, criticalDeadlineTick: 350 },
            },
          },
        },
      },
    });

    expect(banner.hidden).toBe(false);
    expect(eliminated.hidden).toBe(true);
    expect(title.textContent).toBe('HUB LOST — REBUILD WITHIN 00:30');

    store.emitEvents([
      { kind: 'colonyCritical', colonyIndex: 1, timerS: 300 },
      { kind: 'colonyEliminated', colonyIndex: 1, reason: 'annihilation' },
    ]);

    // Local colony 0 is still in critical state (00:30) and not eliminated
    expect(banner.hidden).toBe(false);
    expect(eliminated.hidden).toBe(true);

    panel.dispose();
  });
});
