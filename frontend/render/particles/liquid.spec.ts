import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticlePresetRegistry } from './ParticlePresetRegistry';
import { BurstLayer } from './BurstLayer';
import { getParticleGeometry } from './geometries';
import { ProjectileVfxSystem } from '../visuals/projectiles/ProjectileVfxSystem';
import { validateParticlePreset } from './validate/ParticleValidator';

const readPose = (layer: BurstLayer, index = 0) => {
  const matrix = new THREE.Matrix4();
  layer.mesh.getMatrixAt(index, matrix);
  const position = new THREE.Vector3(); const scale = new THREE.Vector3(); const rotation = new THREE.Quaternion();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
};

function nearestVertexToPlane(layer: BurstLayer, origin: THREE.Vector3, normal: THREE.Vector3): number {
  const matrix = new THREE.Matrix4();
  layer.mesh.getMatrixAt(0, matrix);
  const positions = layer.mesh.geometry.getAttribute('position');
  const vertex = new THREE.Vector3();
  let nearest = Infinity;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix).sub(origin);
    nearest = Math.min(nearest, vertex.dot(normal));
  }
  return nearest;
}

describe('spitter liquid geometry and motion', () => {
  it('uses valid volumetric liquid forms and validated 60/30/10 presets', () => {
    for (const kind of ['liquidGlob', 'liquidDrop', 'liquidFilament', 'liquidCrown'] as const) {
      const geometry = getParticleGeometry(kind);
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(Math.min(size.x, size.y, size.z)).toBeGreaterThan(0.1);
      expect(Array.from(geometry.attributes.position!.array).every(Number.isFinite)).toBe(true);
      expect(Array.from(geometry.attributes.normal!.array).every(Number.isFinite)).toBe(true);
    }
    for (const id of ['combat.acidHit', 'combat.acidTrail']) {
      const report = validateParticlePreset(ParticlePresetRegistry.get(id)!);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.roleShares.primary).toBeCloseTo(0.6);
    }
  });

  it('expands then collapses its crown against the contact normal without drifting inside the target', () => {
    const spec = ParticlePresetRegistry.get('combat.acidHit')!.layers.find(l => l.behavior === 'splash')!;
    const layer = new BurstLayer(spec, new THREE.Group(), 'test');
    const normal = new THREE.Vector3(-1, 0, 0);
    const at = new THREE.Vector3(4, 1.5, 0);
    layer.emit({ at, normal, groundY: 0 }, () => 0.5);
    const initial = readPose(layer);
    expect(nearestVertexToPlane(layer, at, normal)).toBeGreaterThanOrEqual(0.0149);
    expect(nearestVertexToPlane(layer, at, normal)).toBeLessThan(0.025);
    layer.update(0.45);
    const later = readPose(layer);
    expect(later.position.distanceTo(initial.position)).toBeLessThan(1e-8);
    expect(later.position.clone().sub(at).dot(normal)).toBeGreaterThan(0);
    expect(later.scale.x).toBeGreaterThan(initial.scale.x);
    expect(later.scale.z).toBeLessThan(initial.scale.z);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(later.rotation).dot(normal)).toBeCloseTo(1, 6);
    expect(nearestVertexToPlane(layer, at, normal)).toBeGreaterThanOrEqual(0.0149);
    expect(nearestVertexToPlane(layer, at, normal)).toBeLessThan(0.025);
    layer.dispose();
  });

  it('keeps every stretched liquid vertex outside the contact plane at birth and throughout its lifetime', () => {
    const normals = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, -0.4, 0.7).normalize()];
    const at = new THREE.Vector3(4, 1.5, -2);
    const specs = ParticlePresetRegistry.get('combat.acidHit')!.layers.filter(l => l.behavior === 'liquid');
    for (const spec of specs) for (const normal of normals) for (const sample of [0, 0.5, 0.99]) {
      const layer = new BurstLayer({ ...spec, count: 1, lifetimeRange: [1, 1] }, new THREE.Group(), 'test');
      layer.emit({ at, normal, groundY: 0, scale: 2.5 }, () => sample);
      expect(nearestVertexToPlane(layer, at, normal), `${spec.name} immediately after emit`)
        .toBeGreaterThanOrEqual(0.0149);
      let previous = 0;
      for (const age of [0, 0.05, 0.2, 0.45, 0.75, 0.95]) {
        layer.update(age - previous);
        expect(nearestVertexToPlane(layer, at, normal), `${spec.name}, age ${age}, sample ${sample}`)
          .toBeGreaterThanOrEqual(0.0149);
        previous = age;
      }
      layer.dispose();
    }
  });

  it('round drops settle into flattened wet beads on the actual terrain plane', () => {
    const base = ParticlePresetRegistry.get('combat.acidHit')!.layers[0]!;
    const layer = new BurstLayer({ ...base, count: 1, lifetimeRange: [2, 2], upwardBias: [0, 0] }, new THREE.Group(), 'test');
    layer.emit({ at: new THREE.Vector3(0, -0.8, 0), normal: new THREE.Vector3(-1, 0, 0), groundY: -1 }, () => 0.5);
    for (let i = 0; i < 60; i++) layer.update(1 / 60);
    const { position, scale } = readPose(layer);
    expect(position.y).toBeGreaterThanOrEqual(-1);
    expect(position.y).toBeLessThan(-0.98);
    expect(scale.y).toBeLessThan(scale.x * 0.25);
    layer.dispose();
  });

  it('sheds gel along the acid arc, spawns the liquid impact and expires everything after reset or time', () => {
    const vfx = new ProjectileVfxSystem();
    vfx.onProjectileFired({ weaponKind: 'acid', from: { x: -3, y: 1.1 }, to: { x: 3, y: 0.6 }, durationS: 0.8 });
    for (let i = 0; i < 20; i++) vfx.update(1 / 60);
    expect(vfx.getBurstCounts()['combat.acidTrail']).toBeGreaterThan(0);
    expect(vfx.getBurstCounts()['combat.muzzle'] ?? 0).toBe(0);
    expect(vfx.getActiveProjectiles()[0]!.y).toBeGreaterThan(1.1);
    for (let i = 0; i < 30; i++) vfx.update(1 / 60);
    expect(vfx.getBurstCounts()['combat.acidHit']).toBe(30);
    for (let i = 0; i < 100; i++) vfx.update(1 / 60);
    expect(Object.values(vfx.getBurstCounts()).every(count => count === 0)).toBe(true);
    vfx.clear();
    expect(vfx.getActiveProjectiles()).toHaveLength(0);
    vfx.dispose();
  });
});
