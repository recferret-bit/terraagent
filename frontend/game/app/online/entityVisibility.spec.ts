import * as THREE from 'three';
import { afterEach, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE, hexIndex, type ViewEntity } from '@terra/sim';
import { resetColonyVisionAndLights } from '@terra/render/lighting';
import type { HexTerrain } from '@terra/render/planets/hex';
import { packEntities, type ClientView } from '../../store/replica/viewCodec';
import { EntityMeshes } from './EntityMeshes';
import { RADAR_SHADOW_COLORS, RadarFogShadows } from './parts/radarFogShadows';

afterEach(resetColonyVisionAndLights);

it('foreign meshes respect authoritative spotting, including the rounded visual fog boundary', () => {
  const scene = new THREE.Scene();
  const meshes = new EntityMeshes(scene, () => new THREE.Group());
  const radius = 20;
  const hiveTile = hexIndex(radius).indexOf(6, 5); // inside the cosmetic circle, outside a radius-10 hex sight set
  const entities = [
    { id: 1, kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, x: 0, y: 0 },
    { id: 2, kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 6, r: 5, x: 6, y: 5 },
  ].map(e => ({ ...e, rot: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.idle, progress: 0 })) as ViewEntity[];
  const count = hexIndex(radius).count;
  const view: ClientView = {
    tick: 0, planet: { id: 'fog', radius, type: 'temperate' }, colonies: [], count: 2, entities: packEntities(entities),
    tiles: { count, terrain: new Uint8Array(count), prep: new Uint8Array(count), height: new Float32Array(count),
      owner: new Int8Array(count).fill(-1), explored: new Uint8Array(count) },
    blobs: { combatVision: { byColony: { 0: [] } } },
  };
  try {
    meshes.syncView(view, null);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(false);
    delete view.blobs!.combatVision; // Online snapshots omit this internal cache.
    meshes.syncView(view, null);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(false);
    view.blobs!.combatVision = { byColony: { 0: [hiveTile] } };
    meshes.syncView({ ...view, tick: 5 }, null);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(true);
    view.blobs!.combatVision = { byColony: { 0: [] } };
    meshes.syncView({ ...view, tick: 10 }, null);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(false);
    meshes.update(0.05);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(false);
  } finally { meshes.dispose(); }
});

it('a landed foreign pod stays hidden until a building or unit spots its tile', () => {
  const scene = new THREE.Scene();
  const meshes = new EntityMeshes(scene, () => new THREE.Group());
  const radius = 20;
  const podTile = hexIndex(radius).indexOf(8, 0);
  const entities = [
    { id: 1, kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, x: 0, y: 0 },
    { id: 2, kind: ENTITY_KIND.pod, owner: 1, q: 8, r: 0, x: 8, y: 0 },
  ].map(e => ({ ...e, rot: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.idle, progress: 0 })) as ViewEntity[];
  const count = hexIndex(radius).count;
  const view: ClientView = {
    tick: 0, planet: { id: 'fog', radius, type: 'temperate' }, colonies: [], count: 2, entities: packEntities(entities),
    tiles: { count, terrain: new Uint8Array(count), prep: new Uint8Array(count), height: new Float32Array(count),
      owner: new Int8Array(count).fill(-1), explored: new Uint8Array(count) },
    blobs: { combatVision: { byColony: { 0: [] } } },
  };
  try {
    meshes.syncView(view, null);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(false);
    view.blobs!.combatVision = { byColony: { 0: [podTile] } };
    meshes.syncView({ ...view, tick: 5 }, null);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(true);
    view.blobs!.combatVision = { byColony: { 0: [] } };
    meshes.syncView({ ...view, tick: 10 }, null);
    meshes.update(0.05);
    expect(meshes.getRecord(2)!.mesh.visible).toBe(false);
  } finally { meshes.dispose(); }
});

it('suppresses foreign HQ working animation in Fog of War while keeping own units active', () => {
  const scene = new THREE.Scene();
  const meshes = new EntityMeshes(scene, () => new THREE.Group());
  const radius = 20;
  const count = hexIndex(radius).count;
  const entities = [
    { id: 1, kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, x: 0, y: 0, state: ENTITY_STATE.active },
    { id: 2, kind: ENTITY_KIND.hq, owner: 1, q: 12, r: 0, x: 12, y: 0, state: ENTITY_STATE.working },
  ].map((e) => ({ ...e, rot: 0, hp: 300, hpMax: 300, progress: 1 })) as ViewEntity[];
  const view: ClientView = {
    tick: 5,
    planet: { id: 'fow-work', radius, type: 'temperate' },
    colonies: [],
    count: entities.length,
    entities: packEntities(entities),
    tiles: {
      count,
      terrain: new Uint8Array(count),
      prep: new Uint8Array(count),
      height: new Float32Array(count),
      owner: new Int8Array(count).fill(-1),
      explored: new Uint8Array(count),
    },
    blobs: { combatVision: { byColony: { 0: [hexIndex(radius).indexOf(0, 0)] } } },
  };
  try {
    meshes.syncView(view, null);
    meshes.update(0.1, null);
    const enemyHq = meshes.getRecord(2)!;
    expect(enemyHq.mesh.visible).toBe(false);
    expect(enemyHq.work).toBe(0);
    expect(meshes.workParticles.group.children).toHaveLength(0);
  } finally {
    meshes.dispose();
  }
});

