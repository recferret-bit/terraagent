// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { MapLayerId } from '@terra/contracts';
import type { ClientTiles } from '../store/replica/viewCodec';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  createNoop2dContext,
  mapScaleForRadius,
} from './rasterCache';
import { renderCompositeMapLayers } from './builtinLayers';
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
