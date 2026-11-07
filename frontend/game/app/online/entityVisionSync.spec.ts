// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { compileData, ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { EntityMeshRecord } from './EntityMeshRecord';
import { getColonyVisionUniforms, isWorldPointInColonyFov, resetColonyVisionAndLights } from '@terra/render/lighting';
import type { HexTerrain } from '@terra/render/planets/hex';
import { COLONY_FADE_IN_S, syncColonyVisionAndProjectors } from './entityVisionSync';

const terrain = { radius: 4 } as unknown as HexTerrain;
const sync = (colonyActive: boolean) =>
  syncColonyVisionAndProjectors({ records: [], ownerColonyIndex: 0, terrain, tiles: null, colonyActive });

describe('colony vision gate during the space phase / descent (RN-41)', () => {
  afterEach(() => { vi.restoreAllMocks(); resetColonyVisionAndLights(); });

  it('holds the FoV shroud and night factor off while the descent renders, then eases them in without a pop', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const u = getColonyVisionUniforms();

    sync(false);
    expect(u.uFovEnabled.value).toBe(0);
    expect(u.uNightFactor.value).toBe(0);
    expect(u.uVisionSourceCount.value).toBe(0);

    now += 100; // descent ends: first colony frame starts the fade
    sync(true);
    const first = u.uFovEnabled.value as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);

    for (let t = 0; t < COLONY_FADE_IN_S * 1000 + 200; t += 50) { now += 50; sync(true); }
    expect(u.uFovEnabled.value).toBe(1);
  });
});


describe('all owned active units reveal terrain', () => {
  afterEach(resetColonyVisionAndLights);

  it('includes a remote scout after 20 buildings and does not gate sight on mesh visibility', () => {
    const record = (kind: number, x: number): EntityMeshRecord => {
      const mesh = new THREE.Object3D();
      mesh.position.x = x;
      mesh.visible = false;
      return { kind, owner: 0, hp: 100, state: ENTITY_STATE.idle, mesh, buildStage: 1 } as EntityMeshRecord;
    };
    const buildings = Array.from({ length: 20 }, () => record(ENTITY_KIND.wind, 0));
    const scout = record(ENTITY_KIND.recon, 60);
    syncColonyVisionAndProjectors({ records: [...buildings, scout], ownerColonyIndex: 0, terrain, tiles: null });
    expect(isWorldPointInColonyFov(60, 0)).toBe(true);
    expect(isWorldPointInColonyFov(60, -19)).toBe(true); // shared recon radius 10 tiles = 20 metres, all directions
    const data = compileData(new Set(['W00', 'W01', 'W07']), { combatUnits: { recon: { viewRadius: 3 } } });
    syncColonyVisionAndProjectors({ records: [...buildings, scout], ownerColonyIndex: 0, terrain, tiles: null, data });
    expect(isWorldPointInColonyFov(60, -7)).toBe(false);
    expect(isWorldPointInColonyFov(60, -5)).toBe(true);
    scout.hp = 0;
    syncColonyVisionAndProjectors({ records: [...buildings, scout], ownerColonyIndex: 0, terrain, tiles: null });
    expect(isWorldPointInColonyFov(60, 0)).toBe(false);
  });
});