it('renders distinct shapeless 3D radar shadows in Fog of War for animals, insects, and foreign bots only when Sensor Array is active', () => {
  const scene = new THREE.Scene();
  const shadows = new RadarFogShadows(scene);
  const radius = 32;
  const entities = [
    { id: 1, kind: ENTITY_KIND.sensorArray, owner: 0, tier: 1, q: 0, r: 0, x: 0, y: 0, rot: 0, hp: 420, hpMax: 420, state: ENTITY_STATE.active, progress: 1 },
  ] as ViewEntity[];
  const view: ClientView = {
    tick: 10,
    planet: { id: 'radar-3d', radius, type: 'temperate' },
    colonies: [],
    count: entities.length,
    entities: packEntities(entities),
  };
  const makeEntry = (id: number, kind: number, owner: number, wx: number, wz: number, visible = false) => ({
    id,
    kind,
    owner,
    hp: 100,
    mesh: { visible, position: { x: wx, y: 0, z: wz } },
  });
  const fakeTerrain = {
    heightAt: () => 0,
    biosphere: {
      getLandAnimals: () => [
        { x: 24, z: 0 }, // q=12, r=0 (in FoW, inside radar=24)
        { x: 60, z: 0 }, // q=30, r=0 (outside radar=24)
        { x: 2, z: 0 },  // q=1, r=0 (inside live sight -> no blob)
      ],
    },
  } as unknown as HexTerrain;

  const isInFov = (x: number, _z: number) => Math.abs(x) < 6;
  try {
    const counts = shadows.sync(
      [
        makeEntry(10, ENTITY_KIND.blackAnt, -1, 18, 0, false),   // q=9 insect in radar
        makeEntry(11, ENTITY_KIND.hq, 1, -20, 0, false),        // q=-10 foreign bot in radar
        makeEntry(12, ENTITY_KIND.worker, 1, 2, 0, true),       // visible in sight -> skipped
        makeEntry(13, ENTITY_KIND.worker, 1, 56, 0, false),     // q=28 outside radar -> skipped
        makeEntry(14, ENTITY_KIND.pod, 1, 16, 0, false),        // pod ignored
      ],
      view,
      fakeTerrain,
      0,
      false,
      1.0,
      isInFov,
    );
    expect(counts).toEqual({ animals: 1, insects: 1, bots: 1 });
    expect(RADAR_SHADOW_COLORS.animal).toBe(0x3deb8a);
    expect(RADAR_SHADOW_COLORS.insect).toBe(0xf04848);
    expect(RADAR_SHADOW_COLORS.bot).toBe(0x38bdf8);

    const offlineView: ClientView = {
      ...view,
      entities: packEntities([
        { id: 1, kind: ENTITY_KIND.sensorArray, owner: 0, tier: 1, q: 0, r: 0, x: 0, y: 0, rot: 0, hp: 420, hpMax: 420, state: ENTITY_STATE.offlineUnpowered, progress: 1 },
      ]),
    };
    expect(shadows.sync([], offlineView, fakeTerrain, 0, false, 1.0, isInFov)).toEqual({
      animals: 0,
      insects: 0,
      bots: 0,
    });
  } finally {
    shadows.dispose();
  }
});

it('setFullVision reveals unspotted bots and insects without Player 0 entities and restores FoV when turned off', () => {
  const scene = new THREE.Scene();
  const meshes = new EntityMeshes(scene, () => new THREE.Group());
  const radius = 24;
  const count = hexIndex(radius).count;
  const entities = [
    { id: 10, kind: ENTITY_KIND.roboticsFactory, owner: 1, q: -10, r: 4, x: -10, y: 4, state: ENTITY_STATE.active },
    { id: 11, kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 11, r: -3, x: 11, y: -3, state: ENTITY_STATE.active },
    { id: 12, kind: ENTITY_KIND.blackAnt, owner: -1, q: 12, r: -3, x: 12, y: -3, state: ENTITY_STATE.idle },
  ].map((e) => ({ ...e, rot: 0, hp: 100, hpMax: 100, progress: 1 })) as ViewEntity[];
  const view: ClientView = {
    tick: 5,
    planet: { id: 'ct-vision', radius, type: 'temperate' },
    colonies: [],
    count: entities.length,
    entities: packEntities(entities),
    tiles: {
      count,
      terrain: new Uint8Array(count),
      prep: new Uint8Array(count),
      height: new Float32Array(count),
      owner: new Int8Array(count).fill(-1),
      explored: new Uint8Array(count),
    },
    blobs: { combatVision: { byColony: { 0: [] } } },
  };
  try {
    meshes.syncView(view, null);
    expect(meshes.getRecord(10)!.mesh.visible).toBe(false);
    expect(meshes.getRecord(11)!.mesh.visible).toBe(false);
    expect(meshes.getRecord(12)!.mesh.visible).toBe(false);

    meshes.setFullVision(true);
    expect(meshes.getRecord(10)!.mesh.visible).toBe(true);
    expect(meshes.getRecord(11)!.mesh.visible).toBe(true);
    expect(meshes.getRecord(12)!.mesh.visible).toBe(true);

    meshes.setFullVision(false);
    expect(meshes.getRecord(10)!.mesh.visible).toBe(false);
    expect(meshes.getRecord(11)!.mesh.visible).toBe(false);
    expect(meshes.getRecord(12)!.mesh.visible).toBe(false);
  } finally {
    meshes.dispose();
  }
});
