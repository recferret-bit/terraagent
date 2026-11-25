import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENTITY_KIND } from '@terra/sim';
import { ProjectileVfxSystem } from '@terra/render/visuals/projectiles';
import { FiringRangeScene } from '../content/faunaFiringRange';

describe('FiringRangeScene mechanical death explosions & wreck sync', () => {
  it('emits bot death explosion + shockwaves and syncs wreck XZ even before follow() runs', () => {
    const group = new THREE.Group();
    const projectiles = new ProjectileVfxSystem();
    const scene = new FiringRangeScene(group, projectiles);
    scene.build('blueBeetle', 'bugs', 7, 'dune');

    const sim = (scene as unknown as { sim: { entities: { count: number; cols: { kind: Int32Array; hp: Float32Array; id: Int32Array } } } }).sim;
    let victimId = -1;
    for (let i = 0; i < sim.entities.count; i++) {
      const k = sim.entities.cols.kind[i]!;
      if (k === ENTITY_KIND.recon || k === ENTITY_KIND.demoTank) {
        sim.entities.cols.hp[i] = 1;
        victimId = sim.entities.cols.id[i]!;
        break;
      }
    }
    expect(victimId).toBeGreaterThan(0);

    // Move visual away to a stale mesh position to verify ingest() syncs v.x / v.z before preserve()
    const visuals = (scene as unknown as { visuals: Array<{ id: number; x: number; z: number; mesh: THREE.Object3D }> }).visuals;
    const vis = visuals.find((v) => v.id === victimId)!;
    vis.mesh.position.set(99, 0, -99);

    for (let i = 0; i < 90 && !scene.wrecks.has(victimId); i++) {
      scene.stepTicks(1);
    }

    expect(scene.wrecks.has(victimId)).toBe(true);
    const wreckMesh = scene.wrecks.group.children[0] as THREE.Mesh;
    expect(wreckMesh.position.x).toBeCloseTo(vis.x, 3);
    expect(wreckMesh.position.z).toBeCloseTo(vis.z, 3);
    expect(projectiles.getBurstCounts()['combat.botDeath']).toBeGreaterThan(0);
    expect(projectiles.getActiveCounts().shockwaves).toBeGreaterThanOrEqual(2);
    expect(projectiles.getSmolderSiteCount()).toBeGreaterThanOrEqual(1);

    scene.dispose();
    projectiles.dispose();
  });
});
