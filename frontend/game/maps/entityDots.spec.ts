// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ENTITY_KIND, type ViewEntity } from '@terra/sim';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import {
  ClientTiles,
  ClientView,
  packEntities,
} from '../store/replica/viewCodec';
import type { MapLayerDrawView } from './types';
import {
  BUILDING_SQUARE_PX,
  classifyEntityRole,
  collectEntityDots,
  createUnitsMapLayer,
  drawEntityDots,
  formatHexColor,
  MAX_ENTITY_DOTS,
  resolveCssToken,
  resolveForeignColonyColor,
  unitsMapLayer,
} from './entityDots';

function makeView(overrides?: Partial<MapLayerDrawView>): MapLayerDrawView {
  return {
    width: 256,
    height: 256,
    planetId: 'p_test',
    radius: 10,
    tiles: null,
    clientView: null,
    tilePixelRadius: 4,
    axialToPixel: (q: number, r: number) => ({ x: 128 + q * 10, y: 128 + r * 10 }),
    pixelToAxial: (x: number, y: number) => ({ q: (x - 128) / 10, r: (y - 128) / 10 }),
    ...overrides,
  };
}

function makeEntity(id: number, owner: number, q: number, r: number, extra?: Partial<ViewEntity>): ViewEntity {
  return {
    id,
    kind: 1,
    owner,
    tier: 1,
    q,
    r,
    x: q,
    y: r,
    rot: 0,
    hp: 100,
    hpMax: 100,
    state: 0,
    progress: 0,
    ...extra,
  };
}

describe('W04-07 entity dots spawning and colony colours', () => {
  it('spawns 1 own unit and 1 foreign unit -> 1 orange and 1 colony-colour dot', () => {
    const entities: ViewEntity[] = [
      makeEntity(1, 0, 2, 3),
      makeEntity(2, 1, -1, 4),
    ];
    const clientView: ClientView = {
      tick: 10,
      planet: { id: 'p_test', type: 'temperate', radius: 10 },
      entities: packEntities(entities),
      count: entities.length,
      colonies: [],
    };
    const view = makeView({
      clientView,
      colonyColors: { 1: 0x38bdf8 },
    });

    const dots = collectEntityDots(view);
    expect(dots).toHaveLength(2);

    const ownDot = dots.find((d) => d.id === 1);
    expect(ownDot).toMatchObject({
      id: 1,
      q: 2,
      r: 3,
      x: 148,
      y: 158,
      color: '#FF6B1A',
      role: 'own',
      radiusPx: 2.5,
    });

    const foreignDot = dots.find((d) => d.id === 2);
    expect(foreignDot).toMatchObject({
      id: 2,
      q: -1,
      r: 4,
      x: 118,
      y: 168,
      color: '#38bdf8',
      role: 'foreign',
      radiusPx: 2.5,
    });
  });

  it('drawEntityDots draws on 2D context and returns dots', () => {
    const entities = [makeEntity(10, 0, 0, 0), makeEntity(11, 1, 1, 1)];
    const clientView: ClientView = {
      tick: 1,
      planet: { id: 'p_test', type: 'temperate', radius: 10 },
      entities: packEntities(entities),
      count: entities.length,
      colonies: [],
    };
    const view = makeView({ clientView, colonyColors: { 1: 0x38bdf8 } });

    const styles: string[] = [];
    const arcs: Array<{ x: number; y: number; r: number }> = [];
    const mockCtx = {
      set fillStyle(c: string) { styles.push(c); },
      beginPath: vi.fn(),
      arc: vi.fn((x: number, y: number, r: number) => { arcs.push({ x, y, r }); }),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const drawn = drawEntityDots(mockCtx, view);
    expect(drawn).toHaveLength(2);
    expect(styles).toEqual(['#FF6B1A', '#38bdf8']);
    expect(arcs).toEqual([
      { x: 128, y: 128, r: 2.5 },
      { x: 138, y: 138, r: 2.5 },
    ]);
  });
});

describe('W04-07 fauna and guild classification', () => {
  it('classifies fauna (red #F04848) by owner code and archetype prefix', () => {
    const list: ViewEntity[] = [
      makeEntity(101, -2, 0, 0),
      makeEntity(103, 0, 2, 0, { archetype: 'fauna_crawler' }),
    ];
    const clientView: ClientView = {
      tick: 1,
      planet: { id: 'p_test', type: 'temperate', radius: 10 },
      entities: list as unknown as Float32Array,
      count: list.length,
      colonies: [],
    };
    const view = makeView({ clientView });
    const dots = collectEntityDots(view);
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot.role).toBe('fauna');
      expect(dot.color).toBe('#F04848');
    }
  });

  it('unowned (-1) and other negative owners are neutral steel, not fauna', () => {
    const list: ViewEntity[] = [makeEntity(301, -1, 0, 0), makeEntity(302, -7, 1, 0)];
    const clientView: ClientView = {
      tick: 1,
      planet: { id: 'p_test', type: 'temperate', radius: 10 },
      entities: packEntities(list),
      count: list.length,
      colonies: [],
    };
    const dots = collectEntityDots(makeView({ clientView }));
    expect(dots.map((d) => [d.role, d.color])).toEqual([
      ['neutral', '#8A93A6'],
      ['neutral', '#8A93A6'],
    ]);
    expect(classifyEntityRole(-1, 0)).toBe('neutral');
    expect(classifyEntityRole(-3, 0)).toBe('guild');
    expect(classifyEntityRole(2, 0)).toBe('foreign');
  });

  it('classifies Guild ships (blue #52B4FF) by owner code and archetype names', () => {
    const list: ViewEntity[] = [
      makeEntity(201, -3, 0, 0),
      makeEntity(202, 0, 1, 0, { archetype: 'guild_shuttle' }),
      makeEntity(203, 0, 2, 0, { archetype: 'orbital_freighter' }),
      makeEntity(204, 0, 3, 0, { unit: 'barge' }),
    ];
    const clientView: ClientView = {
      tick: 1,
      planet: { id: 'p_test', type: 'temperate', radius: 10 },
      entities: list as unknown as Float32Array,
      count: list.length,
      colonies: [],
    };
    const view = makeView({ clientView });
    const dots = collectEntityDots(view);
    expect(dots).toHaveLength(4);
    for (const dot of dots) {
      expect(dot.role).toBe('guild');
      expect(dot.color).toBe('#52B4FF');
    }
  });
});

