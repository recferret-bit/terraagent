// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createState, ENTITY_KIND, hexIndex, insertRow, setField, setTileOwner, view } from '@terra/sim';
import { packView, unpackView } from '../store/replica/viewCodec';
import { axialToCanvasPixel, PlanetRasterCache } from './rasterCache';
import { drawTerritoryLayer, resolveColonyMapColor } from './builtinLayers';
import { classifyEntityRole, collectEntityDots, OWNER_FAUNA, OWNER_GUILD, OWNER_NONE } from './entityDots';
import type { MapLayerDrawView } from './types';

function makeDrawView(state: ReturnType<typeof createState>, ownColonySlot = 0): MapLayerDrawView {
  const simView = view(state);
  const packed = packView(simView, true);
  const clientView = unpackView(packed.view);
  const size = 256;
  const radius = state.grid.radius;
  return {
    planetId: state.meta.planetId,
    radius,
    width: size,
    height: size,
    tilePixelRadius: 6,
    tiles: clientView.tiles ?? null,
    clientView,
    ownColonySlot,
    colonyColors: {
      128: 0x22c55e,
      2251: 0xa855f7,
    },
    rasterCanvas: null,
    axialToPixel: (q, r) => axialToCanvasPixel(q, r, size, radius),
    pixelToAxial: () => ({ q: 0, r: 0 }),
  };
}

describe('W11-37 · Client replica and raster cache wide-owner identity', () => {
  it('preserves owner indices 128, 512, 2251, 15000 and -1 across packView, unpackView and PlanetRasterCache', () => {
    const state = createState({
      planetId: 'pl_map_wide',
      planetType: 'temperate',
      seed: 'w11-37-map',
      radius: 4,
    });
    const hx = hexIndex(state.grid.radius);
    const i128 = hx.indexOf(0, 0);
    const i512 = hx.indexOf(1, 0);
    const i2251 = hx.indexOf(0, 1);
    const i15000 = hx.indexOf(-1, 1);
    const iUnowned = hx.indexOf(2, 0);

    setTileOwner(state.grid, i128, 128, 1);
    setTileOwner(state.grid, i512, 512, 1);
    setTileOwner(state.grid, i2251, 2251, 1);
    setTileOwner(state.grid, i15000, 15000, 1);

    const packed = packView(view(state), true);
    const unpacked = unpackView(packed.view);
    expect(unpacked.tiles?.owner).toBeInstanceOf(Int16Array);
    expect([
      unpacked.tiles?.owner[i128],
      unpacked.tiles?.owner[i512],
      unpacked.tiles?.owner[i2251],
      unpacked.tiles?.owner[i15000],
      unpacked.tiles?.owner[iUnowned],
    ]).toEqual([128, 512, 2251, 15000, -1]);

    const cache = new PlanetRasterCache();
    const first = cache.update(unpacked.tiles!, { planetId: state.meta.planetId, radius: state.grid.radius });
    expect(first.entry.owner).toBeInstanceOf(Int16Array);
    expect([
      first.entry.owner[i128],
      first.entry.owner[i512],
      first.entry.owner[i2251],
      first.entry.owner[i15000],
      first.entry.owner[iUnowned],
    ]).toEqual([128, 512, 2251, 15000, -1]);

    setTileOwner(state.grid, i128, 2251, 2);
    const unpacked2 = unpackView(packView(view(state), true).view);
    const second = cache.update(unpacked2.tiles!, { planetId: state.meta.planetId, radius: state.grid.radius });
    expect(second.repainted).toBe(1);
    expect(second.entry.owner[i128]).toBe(2251);
  });
});

describe('W11-37 · Map territory borders and entity dots for wide owners', () => {
  it('draws territory borders and entity dots for owners 128 and 2251 without Int8 negative wraparound', () => {
    const state = createState({
      planetId: 'pl_map_territory',
      planetType: 'temperate',
      seed: 'w11-37-territory',
      radius: 4,
    });
    state.grid.layers.explored.fill(0xff);
    const hx = hexIndex(state.grid.radius);
    setTileOwner(state.grid, hx.indexOf(0, 0), 128, 1);
    setTileOwner(state.grid, hx.indexOf(1, 0), 128, 1);
    setTileOwner(state.grid, hx.indexOf(-1, 0), 2251, 1);

    const r0 = insertRow(state.entities, state.meta.nextEntityId++, 1);
    state.entities.cols.kind[r0] = ENTITY_KIND.commandHub;
    state.entities.cols.hp[r0] = 500;
    state.entities.cols.hpMax[r0] = 500;
    setField(state.entities, r0, 'owner', 0, 1);

    const r128 = insertRow(state.entities, state.meta.nextEntityId++, 1);
    state.entities.cols.kind[r128] = ENTITY_KIND.worker;
    state.entities.cols.hp[r128] = 100;
    state.entities.cols.hpMax[r128] = 100;
    setField(state.entities, r128, 'owner', 128, 1);

    const r2251 = insertRow(state.entities, state.meta.nextEntityId++, 1);
    state.entities.cols.kind[r2251] = ENTITY_KIND.commandHub;
    state.entities.cols.hp[r2251] = 500;
    state.entities.cols.hpMax[r2251] = 500;
    setField(state.entities, r2251, 'owner', 2251, 1);

    const drawView = makeDrawView(state, 0);
    const cache = new PlanetRasterCache();
    const { entry } = cache.update(drawView.tiles!, { planetId: state.meta.planetId, radius: state.grid.radius });

    const summary = drawTerritoryLayer(entry.ctx, drawView);
    expect(summary.ownedTileCount).toBe(3);
    expect(summary.borderEdgeCount).toBe(16);
    expect(resolveColonyMapColor(128, 128, drawView.colonyColors)).toBe('#FF6B1A');
    expect(resolveColonyMapColor(128, 0, drawView.colonyColors)).toBe('#22c55e');
    expect(resolveColonyMapColor(2251, 0, drawView.colonyColors)).toBe('#a855f7');

    expect([
      classifyEntityRole(128, 128),
      classifyEntityRole(2251, 128),
      classifyEntityRole(OWNER_NONE, 128),
      classifyEntityRole(OWNER_FAUNA, 128),
      classifyEntityRole(OWNER_GUILD, 128),
    ]).toEqual(['own', 'foreign', 'neutral', 'fauna', 'guild']);

    const dots = collectEntityDots(drawView);
    expect(dots.find((d) => d.id === state.entities.cols.id[r0])?.role).toBe('own');
    expect(dots.find((d) => d.id === state.entities.cols.id[r128])?.role).toBe('foreign');
    expect(dots.find((d) => d.id === state.entities.cols.id[r2251])?.role).toBe('foreign');
  });
});
