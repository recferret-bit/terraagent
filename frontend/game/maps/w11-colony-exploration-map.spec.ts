// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createState, hexIndex, markTileExplored, revealVision, view } from '@terra/sim';
import { colonyVisionSignature, rasterizeColonyVision } from '@terra/render/lighting/colonyVisionRaster';
import { packView, unpackView } from '../store/replica/viewCodec';
import { axialToCanvasPixel, PlanetRasterCache } from './rasterCache';
import { classifyTileState, resolveTileColorFromTokens } from './tileColors';
import { drawMapFog, isMapTileExplored } from './visibility';
import type { MapLayerDrawView } from './types';

function makeDrawView(state: ReturnType<typeof createState>, ownColonySlot: number): MapLayerDrawView {
  const packed = packView(view(state), true);
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
    rasterCanvas: null,
    axialToPixel: (q, r) => axialToCanvasPixel(q, r, size, radius),
    pixelToAxial: () => ({ q: 0, r: 0 }),
  };
}

describe('W11-39 · Client replica, map visibility, tile classification and raster cache for Colony 9 & 2251', () => {
  it('round-trips exploredByColony through packView/unpackView and isolates Colony 0, 1, 9 and 2251 visibility', () => {
    const state = createState({
      planetId: 'pl_map_exp',
      planetType: 'temperate',
      seed: 'w11-39-map',
      radius: 4,
    });
    const hx = hexIndex(state.grid.radius);
    const tile0 = hx.indexOf(0, 0);
    const tile1 = hx.indexOf(1, 0);
    const tile9 = hx.indexOf(0, 1);
    const tile2251 = hx.indexOf(-1, 1);
    const tileUnexplored = hx.indexOf(2, 0);

    markTileExplored(state.grid, tile0, 0, 1);
    markTileExplored(state.grid, tile1, 1, 1);
    markTileExplored(state.grid, tile9, 9, 1);
    markTileExplored(state.grid, tile2251, 2251, 1);

    const view0 = makeDrawView(state, 0);
    const view1 = makeDrawView(state, 1);
    const view9 = makeDrawView(state, 9);
    const view2251 = makeDrawView(state, 2251);

    // Colony 9 sees only tile9, never Colony 0 (tile0) or Colony 1 (tile1) or Colony 2251 (tile2251).
    expect(isMapTileExplored(view9, tile9)).toBe(true);
    expect(isMapTileExplored(view9, tile0)).toBe(false);
    expect(isMapTileExplored(view9, tile1)).toBe(false);
    expect(isMapTileExplored(view9, tile2251)).toBe(false);
    expect(isMapTileExplored(view9, tileUnexplored)).toBe(false);

    expect(classifyTileState(view9.tiles!, tile9, 9)).toBe('flat');
    expect(classifyTileState(view9.tiles!, tile0, 9)).toBe('unexplored');
    expect(classifyTileState(view9.tiles!, tile1, 9)).toBe('unexplored');
    expect(classifyTileState(view9.tiles!, tile2251, 9)).toBe('unexplored');

    // Colony 2251 sees only tile2251.
    expect(isMapTileExplored(view2251, tile2251)).toBe(true);
    expect(isMapTileExplored(view2251, tile9)).toBe(false);
    expect(isMapTileExplored(view2251, tile0)).toBe(false);
    expect(classifyTileState(view2251.tiles!, tile2251, 2251)).toBe('flat');
    expect(classifyTileState(view2251.tiles!, tile9, 2251)).toBe('unexplored');

    // Colonies 0 and 1 see only their respective tiles.
    expect(isMapTileExplored(view0, tile0)).toBe(true);
    expect(isMapTileExplored(view0, tile9)).toBe(false);
    expect(isMapTileExplored(view1, tile1)).toBe(true);
    expect(isMapTileExplored(view1, tile9)).toBe(false);
  });
});

describe('W11-39 · PlanetRasterCache, drawMapFog and colonyVisionRaster for Colony 9 & 2251', () => {
  it('repaints dirty tiles in PlanetRasterCache and draws fog and vision raster for Colony 9 and 2251', () => {
    const state = createState({
      planetId: 'pl_map_raster_exp',
      planetType: 'desert',
      seed: 'w11-39-raster',
      radius: 4,
    });
    const hx = hexIndex(state.grid.radius);
    const center = hx.indexOf(0, 0);
    const nextTile = hx.indexOf(1, 0);

    markTileExplored(state.grid, center, 9, 1);
    const view9A = makeDrawView(state, 9);

    const cache = new PlanetRasterCache((tiles, idx) => resolveTileColorFromTokens(tiles, idx, 9));
    const first = cache.update(view9A.tiles!, { planetId: state.meta.planetId, radius: state.grid.radius });
    expect(first.repainted).toBe(state.grid.count);

    // No-op update repaints 0 tiles.
    const noop = cache.update(view9A.tiles!, { planetId: state.meta.planetId, radius: state.grid.radius });
    expect(noop.repainted).toBe(0);

    // Colony 9 explores 1 additional tile -> PlanetRasterCache detects 1 dirty tile and repaints it.
    markTileExplored(state.grid, nextTile, 9, 2);
    const view9B = makeDrawView(state, 9);
    const second = cache.update(view9B.tiles!, { planetId: state.meta.planetId, radius: state.grid.radius });
    expect(second.repainted).toBe(1);

    // Fog layer uses alpha 0.55 on Colony 9's explored tiles and 0.88 on unexplored tiles.
    const alphas: number[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(function (this: { globalAlpha: number }) {
        alphas.push(this.globalAlpha);
      }),
      fillStyle: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    drawMapFog(ctx, view9B);
    expect(alphas[center]).toBeCloseTo(0.55, 2);
    expect(alphas[nextTile]).toBeCloseTo(0.55, 2);
    expect(alphas[hx.indexOf(-1, 0)]).toBeCloseTo(0.88, 2);

    // 3D colonyVisionRaster remembers explored terrain for Colony 9 without leaking to Colony 2251.
    revealVision(state, 9, 0, 0, 2, 3);
    const tilesAfter = makeDrawView(state, 9).tiles!;
    const px9 = new Uint8Array(32 * 32 * 4);
    const px2251 = new Uint8Array(32 * 32 * 4);
    rasterizeColonyVision(
      { radius: state.grid.radius, colonyIndex: 9, explored: tilesAfter.explored, exploredByColony: tilesAfter.exploredByColony },
      px9,
      32,
    );
    rasterizeColonyVision(
      { radius: state.grid.radius, colonyIndex: 2251, explored: tilesAfter.explored, exploredByColony: tilesAfter.exploredByColony },
      px2251,
      32,
    );
    const midOffset = (16 * 32 + 16) * 4 + 1;
    expect(px9[midOffset]).toBe(255);
    expect(px2251[midOffset]).toBe(0);
    expect(
      colonyVisionSignature({
        radius: state.grid.radius,
        colonyIndex: 9,
        explored: tilesAfter.explored,
        exploredByColony: tilesAfter.exploredByColony,
      }),
    ).not.toBe(
      colonyVisionSignature({
        radius: state.grid.radius,
        colonyIndex: 2251,
        explored: tilesAfter.explored,
        exploredByColony: tilesAfter.exploredByColony,
      }),
    );
  });
});
