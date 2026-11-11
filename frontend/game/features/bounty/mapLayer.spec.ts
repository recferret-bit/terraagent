// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMapLayerRegistry } from '../../maps/layerRegistry';
import type { MapLayerDrawView } from '../../maps/types';
import { bountyMapMarkers, drawBountyMarkers, registerBountyMapLayer } from './mapLayer';

const clearNest = {
  bounties: [
    {
      id: 'bt_1',
      state: 'open',
      target: { kind: 'clear_nest', nestId: '7' },
      reward: { resource: 'metals.t1', amount: 200 },
    },
  ],
};

function textsOf(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = {
    save() {},
    restore() {},
    strokeText() {},
    fillText(text: string) {
      texts.push(String(text));
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

function viewOf(source: unknown, hive: boolean): MapLayerDrawView {
  return {
    width: 64,
    height: 64,
    radius: 4,
    tiles: null,
    clientView: {
      tick: 1,
      planet: { id: 'pl', type: 'temperate', radius: 4 },
      entities: new Float32Array(),
      count: 0,
      colonies: [],
      blobs: {
        bounty: source,
        ...(hive ? { faunaHives: { hivesById: { '7': { q: 3, r: -1, hiveId: 7 } } } } : {}),
      },
    },
    axialToPixel: (q, r) => ({ x: q * 8, y: r * 8 }),
    pixelToAxial: (x, y) => ({ q: x, r: y }),
    tilePixelRadius: 6,
  } as MapLayerDrawView;
}

describe('bounty map markers', () => {
  it('positive: one clear_nest bounty produces a marker with the reward amount', () => {
    const markers = bountyMapMarkers(clearNest);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.nestId).toBe('7');
    expect(markers[0]?.reward).toBe('200');

    const { ctx, texts } = textsOf();
    const registry = createMapLayerRegistry();
    const off = registerBountyMapLayer(registry, new Set(['W22', 'W04']));
    expect(registry.get('bounties')?.label).toBe('Bounties');
    registry.get('bounties')?.draw(ctx, viewOf(clearNest, true));
    expect(texts).toContain('200');
    off();
    expect(registry.has('bounties')).toBe(false);
  });

  it('negative: an empty list produces no markers', () => {
    expect(bountyMapMarkers({ bounties: [] })).toEqual([]);
    const { ctx, texts } = textsOf();
    drawBountyMarkers(ctx, viewOf({ bounties: [] }, true), []);
    const registry = createMapLayerRegistry();
    registerBountyMapLayer(registry, new Set(['W22']));
    registry.get('bounties')?.draw(ctx, viewOf({ bounties: [] }, true));
    expect(texts).toEqual([]);
  });

  it('corner: a missing layer registry does not throw', () => {
    expect(() => registerBountyMapLayer(undefined, new Set(['W22', 'W04']))).not.toThrow();
    expect(() => registerBountyMapLayer(null, new Set(['W22']))).not.toThrow();
    const off = registerBountyMapLayer(undefined, new Set(['W22']));
    expect(off).toEqual(expect.any(Function));
    expect(() => off()).not.toThrow();

    const registry = createMapLayerRegistry();
    registerBountyMapLayer(registry, new Set(['W04']));
    expect(registry.all()).toEqual([]);
  });
});
