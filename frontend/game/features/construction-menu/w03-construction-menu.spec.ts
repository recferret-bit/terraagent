// @vitest-environment jsdom
import { DEPOSIT, hexCount, hexDistance, hexIndex } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { buildConstructionCatalog } from './catalog';
import { ConstructionMenu } from './ConstructionMenu';
import { evaluatePlacementGhost, planPowerLinePylonSites } from './PlacementGhost';

const W02_FLAGS = new Set(['W00', 'W01', 'W02']);
const W03_FLAGS = new Set(['W00', 'W01', 'W02', 'W03']);

function createPlanetView(radius = 20) {
  const count = hexCount(radius);
  const terrain = new Uint8Array(count);
  const prep = new Uint8Array(count);
  const deposit = new Uint8Array(count);
  const height = new Float32Array(count);
  const owner = new Int8Array(count);

  return {
    radius,
    hIndex: hexIndex(radius),
    view: {
      planet: { id: 'test-w03', type: 'temperate' as const, radius },
      tiles: { count, terrain, prep, deposit, height, owner },
    } as unknown as GameView,
    setTile(q: number, r: number, patch: { terrain?: number; prep?: number; deposit?: number; owner?: number }) {
      const idx = hexIndex(radius).indexOf(q, r);
      if (idx >= 0) {
        if (patch.terrain !== undefined) terrain[idx] = patch.terrain;
        if (patch.prep !== undefined) prep[idx] = patch.prep;
        if (patch.deposit !== undefined) deposit[idx] = patch.deposit;
        if (patch.owner !== undefined) owner[idx] = patch.owner;
      }
    },
  };
}

describe('W03-17 Construction catalog & deposit ghost rules', () => {
  it('includes all 8 W03 grid buildings and the Power Line drag tool when W03 is active, and hides them under ..02', () => {
    const w02Cards = buildConstructionCatalog(W02_FLAGS);
    expect(w02Cards.map((c) => c.building)).toEqual(['commandHub', 'metalsExtractor', 'solar']);

    const w03Cards = buildConstructionCatalog(W03_FLAGS);
    expect(w03Cards.map((c) => c.building)).toEqual([
      'commandHub',
      'metalsExtractor',
      'solar',
      'pylon',
      'capacitor',
      'wind',
      'thermal',
      'supplyDepot',
      'mineralsQuarry',
      'waterExtractor',
      'petroleumWell',
      'powerLine',
    ]);

    const capCard = w03Cards.find((c) => c.building === 'capacitor')!;
    expect(capCard.powerText).toBe('−1.5 E/s · 1500 E');
    const lineCard = w03Cards.find((c) => c.building === 'powerLine')!;
    expect(lineCard.footprintText).toBe('Chain (≤6 span)');
    expect(lineCard.cost).toEqual({ 'metals.t1': 15, 'minerals.t1': 5, 'bio.biomass': 0, 'bio.water': 0 });
  });

  it('validates Minerals Quarry (minerals deposit) and Petroleum Well (oil deposit) on the ghost', () => {
    const { view, setTile, hIndex } = createPlanetView(6);

    const quarryOff = evaluatePlacementGhost({
      building: 'mineralsQuarry',
      q: 1,
      r: 1,
      rotation: 0,
      flags: W03_FLAGS,
      view,
    });
    expect(quarryOff.valid).toBe(false);
    expect(quarryOff.reason).toBe('must cover a minerals deposit');

    setTile(2, 1, { deposit: DEPOSIT.minerals });
    const quarryOn = evaluatePlacementGhost({
      building: 'mineralsQuarry',
      q: 1,
      r: 1,
      rotation: 0,
      flags: W03_FLAGS,
      view,
    });
    expect(quarryOn.valid).toBe(true);
    expect(quarryOn.depositCovered).toBe(true);
    expect(quarryOn.depositTileIndices).toEqual([hIndex.indexOf(2, 1)]);

    const wellOff = evaluatePlacementGhost({
      building: 'petroleumWell',
      q: -2,
      r: 1,
      rotation: 0,
      flags: W03_FLAGS,
      view,
    });
    expect(wellOff.valid).toBe(false);
    expect(wellOff.reason).toBe('must cover an oil deposit');

    setTile(-1, 1, { deposit: DEPOSIT.oil });
    const wellOn = evaluatePlacementGhost({
      building: 'petroleumWell',
      q: -2,
      r: 1,
      rotation: 0,
      flags: W03_FLAGS,
      view,
    });
    expect(wellOn.valid).toBe(true);
    expect(wellOn.depositCovered).toBe(true);
  });
});

describe('W03-17 Power-line drag tool', () => {
  it('dragging across 15 tiles previews 3 auto-spaced pylons (span <= 6) and total cost, and confirm sends placePowerLine', () => {
    const sites = planPowerLinePylonSites({ q: 0, r: 0 }, { q: 15, r: 0 });
    expect(sites).toEqual([
      { q: 5, r: 0 },
      { q: 10, r: 0 },
      { q: 15, r: 0 },
    ]);
    expect(hexDistance(0, 0, sites[0].q, sites[0].r)).toBeLessThanOrEqual(6);
    expect(hexDistance(sites[0].q, sites[0].r, sites[1].q, sites[1].r)).toBeLessThanOrEqual(6);
    expect(hexDistance(sites[1].q, sites[1].r, sites[2].q, sites[2].r)).toBeLessThanOrEqual(6);

    const { view } = createPlanetView(20);
    const parentEl = document.createElement('div');
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = {
      flags: W03_FLAGS,
      host: 'server' as const,
      services: { sendCommand, track: vi.fn() },
    } as unknown as FeatureContext;

    const menu = new ConstructionMenu(parentEl, ctx, view);
    menu.setPowerLineDrag({ q: 0, r: 0 }, { q: 15, r: 0 });

    const ghostState = menu.getGhostState();
    expect(ghostState).not.toBeNull();
    expect(ghostState?.building).toBe('powerLine');
    expect(ghostState?.valid).toBe(true);
    expect(ghostState?.pylonSites).toEqual([
      { q: 5, r: 0 },
      { q: 10, r: 0 },
      { q: 15, r: 0 },
    ]);
    expect(ghostState?.tiles).toHaveLength(3);
    expect(ghostState?.totalCost).toEqual({ 'metals.t1': 45, 'minerals.t1': 15 });
    expect(ghostState?.costText).toBe('Cost: 45 Metals, 15 Minerals (3× Pylon)');
    expect(ghostState?.prepBillText).toContain('Cost: 45 Metals, 15 Minerals (3× Pylon)');

    expect(menu.confirm()).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith('placePowerLine', {
      tiles: [
        { q: 5, r: 0 },
        { q: 10, r: 0 },
        { q: 15, r: 0 },
      ],
      tier: 1,
    });

    menu.dispose();
  });
});
