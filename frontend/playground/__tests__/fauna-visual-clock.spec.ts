import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { getInsectAnimator } from '@terra/render/animation/insects/InsectAnimationController';
import { FaunaSceneHost } from '../content/FaunaSceneHost';
import { FiringRangeScene } from '../content/faunaFiringRange';
import { ProjectileVfxSystem } from '@terra/render/visuals/projectiles';

function bugMesh(host: FaunaSceneHost): THREE.Object3D {
  return host.group.children.find(child => child.userData.archetypeId === 'fauna.greenSpitter')!;
}
function addClockProbe(host: FaunaSceneHost): void {
  host.projectiles.onProjectileFired({ weaponKind: 'acid', from: { x: 100, y: 2, z: 0 },
    to: { x: 200, y: 2, z: 0 }, durationS: 10, autoImpactOnArrival: false });
}
function probeProgress(host: FaunaSceneHost): number {
  return host.projectiles.getActiveProjectiles().find(p => p.x >= 100)!.t;
}

describe('hive-life visual clock', () => {
  it.each(['bugs', 'passive'] as const)('freezes pose and flight on pause, then advances both once per step (%s)', mode => {
    const host = new FaunaSceneHost();
    host.setScene('greenSpitter', { mode, seed: 42 });
    host.update(400, 0);
    addClockProbe(host);
    const mesh = bugMesh(host);
    const initialTime = mesh.userData.uniforms.uTime.value;
    host.setPaused(true);
    host.update(900, 1);
    expect(mesh.userData.uniforms.uTime.value).toBe(initialTime);
    expect(probeProgress(host)).toBe(0);
    expect(host.getStats().tick).toBe(0);

    host.stepTick();
    expect(host.getStats().tick).toBe(1);
    expect(mesh.userData.uniforms.uTime.value - initialTime).toBeCloseTo(0.2 * 0.92);
    expect(probeProgress(host)).toBeCloseTo(0.02);
    host.update(1200, 1);
    expect(probeProgress(host)).toBeCloseTo(0.02);
    expect(mesh.userData.uniforms.uTime.value - initialTime).toBeCloseTo(0.2 * 0.92);

    host.setPaused(false);
    host.update(1200.2, 0.2);
    expect(probeProgress(host)).toBeCloseTo(0.04);
    host.reset(42);
    host.update(2000, 0);
    expect(bugMesh(host).userData.uniforms.uTime.value).toBe(initialTime);
    expect(host.projectiles.getActiveProjectiles()).toHaveLength(0);
    host.setScene(null);
    host.projectiles.dispose();
  });

  it('advances dying poses on explicit steps while paused', () => {
    const host = new FaunaSceneHost();
    host.setScene('greenSpitter', { mode: 'bugs' });
    const animator = getInsectAnimator(bugMesh(host))!;
    animator.die();
    host.setPaused(true);
    host.update(1, 1);
    expect(animator.pose.death).toBe(0);
    host.stepTick();
    expect(animator.pose.death).toBeGreaterThan(0);
    expect(animator.pose.death).toBeLessThan(1);
    host.stepTick(4);
    expect(animator.state).toBe('dead');
    host.setScene(null);
    host.projectiles.dispose();
  });

  it('expires retained corpses even when the preview is culled', () => {
    const group = new THREE.Group();
    const projectiles = new ProjectileVfxSystem(group);
    const range = new FiringRangeScene(group, projectiles);
    range.build('greenSpitter', 'bugs', 42, 'dune');
    const id = range.battle.insects.snapshots()[0]!.id;
    const dispose = vi.fn();
    expect(range.battle.insects.retire(id, dispose, true)).toBe(true);
    range.tickMeshes(3, true, 2.5);
    expect(dispose).toHaveBeenCalledOnce();
    range.tickMeshes(6, true, 2.5);
    expect(dispose).toHaveBeenCalledOnce();
    range.dispose();
    projectiles.dispose();
  });
});
