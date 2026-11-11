// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { mountMapsFeature } from './index';

function createHarness() {
  const container = document.createElement('div');
  const focusedCoords: Array<{ q: number; r: number }> = [];

  const ctx: FeatureContext = {
    flags: new Set(['W04', 'W18']),
    host: 'server',
    services: {
      track: () => {},
      colonyId: 0,
      focusTile: (q: number, r: number) => {
        focusedCoords.push({ q, r });
      },
    } as any,
  };

  const instance = mountMapsFeature(container, ctx);
  return { container, instance, focusedCoords };
}

describe('neighborMarkers integration: discovery and newcomer shield', () => {
  it('handles undiscovered and discovered states with newcomer shield countdown', () => {
    const { container, instance, focusedCoords } = createHarness();
    const strip = container.querySelector<HTMLElement>('[data-testid="neighbor-hud-strip"]');
    const minimap = container.querySelector<HTMLElement>('[data-testid="minimap-neighbor-markers"]');

    // 1. Undiscovered
    instance.update?.({
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active' },
        { index: 1, id: 'col_1', name: 'Beta', status: 'active', raidProtectedUntil: 350, q: 22, r: -14 },
      ],
      blobs: { diplomacy: { contacts: [] } },
    } as any);

    expect(strip?.querySelector('[data-testid="neighbor-marker-col_1"]')).toBeNull();
    expect(minimap?.querySelector('[data-testid="neighbor-marker-col_1"]')).toBeNull();

    // 2. Discovered with newcomer shield active (250 ticks = 50s)
    instance.update?.({
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active' },
        { index: 1, id: 'col_1', name: 'Beta', status: 'active', raidProtectedUntil: 350, q: 22, r: -14 },
      ],
      blobs: { diplomacy: { contacts: [1] } },
    } as any);

    const marker = strip?.querySelector<HTMLElement>('[data-testid="neighbor-marker-col_1"]');
    expect(marker).not.toBeNull();
    expect(marker?.querySelector<HTMLElement>('[data-testid="neighbor-ring"]')?.style.borderColor).toBe('var(--ta-blue)');
    expect(marker?.querySelector<HTMLElement>('[data-testid="neighbor-name"]')?.textContent).toBe('Beta');

    const shield = marker?.querySelector<HTMLElement>('[data-testid="neighbor-shield-badge"]');
    expect(shield?.hidden).toBe(false);
    expect(shield?.textContent).toContain('🛡 00:50');
    expect(marker?.querySelector<HTMLElement>('[data-testid="neighbor-truce-badge"]')?.hidden).toBe(true);

    marker?.click();
    expect(focusedCoords).toContainEqual({ q: 22, r: -14 });
    instance.dispose();
  });
});

describe('neighborMarkers integration: truce transitions and elimination', () => {
  it('transitions from shield to truce, handles truce expiration and elimination', () => {
    const { container, instance } = createHarness();
    const strip = container.querySelector<HTMLElement>('[data-testid="neighbor-hud-strip"]');

    // 1. Shield expired (tick 400 > 350) and active truce signed until tick 700 (60s)
    instance.update?.({
      tick: 400,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active' },
        { index: 1, id: 'col_1', name: 'Beta', status: 'active', raidProtectedUntil: 350, q: 22, r: -14 },
      ],
      blobs: {
        diplomacy: {
          contacts: [1],
          truces: [{ truceId: 'tr_1', colonyA: 0, colonyB: 1, status: 'active', expiresAtTick: 700 }],
        },
      },
    } as any);

    const marker = strip?.querySelector<HTMLElement>('[data-testid="neighbor-marker-col_1"]');
    expect(marker?.querySelector<HTMLElement>('[data-testid="neighbor-shield-badge"]')?.hidden).toBe(true);

    const truce = marker?.querySelector<HTMLElement>('[data-testid="neighbor-truce-badge"]');
    expect(truce?.hidden).toBe(false);
    expect(truce?.textContent).toContain('🕊 01:00');

    // 2. Truce expires (tick 800 > 700)
    instance.update?.({
      tick: 800,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active' },
        { index: 1, id: 'col_1', name: 'Beta', status: 'active', raidProtectedUntil: 350, q: 22, r: -14 },
      ],
      blobs: {
        diplomacy: {
          contacts: [1],
          truces: [{ truceId: 'tr_1', colonyA: 0, colonyB: 1, status: 'ended', expiresAtTick: 700 }],
        },
      },
    } as any);

    const step2Marker = strip?.querySelector<HTMLElement>('[data-testid="neighbor-marker-col_1"]');
    expect(step2Marker?.querySelector<HTMLElement>('[data-testid="neighbor-shield-badge"]')?.hidden).toBe(true);
    expect(step2Marker?.querySelector<HTMLElement>('[data-testid="neighbor-truce-badge"]')?.hidden).toBe(true);

    // 3. Colony eliminated
    instance.update?.({
      tick: 900,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active' },
        { index: 1, id: 'col_1', name: 'Beta', status: 'eliminated', q: 22, r: -14 },
      ],
      blobs: { diplomacy: { contacts: [1] } },
    } as any);

    expect(strip?.querySelector('[data-testid="neighbor-marker-col_1"]')).toBeNull();
    instance.dispose();
  });
});
