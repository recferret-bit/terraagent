// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hexCount } from '@terra/sim/grid/hex';
import { resetGameInputBlock } from '../core/input/gameInputBlock';
import type { FeatureContext, GameView } from '../core/registry/types';
import type { ClientTiles } from '../store/replica/viewCodec';
import { MapLayerRegistry } from './layerRegistry';
import { MapsController } from './MapsController';
import { PlanetRasterCache } from './rasterCache';

const RADIUS = 2;

function makeTiles(): ClientTiles {
  const count = hexCount(RADIUS);
  return {
    count,
    terrain: new Uint8Array(count),
    prep: new Uint8Array(count),
    height: new Float32Array(count),
    owner: new Int8Array(count).fill(-1),
    explored: new Uint8Array(count).fill(1),
  };
}

function setup() {
  const rts = { target: { x: 0, y: 0, z: 0 }, enabled: true };
  const camera = { position: { x: 10, y: 20, z: 10 } };
  const ctx = {
    flags: new Set(['W00', 'W01', 'W02', 'W03', 'W04']),
    services: { rtsCamera: rts, camera, colonyId: 0 },
  } as unknown as FeatureContext;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const rasterCache = new PlanetRasterCache();
  const controller = new MapsController({ el, ctx, registry: new MapLayerRegistry(), rasterCache });
  return { controller, rts, camera, rasterCache };
}

const viewWith = (tiles: ClientTiles) =>
  ({ tick: 1, planet: { id: 'p_test', type: 'temperate', radius: RADIUS }, tiles, entities: [], count: 0 }) as unknown as GameView;

afterEach(() => {
  resetGameInputBlock();
  document.body.replaceChildren();
});

describe('W04 MapsController redraw routing', () => {
  it('camera changes go through the scheduler: many panning frames are at most one immediate minimap redraw', () => {
    const { controller, rts } = setup();
    const render = vi.spyOn(controller.minimapHud, 'render');
    const markDirty = vi.spyOn(controller.scheduler, 'markDirty');
    for (let i = 0; i < 30; i++) {
      rts.target.x = i * 0.5;
      controller.syncCameraFrame();
    }
    expect(markDirty).toHaveBeenCalledTimes(30);
    expect(render.mock.calls.length).toBeLessThanOrEqual(1);
    expect(controller.scheduler.minimapPending || render.mock.calls.length === 1).toBe(true);

    // An unchanged camera marks nothing
    markDirty.mockClear();
    controller.syncCameraFrame();
    expect(markDirty).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('skips the per-tile dirty scan when the same tiles object comes again', () => {
    const { controller, rasterCache } = setup();
    const update = vi.spyOn(rasterCache, 'update');
    const tiles = makeTiles();
    controller.updateFromView(viewWith(tiles));
    controller.updateFromView(viewWith(tiles));
    controller.updateFromView(viewWith(tiles));
    expect(update).toHaveBeenCalledTimes(1);

    const next = makeTiles();
    next.terrain[3] = 2;
    controller.updateFromView(viewWith(next));
    expect(update).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
