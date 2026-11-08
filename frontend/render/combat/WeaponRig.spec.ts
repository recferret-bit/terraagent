import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh, stripBuildingPlinth, tickArchetypeMesh } from '../kitbash';
import { BattlePresentation } from './BattlePresentation';
import { WeaponRig } from './WeaponRig';
import { WeaponRigRegistry } from './weaponRigs';
import { ProjectileVfxSystem } from '../visuals/projectiles';

const IDS = ['building.turret', 'building.laserTower', 'robot.recon', 'robot.combat', 'robot.hero'];

describe('weapon rigs and shot origins', () => {
  it('the armored scout aims its turret without turning its six-wheel chassis', () => {
    const mesh = createArchetypeMesh('robot.recon');
    mesh.rotation.y = 0.4;
    const rig = new WeaponRig(mesh, WeaponRigRegistry.get('robot.recon')!);
    for (const target of [new THREE.Vector3(-4, 1, 0), new THREE.Vector3(4, 1, -3)]) {
      rig.fire(target);
      rig.update(0.08);
      expect(mesh.rotation.y).toBe(0.4);
      expect(rig.direction().dot(target.sub(rig.muzzle()).normalize())).toBeCloseTo(1, 7);
    }
    const ranges = mesh.geometry.userData.partRanges as { name: string }[];
    expect(ranges.filter(part => part.name === 'wheel tyre')).toHaveLength(6);
  });

  it.each(IDS)('%s aligns every barrel with targets in all quadrants, through recoil and chassis motion', id => {
    const mesh = createArchetypeMesh(id);
    mesh.position.set(3, 2.4, -5);
    mesh.rotation.y = 1.3;
    tickArchetypeMesh(mesh, 1.7, 0.8, 0);
    if (id.startsWith('building.')) stripBuildingPlinth(mesh);
    const rig = new WeaponRig(mesh, WeaponRigRegistry.get(id)!);
    const tags = Array.from(mesh.geometry.getAttribute('aWeaponPart').array);
    expect(tags.some(t => t === 2)).toBe(true);
    for (const target of [new THREE.Vector3(-8, 0.6, -10), new THREE.Vector3(10, 4, 12), new THREE.Vector3(2, 0.5, 12)]) {
      const { barrel, from } = rig.fire(target);
      expect(rig.direction(barrel).dot(target.clone().sub(from).normalize())).toBeCloseTo(1, 7);
      const expected = new THREE.Vector3(...rig.definition.sockets[barrel]!.muzzle);
      expected.y -= mesh.geometry.userData.stripOffsetY ?? 0;
      expected.applyMatrix4(rig.matrices[barrel + 1]!).applyMatrix4(mesh.matrixWorld);
      expect(from.distanceTo(expected)).toBeLessThan(1e-8);
      expect(rig.matrices[barrel + 1]!.determinant()).toBeCloseTo(1, 7);
      rig.update(0.08);
      expect(rig.direction(barrel).dot(target.clone().sub(rig.muzzle(barrel)).normalize())).toBeCloseTo(1, 7);
    }
  });

  it('keeps a laser attached to its recoiling barrel as the shooter moves', () => {
    const mesh = createArchetypeMesh('building.laserTower');
    const battle = new BattlePresentation(id => id === 1 ? mesh : undefined);
    const vfx = new ProjectileVfxSystem();
    const shot = battle.shot(1, { weaponKind: 'laser', from: { x: 0, y: 0, z: 0 }, to: { x: -8, y: 0.6, z: -6 } });
    vfx.onProjectileFired(shot);
    mesh.position.x += 0.2;
    battle.update(0.05);
    vfx.update(0.05);
    const beam = vfx.getActiveLasers()[0]!;
    const muzzle = battle.getRig(1)!.muzzle();
    expect(new THREE.Vector3(beam.fromX, beam.fromY, beam.fromZ).distanceTo(muzzle)).toBeLessThan(1e-8);
    vfx.dispose();
  });

  it('artillery leaves along the barrel axis at the tangent of its ballistic arc', () => {
    const mesh = createArchetypeMesh('robot.artillery');
    const battle = new BattlePresentation(() => mesh);
    const shot = battle.shot(1, { weaponKind: 'shell', arc: 'indirect', from: { x: 0, y: 0 }, to: { x: -10, y: 0.5, z: 7 } });
    const delta = new THREE.Vector3(shot.to.x - shot.from.x, shot.to.y - shot.from.y + 4 * shot.arcHeight!, shot.to.z! - shot.from.z!);
    expect(battle.getRig(1)!.direction().dot(delta.normalize())).toBeCloseTo(1, 6);
  });

  it('visible and shadow shaders use the same rig matrices and rotate surface normals', () => {
    const mesh = createArchetypeMesh('building.turret');
    const plain = createArchetypeMesh('fauna.blackAnt');
    expect((mesh.material as THREE.Material).customProgramCacheKey()).not.toBe((plain.material as THREE.Material).customProgramCacheKey());
    expect(mesh.customDepthMaterial!.customProgramCacheKey()).not.toBe(plain.customDepthMaterial!.customProgramCacheKey());
    const compile = (material: THREE.Material, lib: typeof THREE.ShaderLib.standard) => {
      const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
      return shader;
    };
    const visible = compile(mesh.material as THREE.Material, THREE.ShaderLib.standard);
    const shadow = compile(mesh.customDepthMaterial!, THREE.ShaderLib.depth);
    expect(visible.vertexShader).toContain('mat3(weaponTransform()) * objectNormal');
    for (const shader of [visible, shadow]) {
      expect(shader.vertexShader).toContain('(weaponTransform() * vec4(position, 1.0)).xyz');
      expect(shader.uniforms).toHaveProperty('uWeaponLeftPivot');
    }
  });
});
