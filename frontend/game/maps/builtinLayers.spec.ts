// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { MapLayerId } from '@terra/contracts';
import { packEntities, type ClientTiles, type ClientView } from '../store/replica/viewCodec';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  createNoop2dContext,
  mapScaleForRadius,
} from './rasterCache';
import { drawTerritoryLayer, renderCompositeMapLayers } from './builtinLayers';
import { drawRadarCoverageLayer } from './radarLayer';
import type { MapLayerDrawView } from './types';

function makeTilesWithTerritory(radius: number): ClientTiles {
  const count = hexCount(radius);
  const hx = hexIndex(radius);
  const owner = new Int8Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    if (Math.abs(hx.q[i]!) <= 1 && Math.abs(hx.r[i]!) <= 1 && Math.abs(hx.q[i]! + hx.r[i]!) <= 1) {
      owner[i] = 0;
    }
  }
  return {
    count,
    terrain: new Uint8Array(count).fill(TERRAIN_CODES.forest),
    prep: new Uint8Array(count).fill(PREP_CODES.wild),
    height: new Float32Array(count),
    owner,
    explored: new Uint8Array(count).fill(1),
  };
}

describe('W04-16 Built-in layers Territory, Terrain, Units', () => {
  it('draws territory borders over a flat background when Terrain is toggled off and Territory is on', () => {
    const radius = 4;
    const size = 256;
    const tiles = makeTilesWithTerritory(radius);
    const canvas = document.createElement('canvas');
    const ctx = createNoop2dContext(canvas);
    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
    const strokeSpy = vi.spyOn(ctx, 'stroke');

    const scale = mapScaleForRadius(size, radius);
    const view: MapLayerDrawView = {
      width: size,
      height: size,
      radius,
      tiles,
      clientView: null,
      ownColonySlot: 0,
      axialToPixel: (q, r) => axialToCanvasPixel(q, r, size, radius),
      pixelToAxial: (x, y) => canvasPixelToAxial(x, y, size, radius),
      tilePixelRadius: scale / Math.sqrt(3),
      rasterCanvas: canvas,
    };

    // Toggle Terrain off and Territory on
    const active = new Set<MapLayerId>(['territory']);
    const result = renderCompositeMapLayers(ctx, view, active);

    expect(result.drewFlatBackground).toBe(true);
    expect(result.drawnLayers).toEqual(['territory']);
    expect(result.territory.ownedTileCount).toBe(7);
    expect(result.territory.borderEdgeCount).toBe(18);
    // Terrain off must not paint an opaque square over the whole map
    expect(fillRectSpy).not.toHaveBeenCalledWith(0, 0, size, size);
    expect(strokeSpy).toHaveBeenCalledTimes(18);
  });
});

describe('territory FoW gating & Sensor Array radar overlay', () => {
  it('hides explored foreign territory outside live FoV while keeping own territory', () => {
    const radius = 6;
    const tiles = makeTilesWithTerritory(radius);
    const hx = hexIndex(radius);
    const foreignCenter = hx.indexOf(4, 0);
    tiles.owner[foreignCenter] = 1;
    tiles.explored!.fill(0xff);

    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = createNoop2dContext(canvas);
    const clientView: ClientView = {
      tick: 5,
      planet: { id: 'fow', type: 'temperate', radius },
      colonies: [],
      count: 1,
      entities: packEntities([
        { id: 1, kind: ENTITY_KIND.commandHub, owner: 0, tier: 1, q: 0, r: 0, x: 0, y: 0, rot: 0, hp: 1000, hpMax: 1000, state: ENTITY_STATE.active, progress: 1 },
      ]),
      blobs: { combatVision: { byColony: { 0: [hx.indexOf(0, 0)] } } },
    };

    const summary = drawTerritoryLayer(ctx, {
      width: 200,
      height: 200,
      radius,
      tiles,
      clientView,
      ownColonySlot: 0,
      axialToPixel: (q, r) => axialToCanvasPixel(q, r, 200, radius),
      pixelToAxial: (x, y) => canvasPixelToAxial(x, y, 200, radius),
      tilePixelRadius: mapScaleForRadius(200, radius) / Math.sqrt(3),
    });

    // Only own 7 tiles are rendered; foreign tile outside live sight is omitted
    expect(summary.ownedTileCount).toBe(7);
  });

  it('draws Sensor Array radar coverage circles only for active powered arrays', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = createNoop2dContext(canvas);
    const arcSpy = vi.spyOn(ctx, 'arc');
    const makeRadarView = (state: number, blobs?: Record<string, unknown>): MapLayerDrawView => ({
      width: 256,
      height: 256,
      radius: 30,
      tiles: null,
      ownColonySlot: 0,
      axialToPixel: (q, r) => axialToCanvasPixel(q, r, 256, 30),
      pixelToAxial: (x, y) => canvasPixelToAxial(x, y, 256, 30),
      tilePixelRadius: mapScaleForRadius(256, 30) / Math.sqrt(3),
      clientView: {
        tick: 10,
        planet: { id: 'radar-map', type: 'temperate', radius: 30 },
        colonies: [],
        count: 1,
        entities: packEntities([
          { id: 7, kind: ENTITY_KIND.sensorArray, owner: 0, tier: 1, q: 2, r: -1, x: 2, y: -1, rot: 0, hp: 420, hpMax: 420, state, progress: 1 },
        ]),
        ...(blobs ? { blobs } : {}),
      },
    });

    const activeArrays = drawRadarCoverageLayer(ctx, makeRadarView(ENTITY_STATE.active));
    expect(activeArrays).toHaveLength(1);
    expect(activeArrays[0]!.radiusTiles).toBe(24);
    expect(arcSpy).toHaveBeenCalled();

    arcSpy.mockClear();
    expect(drawRadarCoverageLayer(ctx, makeRadarView(ENTITY_STATE.offlineBrownout))).toHaveLength(0);
    expect(arcSpy).not.toHaveBeenCalled();

    const powerOffline = { power: { byColony: { 0: { entityPower: { 7: { state: 'offline', component: 0 } } } } } };
    expect(drawRadarCoverageLayer(ctx, makeRadarView(ENTITY_STATE.active, powerOffline))).toHaveLength(0);
    expect(arcSpy).not.toHaveBeenCalled();
  });
});
