import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh } from '../kitbash';
import { BattlePresentation } from './BattlePresentation';
import { ProjectileVfxSystem } from '../visuals/projectiles';
import { BurstLayer } from '../particles/BurstLayer';
import { ParticlePresetRegistry } from '../particles/ParticlePresetRegistry';
import { validateParticlePreset } from '../particles/validate/ParticleValidator';

function fixture() {
  const shooter = createArchetypeMesh('robot.artillery');
  const target = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshBasicMaterial());
  target.position.set(8, 0.7, 0);
  const battle = new BattlePresentation(id => id === 1 ? shooter : id === 2 ? target : undefined);
  battle.sync({ byEntityId: { 1: { targetId: 2 } } });
  return { battle, shooter, target };
}

describe('battle recoil, spread and surface contacts', () => {
  it('holds artillery elevation for an entire cooldown; recoil is axial, bounded and returns to rest', () => {
    const { battle } = fixture();
    battle.shot(1, { weaponKind: 'shell', from: { x: 0, y: 1 }, to: { x: 8, y: 0.7 }, targetId: 2, impactTick: 7 });
    const rig = battle.getRig(1)!;
    const direction = rig.direction();
    const rest = rig.muzzle();
    let maxRecoil = 0;
    for (let i = 0; i < 120; i++) {
      battle.update(1 / 120);
      const delta = rig.muzzle().sub(rest);
      expect(rig.direction().dot(direction)).toBeCloseTo(1, 9);
      expect(delta.clone().cross(direction).length()).toBeLessThan(1e-8);
      expect(delta.dot(direction)).toBeLessThanOrEqual(1e-8);
      maxRecoil = Math.max(maxRecoil, delta.length());
    }
    expect(maxRecoil).toBeCloseTo(0.04, 5);
    expect(rig.muzzle().distanceTo(rest)).toBeLessThan(1e-8);
  });

  it('laser barrels have no mechanical recoil', () => {
    const { battle } = fixture();
    battle.shot(1, { weaponKind: 'laser', from: { x: 0, y: 1 }, to: { x: 8, y: 0.7 }, targetId: 2, impactTick: 1 });
    const rig = battle.getRig(1)!;
    const muzzle = rig.muzzle();
    battle.update(0.04);
    expect(rig.muzzle().distanceTo(muzzle)).toBeLessThan(1e-8);
  });

  it.each(['bullet', 'laser', 'shell'] as const)('%s varies each shot slightly, agrees across clients and matches its exterior impact', weaponKind => {
    const a = fixture(); const b = fixture();
    const points: THREE.Vector3[] = [];
    for (let impactTick = 1; impactTick <= 8; impactTick++) {
      const input = { weaponKind, weaponId: weaponKind, from: { x: 0, y: 1 }, to: { x: 8, y: 0.7 }, targetId: 2, impactTick };
      const first = a.battle.shot(1, input);
      const second = b.battle.shot(1, JSON.parse(JSON.stringify(input)));
      const point = new THREE.Vector3(first.to.x, first.to.y, first.to.z ?? 0);
      expect(first.to).toEqual(second.to);
      expect(point.distanceTo(a.target.position)).toBeGreaterThan(0.6);
      const impact = a.battle.impact(1, { ...input, at: input.to, hit: true, groundY: 0 });
      expect(impact.at).toEqual(first.to);
      expect(impact.normal).toBeDefined();
      points.push(point);
      a.battle.update(1); b.battle.update(1);
    }
    expect(new Set(points.map(p => p.toArray().join(','))).size).toBe(8);
    // Across repeated shots, the small scatter stays on the same surface patch.
    for (const point of points.slice(1)) expect(point.distanceTo(points[0]!)).toBeLessThan(0.17);
  });

  it('a server-confirmed miss produces a ground impact, not a false hit on the victim', () => {
    const { battle } = fixture();
    battle.shot(1, { from: { x: 0, y: 1 }, to: { x: 8, y: 0.7 }, targetId: 2, impactTick: 7 });
    const result = battle.impact(1, { at: { x: 8, y: 0.4 }, targetId: 2, impactTick: 7, hit: false, groundY: -2 });
    expect(result.at.y).toBe(-2);
  });
});