describe('W04-07 dot cap and exploration filtering', () => {
  it('caps collected dots at MAX_ENTITY_DOTS (1500) when given 2000 entities', () => {
    const entities: ViewEntity[] = [];
    for (let i = 0; i < 2000; i++) {
      entities.push(makeEntity(i + 1, 0, (i % 5) - 2, Math.floor(i / 5) - 100));
    }
    const clientView: ClientView = {
      tick: 1,
      planet: { id: 'p_test', type: 'temperate', radius: 10 },
      entities: packEntities(entities),
      count: 2000,
      colonies: [],
    };
    const view = makeView({ clientView });
    const dots = collectEntityDots(view);
    expect(dots.length).toBe(MAX_ENTITY_DOTS);
    expect(dots.length).toBe(1500);
  });

  it('skips entities on unexplored tiles unless own colony', () => {
    const radius = 2;
    const count = hexCount(radius);
    const explored = new Uint8Array(count).fill(0);
    const centerIdx = hexIndex(radius).indexOf(0, 0);
    explored[centerIdx] = 1; // Center tile (0, 0) is explored

    const tiles: ClientTiles = {
      count,
      terrain: new Uint8Array(count),
      prep: new Uint8Array(count),
      height: new Float32Array(count),
      owner: new Int8Array(count),
      explored,
    };

    const entities: ViewEntity[] = [
      makeEntity(1, 1, 0, 0), // foreign on explored tile (0,0) -> visible
      makeEntity(2, 1, 1, 0), // foreign on unexplored tile (1,0) -> skipped
      makeEntity(3, 0, 1, 0), // own on unexplored tile (1,0) -> visible
    ];

    const clientView: ClientView = {
      tick: 1,
      planet: { id: 'p_test', type: 'temperate', radius },
      entities: packEntities(entities),
      count: entities.length,
      colonies: [],
    };
    const view = makeView({ radius, tiles, clientView });
    const dots = collectEntityDots(view);

    expect(dots).toHaveLength(2);
    expect(dots.map((d) => d.id)).toEqual([1, 3]);
  });
});

