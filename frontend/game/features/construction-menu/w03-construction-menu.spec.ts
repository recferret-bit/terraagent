// @vitest-environment jsdom
import { DEPOSIT, ENTITY_KIND, ENTITY_STATE, hexCount, hexIndex, type ViewEntity } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { buildConstructionCatalog } from './catalog';
import { ConstructionMenu } from './ConstructionMenu';
import { evaluatePlacementGhost } from './PlacementGhost';

const W02_FLAGS = new Set(['W00', 'W01', 'W02']);
const W03_FLAGS = new Set(['W00', 'W01', 'W02', 'W03']);

/** A built Command Hub of colony 0 at `(q, r)` as a view entity (its power zone, radius 6, holds the test sites). */
const hubAt = (q: number, r: number): ViewEntity =>
  ({ id: 1, kind: ENTITY_KIND.commandHub, owner: 0, q, r, hp: 1500, hpMax: 1500, state: ENTITY_STATE.idle }) as unknown as ViewEntity;

function createPlanetView(radius = 20, entities: ViewEntity[] = []) {
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
      entities,
      count: entities.length,
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
  it('includes all 8 W03 grid buildings (one Power Pylon card, no separate power-line tool) when W03 is active, and hides them under ..02', () => {
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
      'waterExtractor',
      'petroleumWell',
    ]);

    const capCard = w03Cards.find((c) => c.building === 'capacitor')!;
    expect(capCard.powerText).toBe('−2 E/s · 1500 E');
    const pylonCard = w03Cards.find((c) => c.building === 'pylon')!;
    expect(pylonCard.label).toBe('Power Pylon');
    expect(pylonCard.powerText).toBe('−2.5 E/s'); // grid.pylon.powerDrainPerS
    expect(pylonCard.cost).toEqual({ 'metals.t1': 15, 'minerals.t1': 5, 'bio.biomass': 0, 'bio.water': 0 });
    expect(w03Cards.find((c) => c.building === 'wind')!.powerText).toBe('+12 E/s'); // gross 13 − internal 1
  });

  it('validates Minerals Quarry (minerals deposit) and Petroleum Well (oil deposit) on the ghost', () => {
    const { view, setTile, hIndex } = createPlanetView(6, [hubAt(0, -2)]);

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

describe('Power Pylon placement (Protoss-style power zone)', () => {
  const ghostAt = (view: GameView, building: string, q: number, r: number) =>
    evaluatePlacementGhost({ building, q, r, rotation: 0, flags: W03_FLAGS, view });

  it('rejects a building outside the Hub zone, accepts it inside, and a queued pylon extends the zone', () => {
    const { view } = createPlanetView(20, [hubAt(0, 0)]);
    const out = ghostAt(view, 'solar', 9, 0);
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('outside the power zone');
    expect(ghostAt(view, 'solar', 3, -3).valid).toBe(true);
    expect(ghostAt(view, 'pylon', 6, 0).valid).toBe(true);
    expect(ghostAt(view, 'pylon', 7, 0).valid).toBe(false);

    // a Power Pylon order at (6, 0) (not started yet) already counts: (9, 0) is inside its radius-5 zone
    (view as unknown as { colonies: unknown[] }).colonies = [
      { index: 0, constructionQueue: [{ colonyIndex: 0, state: 'waiting', task: { kind: 'build', building: 'pylon', q: 6, r: 0 } }] },
    ];
    expect(ghostAt(view, 'solar', 9, 0).valid).toBe(true);
  });

  it('the Power Pylon card arms a single-pylon ghost and confirm sends one enqueueTask build order', () => {
    const { view } = createPlanetView(20, [hubAt(0, 0)]);
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = { flags: W03_FLAGS, host: 'server' as const, services: { sendCommand, track: vi.fn() } } as unknown as FeatureContext;
    const menu = new ConstructionMenu(document.createElement('div'), ctx, view);
    menu.startPlacement('pylon');
    menu.setHoverTile(4, -2);
    const ghostState = menu.getGhostState();
    expect(ghostState?.building).toBe('pylon');
    expect(ghostState?.label).toBe('Power Pylon');
    expect(ghostState?.valid).toBe(true);
    expect(ghostState?.tiles).toHaveLength(1);
    expect(menu.confirm()).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith('enqueueTask', { task: { kind: 'build', building: 'pylon', q: 4, r: -2, rotation: 0 } });
    menu.dispose();
  });
});
