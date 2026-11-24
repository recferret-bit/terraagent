// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { compileData, ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { EntityMeshRecord } from './EntityMeshRecord';
import { getColonyVisionUniforms, isWorldPointInColonyFov, resetColonyVisionAndLights } from '@terra/render/lighting';
import type { HexTerrain } from '@terra/render/planets/hex';
import { colonyNightBlend, computeSolarState, resetDayNightParams, setDayNight, setDayNightParams } from '@terra/render/core/dayNightConfig';
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


describe('evening colony night', () => {
  afterEach(() => {
    resetDayNightParams('sync');
    resetColonyVisionAndLights();
  });

  it('eases the night factor across sunset instead of slamming it', () => {
    setDayNight(true);
    const mesh = new THREE.Object3D();
    const record = { kind: ENTITY_KIND.hq, owner: 0, hp: 100, state: ENTITY_STATE.idle, mesh, buildStage: 1 } as EntityMeshRecord;
    let prev = -1;
    for (let h = 17; h <= 20; h += 0.1) {
      setDayNightParams({ timeOfDay: h }, 'sync');
      syncColonyVisionAndProjectors({ records: [record], ownerColonyIndex: 0, terrain, tiles: null });
      const night = getColonyVisionUniforms().uNightFactor.value as number;
      if (prev >= 0) expect(Math.abs(night - prev)).toBeLessThan(0.08);
      prev = night;
    }
    setDayNightParams({ timeOfDay: 18.25 }, 'sync');
    syncColonyVisionAndProjectors({ records: [record], ownerColonyIndex: 0, terrain, tiles: null });
    const dusk = getColonyVisionUniforms().uNightFactor.value as number;
    expect(dusk).toBeGreaterThan(0.5);
    expect(dusk).toBeLessThan(0.75);
    expect(dusk).toBeCloseTo(colonyNightBlend(18.25, computeSolarState().daylight).nightFactor, 5);
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

  it('does not light a landed pod, and a spawned unit takes its sight with it', () => {
    const record = (kind: number, x: number, state = ENTITY_STATE.idle): EntityMeshRecord => {
      const mesh = new THREE.Object3D();
      mesh.position.x = x;
      return { kind, owner: 0, hp: 100, state, mesh, buildStage: 1 } as EntityMeshRecord;
    };
    const pod = record(ENTITY_KIND.pod, 0);
    syncColonyVisionAndProjectors({ records: [pod], ownerColonyIndex: 0, terrain, tiles: null });
    expect(isWorldPointInColonyFov(0, 0)).toBe(false);

    const bot = record(ENTITY_KIND.hq, 0);
    syncColonyVisionAndProjectors({ records: [pod, bot], ownerColonyIndex: 0, terrain, tiles: null });
    expect(isWorldPointInColonyFov(0, 0)).toBe(true);
    bot.mesh.position.x = 40;
    syncColonyVisionAndProjectors({ records: [pod, bot], ownerColonyIndex: 0, terrain, tiles: null });
    expect(isWorldPointInColonyFov(0, 0)).toBe(false);
    expect(isWorldPointInColonyFov(40, 0)).toBe(true);
  });

  it('keeps HQ bot vision and full light level while constructing or waiting, while unbuilt buildings stay dark', () => {
    setDayNight(true);
    setDayNightParams({ timeOfDay: 12 }, 'sync');
    try {
      const hubMesh = new THREE.Object3D();
      const unbuiltHub = { kind: ENTITY_KIND.commandHub, owner: 0, hp: 500, state: ENTITY_STATE.constructing, mesh: hubMesh, buildStage: 0.2 } as EntityMeshRecord;
      const hqMesh = new THREE.Object3D();
      const hqBot = { kind: ENTITY_KIND.hq, owner: 0, hp: 300, state: ENTITY_STATE.constructing, mesh: hqMesh, buildStage: 1 } as EntityMeshRecord;

      syncColonyVisionAndProjectors({ records: [unbuiltHub], ownerColonyIndex: 0, terrain, tiles: null });
      expect(getColonyVisionUniforms().uVisionSourceCount.value).toBe(0);
      expect(isWorldPointInColonyFov(0, 0)).toBe(false);

      syncColonyVisionAndProjectors({ records: [unbuiltHub, hqBot], ownerColonyIndex: 0, terrain, tiles: null });
      expect(getColonyVisionUniforms().uVisionSourceCount.value).toBe(1);
      expect(isWorldPointInColonyFov(0, 0)).toBe(true);
      expect(hqBot.lightLevel).toBe(1);

      hqBot.state = ENTITY_STATE.waiting;
      syncColonyVisionAndProjectors({ records: [unbuiltHub, hqBot], ownerColonyIndex: 0, terrain, tiles: null });
      expect(getColonyVisionUniforms().uVisionSourceCount.value).toBe(1);
      expect(isWorldPointInColonyFov(0, 0)).toBe(true);
      expect(hqBot.lightLevel).toBe(1);
    } finally {
      resetDayNightParams('sync');
    }
  });

  it('points robot.recon optics light along turretYaw and keeps spider headlamps between front legs', () => {
    setDayNight(true);
    setDayNightParams({ timeOfDay: 22 }, 'sync');
    try {
      const spyMesh = new THREE.Object3D();
      spyMesh.position.set(4, 0, 2);
      spyMesh.rotation.y = 0.3;
      spyMesh.userData.turretYaw = Math.PI / 2;
      const reconRec = { kind: ENTITY_KIND.recon, owner: 0, hp: 100, state: ENTITY_STATE.idle, mesh: spyMesh, buildStage: 1 } as EntityMeshRecord;
      syncColonyVisionAndProjectors({ records: [reconRec], ownerColonyIndex: 0, terrain, tiles: null });
      const u = getColonyVisionUniforms();
      expect(u.uProjectorCount.value).toBe(1);
      const dir = u.uProjectorDirAngle.value[0]!;
      // Total yaw = chassis 0.3 + turretYaw pi/2 => forward horizontal points predominantly +X (cos ~0.3)
      expect(dir.x).toBeGreaterThan(0.75);
      expect(dir.y).toBeLessThan(-0.05);

      const artRec = { kind: ENTITY_KIND.demoArtillery, owner: 0, hp: 100, state: ENTITY_STATE.idle, mesh: new THREE.Object3D(), buildStage: 1 } as EntityMeshRecord;
      const tankRec = { kind: ENTITY_KIND.demoTank, owner: 0, hp: 100, state: ENTITY_STATE.idle, mesh: new THREE.Object3D(), buildStage: 1 } as EntityMeshRecord;
      syncColonyVisionAndProjectors({ records: [artRec, tankRec], ownerColonyIndex: 0, terrain, tiles: null });
      expect(u.uProjectorCount.value).toBe(4);
      for (let i = 0; i < 4; i++) expect(u.uProjectorPosRange.value[i]!.y).toBeCloseTo(0.81, 2);
      expect(u.uProjectorPosRange.value[0]!.x).toBeCloseTo(-0.068, 2);
      expect(u.uProjectorPosRange.value[1]!.x).toBeCloseTo(0.068, 2);
    } finally {
      resetDayNightParams('sync');
    }
  });
});
