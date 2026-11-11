// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import {
  COLONY_COLOR_TOKENS,
  extractNeighborColonyMarkers,
  formatCountdownSeconds,
  getColonyColorToken,
  TICKS_PER_SECOND,
} from './neighborMarkers';
import { NeighborHudStrip } from './NeighborHudStrip';
import { mountMapsFeature } from './index';

describe('neighborMarkers: formatting and color tokens', () => {
  it('formats countdown seconds correctly', () => {
    expect(formatCountdownSeconds(0)).toBe('00:00');
    expect(formatCountdownSeconds(-10)).toBe('00:00');
    expect(formatCountdownSeconds(45)).toBe('00:45');
    expect(formatCountdownSeconds(600)).toBe('10:00');
    expect(formatCountdownSeconds(3665)).toBe('01:01:05');
  });

  it('assigns faction plate color tokens per colony index', () => {
    expect(getColonyColorToken(0)).toBe(COLONY_COLOR_TOKENS[0]);
    expect(getColonyColorToken(1)).toBe('var(--ta-blue)');
    expect(getColonyColorToken(2)).toBe('var(--ta-amber)');
    expect(getColonyColorToken(3)).toBe('var(--ta-green)');
    expect(getColonyColorToken(4)).toBe('var(--ta-cyan)');
    expect(getColonyColorToken(5)).toBe('var(--ta-orange)');
  });
});

describe('neighborMarkers: discovery and exclusion rules', () => {
  it('excludes own colony and undiscovered colonies', () => {
    const view = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Own Colony', status: 'active' },
        { index: 1, id: 'col_1', name: 'Hidden Neighbor', status: 'active' },
      ],
      blobs: { diplomacy: { contacts: [] } },
    };
    expect(extractNeighborColonyMarkers(view, 0)).toHaveLength(0);
  });

  it('excludes eliminated colonies even if discovered or in contacts', () => {
    const view = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active' },
        { index: 1, id: 'col_1', name: 'Dead Colony', status: 'eliminated' },
        { index: 2, id: 'col_2', name: 'Ruined Colony', status: 'active', eliminated: true },
      ],
      blobs: { diplomacy: { contacts: [1, 2] } },
    };
    expect(extractNeighborColonyMarkers(view, 0)).toHaveLength(0);
  });

  it('discovers neighbor via contacts, discoveredColonies, discovered flag, or spotted entities', () => {
    const view = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha', status: 'active', discoveredColonies: [2] },
        { index: 1, id: 'col_1', name: 'Bravo', status: 'active' },
        { index: 2, id: 'col_2', name: 'Charlie', status: 'active' },
        { index: 3, id: 'col_3', name: 'Delta', status: 'active', discovered: true },
        { index: 4, id: 'col_4', name: 'Echo', status: 'active' },
      ],
      blobs: { diplomacy: { contacts: [1] } },
      entities: [{ id: 10, colony: 4, kind: 'hub', q: 12, r: -8 }],
    };

    const markers = extractNeighborColonyMarkers(view, 0);
    expect(markers.map((m) => m.colonyIndex)).toEqual([1, 2, 3, 4]);
    expect(markers.find((m) => m.colonyIndex === 4)?.q).toBe(12);
    expect(markers.find((m) => m.colonyIndex === 4)?.r).toBe(-8);
  });
});

describe('neighborMarkers: shield and truce calculations', () => {
  it('computes newcomer shield: active when raidProtectedUntil > currentTick, inactive at boundary', () => {
    const currentTick = 1000;
    const view = {
      tick: currentTick,
      colonies: [
        { index: 0, id: 'col_0', status: 'active' },
        { index: 1, id: 'col_1', name: 'Shielded', status: 'active', raidProtectedUntil: 1200, discovered: true },
        { index: 2, id: 'col_2', name: 'Boundary', status: 'active', raidProtectedUntil: 1000, discovered: true },
        { index: 3, id: 'col_3', name: 'Expired', status: 'active', raidProtectedUntil: 800, discovered: true },
      ],
    };

    const markers = extractNeighborColonyMarkers(view, 0);
    const m1 = markers.find((m) => m.colonyIndex === 1);
    expect(m1?.shieldActive).toBe(true);
    expect(m1?.shieldRemainingSeconds).toBe(Math.ceil(200 / TICKS_PER_SECOND));

    const m2 = markers.find((m) => m.colonyIndex === 2);
    expect(m2?.shieldActive).toBe(false);
    expect(m2?.shieldRemainingSeconds).toBe(0);

    const m3 = markers.find((m) => m.colonyIndex === 3);
    expect(m3?.shieldActive).toBe(false);
    expect(m3?.shieldRemainingSeconds).toBe(0);
  });

  it('computes truce state: active / notice vs ended / expired', () => {
    const currentTick = 500;
    const view = {
      tick: currentTick,
      colonies: [
        { index: 0, id: 'col_0', status: 'active' },
        { index: 1, id: 'col_1', name: 'T1', status: 'active', discovered: true },
        { index: 2, id: 'col_2', name: 'T2', status: 'active', discovered: true },
        { index: 3, id: 'col_3', name: 'T3', status: 'active', discovered: true },
        { index: 4, id: 'col_4', name: 'T4', status: 'active', discovered: true },
      ],
      blobs: {
        diplomacy: {
          truces: [
            { truceId: 't1', colonyA: 0, colonyB: 1, status: 'active', expiresAtTick: 1000 },
            { truceId: 't2', colonyA: 2, colonyB: 0, status: 'notice', expiresAtTick: 1200, noticeEndsAtTick: 650 },
            { truceId: 't3', colonyA: 0, colonyB: 3, status: 'active', expiresAtTick: 400 },
            { truceId: 't4', colonyA: 1, colonyB: 4, status: 'active', expiresAtTick: 2000 },
          ],
        },
      },
    };

    const markers = extractNeighborColonyMarkers(view, 0);
    const m1 = markers.find((m) => m.colonyIndex === 1);
    expect(m1?.truceActive).toBe(true);
    expect(m1?.truceRemainingSeconds).toBe(Math.ceil((1000 - 500) / TICKS_PER_SECOND));

    const m2 = markers.find((m) => m.colonyIndex === 2);
    expect(m2?.truceActive).toBe(true);
    expect(m2?.truceRemainingSeconds).toBe(Math.ceil((650 - 500) / TICKS_PER_SECOND));

    expect(markers.find((m) => m.colonyIndex === 3)?.truceActive).toBe(false);
    expect(markers.find((m) => m.colonyIndex === 4)?.truceActive).toBe(false);
  });
});

