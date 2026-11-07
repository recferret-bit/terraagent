import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ProjectileVfxSystem } from '@terra/render/visuals/projectiles';
import { FiringRangeScene } from '../content/faunaFiringRange';
import type { FaunaSceneKind } from '../state';

function fixture(species: FaunaSceneKind, mode: 'bugs' | 'robots') {
  const projectiles = new ProjectileVfxSystem();
  const scene = new FiringRangeScene(new THREE.Group(), projectiles);
  scene.build(species, mode, 7, 'dune');
  let time = 0;
  return { scene, projectiles, step() {
    scene.stepTicks(1); scene.follow(0.2); time += 0.2;
    scene.tickMeshes(time, false, 0.2); projectiles.update(0.2);
  }, dispose() { scene.dispose(); projectiles.dispose(); } };
}

describe('insect scene presentation integrates shared attack timing', () => {
  it.each(['blackAnt', 'blueBeetle', 'greenSpitter', 'mixed'] as const)('%s acts through windup/contact/recovery without melee beams', species => {
    const f = fixture(species, 'bugs');
    const states = new Set<string>();
    let acid = false;
    for (let i = 0; i < 55; i++) {
      f.step();
      for (const state of f.scene.battle.insects.snapshots()) states.add(state.state);
      expect(f.projectiles.getActiveLasers()).toHaveLength(0);
      for (const p of f.projectiles.getActiveProjectiles()) {
        expect(p.weaponKind).toBe('acid');
        acid = true;
        // Rear-sac launch stays behind the spitter's initial root at world X=-4.
        if (species === 'greenSpitter') expect(p.fromX).toBeLessThan(-4.2);
      }
    }
    expect(states.has('windup')).toBe(true);
    expect(states.has('attack')).toBe(true);
    expect(states.has('recovery')).toBe(true);
    expect(acid).toBe(species === 'greenSpitter' || species === 'mixed');
    f.dispose();
  });

  it('robot attack direction keeps insects planted and retains dying/dead meshes until cleanup', () => {
    const f = fixture('mixed', 'robots');
    const initial = f.scene.stats('mixed', false, 0).bugs.map(b => [b.bugId, b.x, b.z]);
    const retiredStates = new Set<string>();
    for (let i = 0; i < 65; i++) {
      f.step();
      for (const bug of f.scene.stats('mixed', false, 0).bugs) {
        expect(initial).toContainEqual([bug.bugId, bug.x, bug.z]);
      }
      for (const state of f.scene.battle.insects.snapshots()) if (state.retired) retiredStates.add(state.state);
    }
    expect(retiredStates.has('dying')).toBe(true);
    expect(retiredStates.has('dead')).toBe(true);
    expect(f.scene.battle.insects.snapshots()).toHaveLength(0);
    f.dispose();
  });
});