describe('W04-07 CSS tokens and layer definition', () => {
  it('resolves CSS custom property when present and falls back otherwise', () => {
    expect(resolveCssToken('--ta-orange', '#FF6B1A')).toBe('#FF6B1A');
    document.documentElement.style.setProperty('--ta-orange', '#123456');
    expect(resolveCssToken('--ta-orange', '#FF6B1A')).toBe('#123456');
    document.documentElement.style.removeProperty('--ta-orange');
    expect(resolveCssToken('--ta-orange', '#FF6B1A')).toBe('#FF6B1A');
  });

  it('formats hex numbers and handles ownColonySlot collision avoidance', () => {
    expect(formatHexColor(0x38bdf8)).toBe('#38bdf8');
    expect(formatHexColor('#abcdef')).toBe('#abcdef');

    // Default foreign color for owner 0 when ownColonySlot is 1 avoids colliding with own orange
    const foreignColor0 = resolveForeignColonyColor(0, undefined, 1);
    expect(foreignColor0).toBe('#2ec4b6');

    // Explicit colonyColors takes precedence
    const explicit = resolveForeignColonyColor(1, { 1: 0x38bdf8 }, 0);
    expect(explicit).toBe('#38bdf8');
  });

  it('exposes createUnitsMapLayer and unitsMapLayer singleton conforming to MapLayer', () => {
    const layer = createUnitsMapLayer();
    expect(layer.id).toBe('units');
    expect(layer.label).toBe('Units');
    expect(layer.wave).toBe('W04');
    expect(layer.defaultOn).toBe(true);
    expect(layer.order).toBe(30);
    expect(unitsMapLayer.id).toBe('units');
  });
});

describe('W04 entity markers branch on kind', () => {
  const viewOf = (list: ViewEntity[]) =>
    makeView({
      clientView: {
        tick: 1,
        planet: { id: 'p_test', type: 'temperate', radius: 10 },
        entities: packEntities(list),
        count: list.length,
        colonies: [],
      },
    });

  it('buildings (hub, pylon, capacitor, wind, thermal, depot, quarry, well, pod) are squares drawn before unit dots', () => {
    const K = ENTITY_KIND;
    const list: ViewEntity[] = [
      makeEntity(1, 0, 0, 0, { kind: K.worker, tier: 2 }),
      makeEntity(2, 0, 1, 0, { kind: K.commandHub }),
      makeEntity(3, 0, 2, 0, { kind: K.pylon }),
      makeEntity(4, 0, 3, 0, { kind: K.worker, tier: 1 }),
      ...[K.capacitor, K.wind, K.thermal, K.supplyDepot, K.mineralsQuarry, K.petroleumWell, K.pod].map((kind, i) =>
        makeEntity(10 + i, 1, i, 1, { kind }),
      ),
      makeEntity(5, 0, 0, 2, { kind: K.hq }),
    ];
    const dots = collectEntityDots(viewOf(list));
    const shapes = dots.map((d) => d.shape);
    const firstDot = shapes.indexOf('dot');
    expect(shapes.slice(firstDot).every((s) => s === 'dot')).toBe(true);
    expect(dots.filter((d) => d.shape === 'dot').map((d) => d.id)).toEqual([1, 4, 5]);
    expect(dots.filter((d) => d.shape === 'square')).toHaveLength(9);
    expect(dots.find((d) => d.id === 2)!.radiusPx * 2).toBe(BUILDING_SQUARE_PX.hub);
    expect(dots.find((d) => d.id === 3)!.radiusPx * 2).toBe(BUILDING_SQUARE_PX.small);
    expect(dots.find((d) => d.id === 10)!.radiusPx * 2).toBe(BUILDING_SQUARE_PX.large);

    const calls: string[] = [];
    const mockCtx = {
      set fillStyle(_c: string) {},
      fillRect: vi.fn(() => calls.push('rect')),
      beginPath: vi.fn(),
      arc: vi.fn(() => calls.push('arc')),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawEntityDots(mockCtx, viewOf(list));
    expect(calls).toEqual([...Array(9).fill('rect'), 'arc', 'arc', 'arc']);
  });

  it('keeps units first under MAX_ENTITY_DOTS; buildings fill the rest', () => {
    const list: ViewEntity[] = [];
    for (let i = 0; i < 1000; i++) list.push(makeEntity(i + 1, 0, 0, 0, { kind: ENTITY_KIND.pylon }));
    for (let i = 0; i < 1200; i++) list.push(makeEntity(5000 + i, 0, 0, 0, { kind: ENTITY_KIND.worker, tier: 2 }));
    const dots = collectEntityDots(viewOf(list));
    expect(dots).toHaveLength(MAX_ENTITY_DOTS);
    expect(dots.filter((d) => d.shape === 'dot')).toHaveLength(1200);
    expect(dots.filter((d) => d.shape === 'square')).toHaveLength(MAX_ENTITY_DOTS - 1200);
  });

  it('resolves the role colours from the design tokens once per draw, not once per entity', () => {
    const list: ViewEntity[] = [];
    for (let i = 0; i < 50; i++) list.push(makeEntity(i + 1, 0, 0, 0));
    const spy = vi.spyOn(window, 'getComputedStyle');
    collectEntityDots(viewOf(list));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
