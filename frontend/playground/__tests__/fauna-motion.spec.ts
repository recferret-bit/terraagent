import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FaunaSceneHost } from '../content/FaunaSceneHost';
import type { FaunaMode } from '../state';

function fixture(species: 'blackAnt' | 'blueBeetle' | 'greenSpitter', mode: FaunaMode) {
  const host = new FaunaSceneHost();
  host.setScene(species, { mode, seed: 42 });
  host.stepTick(2);
  const bug = host.getStats().bugs[0]!;
  const mesh = host.group.children.find(child => child.userData.archetypeId === `fauna.${species}`)!;
  const logical = () => host.getStats().bugs.find(b => b.bugId === bug.bugId)!;
  const dispose = () => { host.setScene(null); host.projectiles.dispose(); };
  return { host, mesh, logical, dispose };
}

describe('global tick interpolation in Hive', () => {
  for (const mode of ['bugs', 'passive', 'aggressive'] as const) {
    for (const species of ['blackAnt', 'blueBeetle', 'greenSpitter'] as const) {
      it(`${mode}/${species} covers equal distances per frame between ticks and freezes on pause`, () => {
        const f = fixture(species, mode);
        const from = { ...f.logical() };
        f.host.update(1, 0.25);
        const to = { ...f.logical() };
        const quarter = f.mesh.position.clone();
        expect(quarter.x).toBeCloseTo(from.x + (to.x - from.x) * 0.25, 4);
        expect(quarter.z).toBeCloseTo(from.z + (to.z - from.z) * 0.25, 4);
        if (mode === 'passive' || species !== 'greenSpitter') expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(0.001);
        f.host.update(1.05, 0.05);
        const half = f.mesh.position.clone();
        f.host.update(1.10, 0.05);
        const threeQuarters = f.mesh.position.clone();
        expect(half.distanceTo(quarter)).toBeCloseTo(threeQuarters.distanceTo(half), 6);
        f.host.setPaused(true);
        const yaw = f.mesh.rotation.y;
        f.host.update(10, 2);
        expect(f.mesh.position.distanceTo(threeQuarters)).toBe(0);
        expect(f.mesh.rotation.y).toBe(yaw);
        f.host.stepTick();
        expect(f.mesh.position.x).toBeCloseTo(f.logical().x, 4);
        expect(f.mesh.position.z).toBeCloseTo(f.logical().z, 4);
        const stepped = f.mesh.position.clone();
        f.host.setPaused(false);
        f.host.update(11, 0.05);
        expect(f.mesh.position.distanceTo(stepped)).toBe(0); // no rewind into the manually displayed tick
        f.dispose();
      });
    }
  }
  it('a delayed frame samples the final tick span instead of chasing the whole backlog', () => {
    const f = fixture('blueBeetle', 'bugs');
    const reference = fixture('blueBeetle', 'bugs');
    reference.host.stepTick(2);
    const from = { ...reference.logical() };
    reference.host.stepTick();
    const to = { ...reference.logical() };
    f.host.update(1, 0.65);
    expect(f.mesh.position.x).toBeCloseTo(from.x + (to.x - from.x) * 0.25, 5);
    expect(f.mesh.position.z).toBeCloseTo(from.z + (to.z - from.z) * 0.25, 5);
    f.dispose(); reference.dispose();
  });
  it('robots-attack keeps bug roots planted throughout playback', () => {
    const f = fixture('blueBeetle', 'robots');
    const start = new THREE.Vector3().copy(f.mesh.position);
    for (let frame = 0; frame < 30; frame++) {
      f.host.update(frame / 60, 1 / 60);
      expect(f.mesh.position.distanceTo(start)).toBe(0);
    }
    f.dispose();
  });
});