describe('neighborMarkers: DOM rendering and interactions', () => {
  it('renders NeighborHudStrip items with colored rings, shield badges, truce badges, and click pan', () => {
    const container = document.createElement('div');
    const panToTileMock = vi.fn();
    const ctx: FeatureContext = {
      flags: new Set(['W18']),
      host: 'server',
      services: {
        track: () => {},
        colonyId: 0,
        maps: { panToTile: panToTileMock } as any,
      },
    };

    const hud = new NeighborHudStrip({ container, ctx });
    const view = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Alpha' },
        { index: 1, id: 'col_1', name: 'Bravo', discovered: true, q: 15, r: -7, raidProtectedUntil: 250 },
        { index: 2, id: 'col_2', name: 'Charlie', discovered: true, q: -5, r: 20, raidProtectedUntil: 80 },
      ],
      blobs: {
        diplomacy: {
          truces: [{ truceId: 'tr_2', colonyA: 0, colonyB: 2, status: 'active', expiresAtTick: 300 }],
        },
      },
    };

    hud.update(view);

    const strip = container.querySelector<HTMLElement>('[data-testid="neighbor-hud-strip"]');
    const markerCol1 = strip?.querySelector<HTMLElement>('[data-testid="neighbor-marker-col_1"]');
    expect(markerCol1?.querySelector<HTMLElement>('[data-testid="neighbor-ring"]')?.style.borderColor).toBe('var(--ta-blue)');
    expect(markerCol1?.querySelector<HTMLElement>('[data-testid="neighbor-name"]')?.textContent).toBe('Bravo');

    const shieldCol1 = markerCol1?.querySelector<HTMLElement>('[data-testid="neighbor-shield-badge"]');
    expect(shieldCol1?.hidden).toBe(false);
    expect(shieldCol1?.textContent).toContain('🛡 00:30');

    const truceCol1 = markerCol1?.querySelector<HTMLElement>('[data-testid="neighbor-truce-badge"]');
    expect(truceCol1?.hidden).toBe(true);

    const markerCol2 = strip?.querySelector<HTMLElement>('[data-testid="neighbor-marker-col_2"]');
    expect(markerCol2?.querySelector<HTMLElement>('[data-testid="neighbor-shield-badge"]')?.hidden).toBe(true);
    expect(markerCol2?.querySelector<HTMLElement>('[data-testid="neighbor-truce-badge"]')?.hidden).toBe(false);

    markerCol1?.click();
    expect(panToTileMock).toHaveBeenCalledWith(15, -7);

    hud.dispose();
    expect(container.querySelector('[data-testid="neighbor-hud-strip"]')).toBeNull();
  });
});

describe('neighborMarkers: wave flag gating', () => {
  it('W18 wave flag disabled does not render neighbor HUD strip or minimap markers', () => {
    const el = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W04']),
      host: 'server',
      services: { track: () => {}, colonyId: 0 } as any,
    };

    const instance = mountMapsFeature(el, ctx);
    instance.update?.({
      tick: 100,
      colonies: [{ index: 0, id: 'col_0' }, { index: 1, id: 'col_1', name: 'Bravo', discovered: true }],
    } as any);

    expect(el.querySelector('[data-testid="neighbor-hud-strip"]')).toBeNull();
    expect(el.querySelector('[data-testid="minimap-neighbor-markers"]')).toBeNull();
    instance.dispose();
  });
});
