// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEPOSIT_CODES, PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import type { ClientTiles } from '../store/replica/viewCodec';
import { drawResourcesLayer } from './resourceLayer';
import { createNoop2dContext } from './rasterCache';
import type { MapLayerDrawView } from './types';

function view(deposit: Uint8Array, explored: Uint8Array): MapLayerDrawView {
  const radius = 2;
  const count = hexCount(radius);
  const tiles: ClientTiles = {
    count,
    terrain: new Uint8Array(count).fill(TERRAIN_CODES.flat),
    prep: new Uint8Array(count).fill(PREP_CODES.wild),
    height: new Float32Array(count),
    owner: new Int8Array(count).fill(-1),
    explored,
    deposit,
  };
  const hx = hexIndex(radius);
  return {
    width: 100, height: 100, radius, tiles, clientView: null, tilePixelRadius: 5,
    axialToPixel: (q, r) => ({ x: 50 + q * 10 + r * 5, y: 50 + r * 9 }),
    pixelToAxial: () => ({ q: hx.q[0]!, r: hx.r[0]! }),
  };
}

describe('resources map layer', () => {
  it('draws one dot per explored deposit tile and skips fogged or empty tiles', () => {
    const count = hexCount(2);
    const deposit = new Uint8Array(count);
    deposit[1] = DEPOSIT_CODES.metals;
    deposit[2] = DEPOSIT_CODES.oil;
    deposit[3] = DEPOSIT_CODES.minerals;
    const explored = new Uint8Array(count).fill(1);
    explored[3] = 0;
    const ctx = createNoop2dContext(document.createElement('canvas'));
    const arc = vi.spyOn(ctx, 'arc');
    expect(drawResourcesLayer(ctx, view(deposit, explored))).toBe(2);
    expect(arc).toHaveBeenCalledTimes(2);
  });

  it('draws nothing when the client has no deposit layer', () => {
    const v = view(new Uint8Array(hexCount(2)), new Uint8Array(hexCount(2)).fill(1));
    const noDeposit = { ...v, tiles: { ...v.tiles!, deposit: undefined } };
    const ctx = createNoop2dContext(document.createElement('canvas'));
    expect(drawResourcesLayer(ctx, noDeposit)).toBe(0);
  });
});
