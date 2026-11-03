// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createMapLayerRegistry } from './layerRegistry';
import { GlobalMapOverlay } from './GlobalMapOverlay';
import {
  MapLayerChipController,
  registerAllCatalogMapLayers,
} from './layerChipsState';

describe('W04-15 Layer registry plus chips and localStorage persistence', () => {
  it('with TA_WAVES=..04 shows only Territory, Terrain and Units chips while Market, Threats and Walls are absent', () => {
    const registry = createMapLayerRegistry();
    const cleanup = registerAllCatalogMapLayers(registry);
    const flags = new Set<string>(parseWaves('..04').list);

    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };

    const ctrl = new MapLayerChipController({
      registry,
      getFlags: () => flags,
      storage: mockStorage,
    });

    const parent = document.createElement('div');
    const overlay = new GlobalMapOverlay({
      parent,
      onChipToggle: (id, active) => {
        ctrl.setLayerActive(id, active);
        overlay.renderChips(ctrl.getVisibleLayers(), ctrl.getActiveSet());
      },
    });
    overlay.renderChips(ctrl.getVisibleLayers(), ctrl.getActiveSet());

    const chips = Array.from(overlay.chipBarEl.querySelectorAll<HTMLElement>('[data-layer]'));
    expect(chips.map((c) => c.dataset.layer)).toEqual(['territory', 'terrain', 'units']);
    expect(chips.map((c) => c.textContent)).toEqual(['Territory', 'Terrain', 'Units']);

    expect(overlay.chipBarEl.querySelector('[data-layer="market"]')).toBeNull();
    expect(overlay.chipBarEl.querySelector('[data-layer="threats"]')).toBeNull();
    expect(overlay.chipBarEl.querySelector('[data-layer="walls"]')).toBeNull();

    // Toggling Terrain off persists in storage and updates chip state
    const terrainChip = overlay.chipBarEl.querySelector<HTMLButtonElement>('[data-layer="terrain"]')!;
    expect(terrainChip.dataset.active).toBe('true');
    terrainChip.click();
    expect(ctrl.isLayerActive('terrain')).toBe(false);

    // Reloading controller from same storage restores terrain = false
    const ctrl2 = new MapLayerChipController({
      registry,
      getFlags: () => flags,
      storage: mockStorage,
    });
    expect(ctrl2.isLayerActive('terrain')).toBe(false);
    expect(ctrl2.isLayerActive('territory')).toBe(true);

    overlay.dispose();
    cleanup();
  });

  it('survives throwing localStorage (try/catch)', () => {
    const registry = createMapLayerRegistry();
    registerAllCatalogMapLayers(registry);
    const flags = new Set<string>(parseWaves('..04').list);
    const throwingStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const onChange = vi.fn();
    const ctrl = new MapLayerChipController({
      registry,
      getFlags: () => flags,
      storage: throwingStorage,
      onChange,
    });
    expect(() => ctrl.toggleLayer('terrain', false)).not.toThrow();
    expect(ctrl.isLayerActive('terrain')).toBe(false);
    expect(onChange).toHaveBeenCalledWith(['territory', 'units']);
  });
});
