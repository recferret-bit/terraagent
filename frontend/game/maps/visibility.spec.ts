import { describe, expect, it, vi } from 'vitest';
import { compileData, ENTITY_KIND, ENTITY_STATE, type ViewEntity } from '@terra/sim';
import { hexIndex } from '@terra/sim/grid/hex';
import { packEntities, type ClientTiles } from '../store/replica/viewCodec';
import { drawThreatsLayer } from '../features/combat/threatsLayer';
import { collectEntityDots } from './entityDots';
import { classifyTileState } from './tileColors';
import { createMapVisibility, isMapTileExplored } from './visibility';
import type { MapLayerDrawView } from './types';

function fixture(): MapLayerDrawView {
  const radius = 40, index = hexIndex(radius);
  const tiles: ClientTiles = {
    count: index.count, terrain: new Uint8Array(index.count), prep: new Uint8Array(index.count),
    height: new Float32Array(index.count), owner: new Int8Array(index.count).fill(-1), explored: new Uint8Array(index.count),
  };
  const entities = [
    { id: 1, kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.idle },
    { id: 2, kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 30, r: 0, x: 30, y: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.idle },
  ].map(e => ({ ...e, rot: 0, progress: 0 })) as ViewEntity[];
  return {
    width: 180, height: 180, radius, tiles, ownColonySlot: 0, tilePixelRadius: 2,
    clientView: { tick: 0, planet: { id: 'test', type: 'temperate', radius }, entities: packEntities(entities), count: 2, colonies: [],
      blobs: { faunaHives: { hivesById: { '2': { q: 30, r: 0 } } } } },
    axialToPixel: (q, r) => ({ x: q, y: r }), pixelToAxial: (x, y) => ({ q: x, r: y }),
  };
}

const canvas = () => new Proxy({}, { get: () => vi.fn(), set: () => true }) as CanvasRenderingContext2D;

describe('map fog visibility', () => {
  it('uses the host live sight radius for fallback spotting', () => {
    const view = fixture();
    const simData = compileData(new Set(['W00', 'W01', 'W07']), { combatUnits: { recon: { viewRadius: 3 } } });
    expect(createMapVisibility({ ...view, simData })(4, 0)).toBe(false);
    expect(createMapVisibility({ ...view, simData })(3, 0)).toBe(true);
    expect(createMapVisibility(view)(4, 0)).toBe(true);
  });

  it('hides unknown hives from both entity dots and threat blobs, reveals only while spotted', () => {
    const view = fixture(), target = hexIndex(view.radius).indexOf(30, 0);
    expect(drawThreatsLayer(canvas(), view).hiveMarkers).toBe(0);
    expect(collectEntityDots(view).map(e => e.id)).toEqual([1]);
    view.tiles!.explored![target] = 1;
    expect(drawThreatsLayer(canvas(), view).hiveMarkers).toBe(0); // remembered terrain is not current sight
    view.clientView!.blobs!.combatVision = { byColony: { 0: [target] } };
    expect(drawThreatsLayer(canvas(), view).hiveMarkers).toBe(1);
    expect(collectEntityDots(view).map(e => e.id)).toEqual([1, 2]);
    view.clientView!.blobs!.combatVision = { byColony: { 0: [] } };
    expect(drawThreatsLayer(canvas(), view).hiveMarkers).toBe(0);
    expect(collectEntityDots(view).map(e => e.id)).toEqual([1]);
  });

  it('hides a landed pod until a unit sees that tile, and drops the tile when the unit leaves', () => {
    const view = fixture();
    const pod = { id: 3, kind: ENTITY_KIND.pod, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.idle, rot: 0, progress: 0 };
    const pack = (list: ViewEntity[]) => { view.clientView!.entities = packEntities(list); view.clientView!.count = list.length; };
    pack([pod] as ViewEntity[]);
    expect(createMapVisibility(view)(0, 0)).toBe(false);

    const bot = { ...pod, id: 4, kind: ENTITY_KIND.hq };
    pack([pod, bot] as ViewEntity[]);
    expect(createMapVisibility(view)(0, 0)).toBe(true);
    expect(createMapVisibility(view)(8, 0)).toBe(true);

    pack([pod, { ...bot, q: 20, r: 0, x: 20, y: 0 }] as ViewEntity[]);
    expect(createMapVisibility(view)(0, 0)).toBe(false);
    expect(createMapVisibility(view)(20, 0)).toBe(true);
  });

  it('scopes remembered terrain and current spotting to the selected colony', () => {
    const view = fixture(), target = hexIndex(view.radius).indexOf(30, 0);
    view.tiles!.explored![target] = 2;
    view.clientView!.blobs!.combatVision = { byColony: { 0: [], 1: [target] } };
    expect(isMapTileExplored(view, target)).toBe(false);
    expect(createMapVisibility(view)(30, 0)).toBe(false);
    expect(createMapVisibility({ ...view, ownColonySlot: 1 })(30, 0)).toBe(true);
    expect(isMapTileExplored({ ...view, ownColonySlot: 1 }, target)).toBe(true);
  });

  it('unions all colonies exploration and tile classification when spectatorAllVision is enabled', () => {
    const view = fixture();
    const targetA = hexIndex(view.radius).indexOf(10, 0);
    const targetB = hexIndex(view.radius).indexOf(30, 0);
    view.tiles!.explored![targetB] = 1 << 2; // Colony 2 only in legacy layer
    view.tiles!.exploredByColony = {
      1: new Uint8Array(Math.ceil(view.tiles!.count / 8)),
      6: new Uint8Array(Math.ceil(view.tiles!.count / 8)),
    };
    view.tiles!.exploredByColony[6]![targetA >> 3]! |= 1 << (targetA & 7);

    expect(isMapTileExplored({ ...view, ownColonySlot: 1, spectatorAllVision: false }, targetA)).toBe(false);
    expect(isMapTileExplored({ ...view, ownColonySlot: 1, spectatorAllVision: false }, targetB)).toBe(false);
    expect(isMapTileExplored({ ...view, ownColonySlot: 1, spectatorAllVision: true }, targetA)).toBe(true);
    expect(isMapTileExplored({ ...view, ownColonySlot: 1, spectatorAllVision: true }, targetB)).toBe(true);
    expect(classifyTileState(view.tiles!, targetA, 1)).toBe('unexplored');
    expect(classifyTileState(view.tiles!, targetA, -1)).toBe('flat');
    expect(classifyTileState(view.tiles!, targetB, -1)).toBe('flat');
  });
});
