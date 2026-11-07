import * as THREE from 'three';
import { afterEach, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE, hexIndex, type ViewEntity } from '@terra/sim';
import { resetColonyVisionAndLights } from '@terra/render/lighting';
import { packEntities, type ClientView } from '../../store/replica/viewCodec';
import { EntityMeshes } from './EntityMeshes';

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
  } finally { meshes.dispose(); }
});