describe('pooled combat effects', () => {
  it('attaches a gun flash to its socket and excludes laser discharges', () => {
    const { battle } = fixture();
    const vfx = new ProjectileVfxSystem();
    vfx.onProjectileFired(battle.shot(1, { weaponKind: 'bullet', from: { x: 0, y: 1 }, to: { x: 8, y: 1 } }));
    expect(vfx.getBurstCounts()['combat.muzzle']).toBe(10);
    vfx.clear();
    vfx.onProjectileFired(battle.shot(1, { weaponKind: 'laser', from: { x: 0, y: 1 }, to: { x: 8, y: 1 } }));
    expect(vfx.getBurstCounts()['combat.muzzle']).toBe(0);
    vfx.dispose();
  });

  it('traces artillery and gives rockets and shells distinct bounded bursts which expire and clear', () => {
    const vfx = new ProjectileVfxSystem();
    vfx.onProjectileFired({ weaponKind: 'shell', from: { x: 0, y: 1 }, to: { x: 8, y: 0.7 }, durationS: 1 });
    vfx.update(0.1);
    expect(vfx.getArtilleryTrailCount()).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      vfx.onProjectileImpact({ weaponKind: 'rocket', at: { x: 8, y: 0 }, aoe: 2 });
      vfx.onProjectileImpact({ weaponKind: 'shell', at: { x: 8, y: 0 }, aoe: 2 });
    }
    expect(vfx.getBurstCounts()['combat.rocket']).toBe(40 * 6);
    expect(vfx.getBurstCounts()['combat.artillery']).toBe(50 * 6);
    expect(vfx.getActiveAoeDecals()).toHaveLength(0);
    vfx.clear();
    expect(Object.values(vfx.getBurstCounts()).every(n => n === 0)).toBe(true);
    expect(vfx.getArtilleryTrailCount()).toBe(0);
    vfx.onProjectileImpact({ weaponKind: 'rocket', at: { x: 8, y: 0 } });
    for (let i = 0; i < 180; i++) vfx.update(1 / 60);
    expect(Object.values(vfx.getBurstCounts()).every(n => n === 0)).toBe(true);
    vfx.dispose();
  });

  it('burst validation still rejects missing roles, monochrome matter and low HDR accents', () => {
    const preset = ParticlePresetRegistry.get('combat.rocket')!;
    const bad = { ...preset, layers: preset.layers.map(l => ({ ...l, color: 0x555555, emissiveIntensity: 0 })) };
    const codes = validateParticlePreset(bad).issues.map(issue => issue.code);
    expect(codes).toContain('LOW_LAYER_CONTRAST');
    expect(codes).toContain('EMISSIVE_TOO_LOW');
    expect(validateParticlePreset({ ...preset, layers: preset.layers.filter(l => l.role !== 'primary') }).errors).toBeGreaterThan(0);
  });

  it('ejecta stay outside the impact plane and above a negative-height terrain plane', () => {
    const spec = ParticlePresetRegistry.get('combat.impact')!.layers[0]!;
    const layer = new BurstLayer(spec, new THREE.Group(), 'test');
    layer.emit({ at: new THREE.Vector3(0, -1, 0), normal: new THREE.Vector3(-1, 0, 0), groundY: -2 }, () => 0.5);
    const matrix = new THREE.Matrix4();
    for (let frame = 0; frame < 20; frame++) {
      layer.update(1 / 60);
      for (let i = 0; i < spec.count; i++) {
        layer.mesh.getMatrixAt(i, matrix);
        const point = new THREE.Vector3().setFromMatrixPosition(matrix);
        expect(point.x).toBeLessThan(0);
        expect(point.y).toBeGreaterThanOrEqual(-2);
      }
    }
    layer.dispose();
  });
});
