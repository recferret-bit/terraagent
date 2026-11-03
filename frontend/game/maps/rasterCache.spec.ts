// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { parseWaves } from '@terra/contracts';
import type { ClientTiles } from '../store/replica/viewCodec';
import type { FeatureContext } from '../core/registry/types';
import { mountMapsFeature } from '../features/maps';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  PlanetRasterCache,
} from './rasterCache';

function makeTestTiles(radius: number): ClientTiles {
  const count = hexCount(radius);
  return {
    count,
    terrain: new Uint8Array(count).fill(TERRAIN_CODES.flat),
    prep: new Uint8Array(count).fill(PREP_CODES.wild),
    height: new Float32Array(count),
    owner: new Int8Array(count).fill(-1),
    explored: new Uint8Array(count).fill(1),
  };
}

describe('W04-03 PlanetRasterCache dirty tile repaints', () => {
  it('maintains one offscreen canvas per planet and repaints only dirty tiles on delta', () => {
    const cache = new PlanetRasterCache();
    const radius = 5;
    const tiles = makeTestTiles(radius);

    const first = cache.update(tiles, { planetId: 'pl_a', radius });
    expect(first.repainted).toBe(tiles.count);
    expect(cache.dirtyTiles).toBe(tiles.count);

    // Change 1 tile's prep state -> dirtyTiles shows 1 (not the whole grid)
    tiles.prep[12] = PREP_CODES.prepared;
    const second = cache.update(tiles, { planetId: 'pl_a', radius });
    expect(second.repainted).toBe(1);
    expect(cache.dirtyTiles).toBe(1);
    expect(second.entry.canvas).toBe(first.entry.canvas);

    // No-op update keeps dirtyTiles at 1 and repaints 0 tiles
    const third = cache.update(tiles, { planetId: 'pl_a', radius });
    expect(third.repainted).toBe(0);
    expect(cache.dirtyTiles).toBe(1);

    // Second planet gets its own offscreen canvas
    const otherTiles = makeTestTiles(radius);
    const other = cache.update(otherTiles, { planetId: 'pl_b', radius });
    expect(other.entry.canvas).not.toBe(first.entry.canvas);
  });

  it('exposes minimap.dirtyTiles = 1 through maps feature service when 1 tile changes', () => {
    const flags = new Set<string>(parseWaves('..04').list);
    const ctx = { flags, host: 'server', services: {} } as unknown as FeatureContext;
    const el = document.createElement('div');
    const panel = mountMapsFeature(el, ctx);

    const radius = 4;
    const tiles = makeTestTiles(radius);
    panel.update?.({ planet: { id: 'pl_1', type: 'temperate', radius }, tiles });
    expect(ctx.services.maps?.stats.dirtyTiles).toBe(tiles.count);

    // Mutate 1 tile
    tiles.prep[5] = PREP_CODES.living;
    panel.update?.({ planet: { id: 'pl_1', type: 'temperate', radius }, tiles });
    expect(ctx.services.maps?.stats.dirtyTiles).toBe(1);

    panel.dispose();
  });

  it('round-trips axial (q, r) and canvas pixel coordinates', () => {
    const radius = 8;
    const size = 256;
    const hx = hexIndex(radius);
    for (let i = 0; i < hx.count; i += 7) {
      const q = hx.q[i]!;
      const r = hx.r[i]!;
      const pt = axialToCanvasPixel(q, r, size, radius);
      const back = canvasPixelToAxial(pt.x, pt.y, size, radius);
      expect(back).toEqual({ q, r });
    }
  });
});
