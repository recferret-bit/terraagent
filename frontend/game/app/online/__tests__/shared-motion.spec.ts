import * as THREE from 'three';
import { expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createArchetypeMesh } from '@terra/render/kitbash';
import { MotionTrack } from '@terra/render/motion/entityMotion';
import {
  createRegistryPipeline, createState, ensureColonyLedger, ensureColonyRecord,
  populateInsectAttackScene, TERRAIN, PREP, SimHost,
} from '@terra/sim';
import { packEntities, packView, unpackView } from '../../../store/replica/viewCodec';
import { EntityMeshes } from '../EntityMeshes';

it('gameplay uses the shared sampler for both local and serialized server bug movement without tick hops', () => {
  const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
  const state = createState({ planetId: 'motion-client', planetType: 'temperate', seed: '7', radius: 12 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active'; colony.powerSupplyOverride = 800;
  const [pair] = populateInsectAttackScene(state, 'blueBeetle', 'bugs', pipeline.config.data);
  const host = new SimHost(pipeline);
  host.load(state);
  const local = new EntityMeshes(new THREE.Scene(), createArchetypeMesh, false);
  const remote = new EntityMeshes(new THREE.Scene(), createArchetypeMesh, false);
  const distances: number[] = [];
  let previous: THREE.Vector3 | undefined;
  for (let frame = 0; frame < 144; frame++) {
    if (frame % 12 === 0) {
      host.step(1);
      const view = host.view();
      local.syncView({
        tick: view.tick, planet: view.planet, colonies: view.colonies, blobs: view.blobs,
        entities: packEntities(view.entities), count: view.entities.length,
      }, null);
      remote.syncView(unpackView(packView(view, true).view), null);
    }
    local.update(1 / 60); remote.update(1 / 60);
    const a = local.getRecord(pair!.bugId)!;
    const b = remote.getRecord(pair!.bugId)!;
    expect(a.track).toBeInstanceOf(MotionTrack);
    expect(b.track).toBeInstanceOf(MotionTrack);
    expect(a.mesh.position.distanceTo(b.mesh.position)).toBeLessThan(0.0001);
    if (previous && frame > 60) distances.push(a.mesh.position.distanceTo(previous));
    previous = a.mesh.position.clone();
  }
  expect(Math.min(...distances)).toBeGreaterThan(0.01);
  expect(Math.max(...distances) / Math.min(...distances)).toBeLessThan(1.4);
  local.dispose(); remote.dispose();
});
