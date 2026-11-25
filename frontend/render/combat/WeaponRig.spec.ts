import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh, stripBuildingPlinth, tickArchetypeMesh } from '../kitbash';
import { BattlePresentation } from './BattlePresentation';
import { CombatShotCoordinator } from './CombatShotCoordinator';
import { WeaponRig } from './WeaponRig';
import { stampWeaponRig, WeaponRigRegistry } from './weaponRigs';
import { computeBarrelTipHeatMask } from './weaponShader';
import { ProjectileVfxSystem } from '../visuals/projectiles';

const IDS = ['building.turret', 'building.laserTower', 'robot.recon', 'robot.combat', 'robot.tank', 'robot.artillery'];

describe('weapon rigs and shot origins', () => {
  it('the armored scout aims its turret without turning its six-wheel chassis', () => {
    const mesh = createArchetypeMesh('robot.recon');
    mesh.rotation.y = 0.4;
    const rig = new WeaponRig(mesh, WeaponRigRegistry.get('robot.recon')!);
    for (const target of [new THREE.Vector3(-4, 1, 0), new THREE.Vector3(4, 1, -3)]) {
      rig.fire(target);
      expect(rig.direction().dot(target.clone().sub(rig.muzzle()).normalize())).toBeCloseTo(1, 7);
      rig.update(0.08);
      expect(mesh.rotation.y).toBe(0.4);
      expect(rig.direction().dot(target.clone().sub(rig.muzzle()).normalize())).toBeGreaterThan(0.9999);
      rig.update(0.5);
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
    const isMultiTubePod = id === 'robot.tank' || id === 'robot.combat';
    for (const target of [new THREE.Vector3(-8, 0.6, -10), new THREE.Vector3(10, 4, 12), new THREE.Vector3(2, 0.5, 12)]) {
      const { barrel, from } = rig.fire(target);
      expect(rig.direction(barrel).dot(target.clone().sub(from).normalize())).toBeCloseTo(1, isMultiTubePod ? 4 : 7);
      const expected = new THREE.Vector3(...rig.definition.sockets[barrel]!.muzzle);
      expected.y -= mesh.geometry.userData.stripOffsetY ?? 0;
      expected.applyMatrix4(rig.matrices[barrel + 1]!).applyMatrix4(mesh.matrixWorld);
      expect(from.distanceTo(expected)).toBeLessThan(1e-8);
      expect(rig.matrices[barrel + 1]!.determinant()).toBeCloseTo(1, 7);
      rig.update(0.08);
      expect(rig.direction(barrel).dot(target.clone().sub(rig.muzzle(barrel)).normalize())).toBeGreaterThan(0.9999);
      rig.update(0.6);
      expect(rig.direction(barrel).dot(target.clone().sub(rig.muzzle(barrel)).normalize())).toBeCloseTo(1, isMultiTubePod ? 4 : 7);
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
    expect(visible.fragmentShader).toContain('vWeaponHeat');
    expect(visible.fragmentShader).toContain('vWeaponTipDist');
    expect(visible.fragmentShader).toContain('vWeaponTipSpan');
    expect(visible.uniforms).toHaveProperty('uWeaponLeftMuzzle');
    expect(visible.uniforms).toHaveProperty('uWeaponRightMuzzle');
    expect(visible.uniforms).toHaveProperty('uWeaponSideHeat');
    expect(visible.vertexShader).toContain('spinMat');
  });
});

describe('/boost spider, rocket pod, recon & finite-speed slewing upgrades', () => {
  it('reworks robot.artillery, rocket spider bots, and recon scout wheels, radar, headlamps & barrel heat', () => {
    const artMesh = createArchetypeMesh('robot.artillery');
    const artDef = WeaponRigRegistry.get('robot.artillery')!;
    const artRanges = artMesh.geometry.userData.partRanges as { name: string }[];
    expect(artDef.sockets).toHaveLength(1);
    expect(artRanges.some(p => p.name === 'cannon barrel')).toBe(true);
    expect(artRanges.filter(p => p.name === 'front headlamp bulb light')).toHaveLength(2);
    expect(artRanges.some(p => p.name === 'visor sensor')).toBe(false);

    const artRig = new WeaponRig(artMesh, artDef);
    artRig.fire(new THREE.Vector3(0, 1, 8));
    const uArt = artMesh.userData.uniforms;
    expect(uArt.uWeaponCarrier.value).toBe(9);
    artRig.update(0.03);
    expect(uArt.uWeaponRecoilBody.value.w).toBeGreaterThan(0);
    expect(uArt.uWeaponHeat.value).toBeGreaterThan(0.4);
    expect(artRig.barrelHeat).toBeGreaterThan(0.4);
    artRig.update(0.6);
    expect(artRig.barrelHeat).toBeGreaterThan(0.3);
    artRig.update(1.7);
    expect(artRig.barrelHeat).toBeLessThan(0.2);

    const reconBreech = new WeaponRig(createArchetypeMesh('robot.recon'), WeaponRigRegistry.get('robot.recon')!);
    reconBreech.snapAim(new THREE.Vector3(6, 0.6, 0));
    const eject = reconBreech.ejectOrigin(0);
    expect(eject.pos.x).toBeGreaterThan(0);
    expect(eject.groundY).toBe(0);

    for (const rocketId of ['robot.tank', 'robot.combat'] as const) {
      const rocketMesh = createArchetypeMesh(rocketId);
      const rocketDef = WeaponRigRegistry.get(rocketId)!;
      const rocketRanges = rocketMesh.geometry.userData.partRanges as { name: string }[];
      expect(rocketDef.sockets).toHaveLength(8);
      expect(rocketDef.heatScale).toBe(0);
      expect(rocketRanges.some(p => p.name === 'cannon barrel')).toBe(false);
      expect(rocketRanges.some(p => p.name === 'rocket pod')).toBe(true);
      expect(rocketRanges.some(p => p.name === 'radar dish')).toBe(true);
      expect(rocketRanges.filter(p => p.name === 'front headlamp bulb light')).toHaveLength(2);
      const rig = new WeaponRig(rocketMesh, rocketDef);
      const leftMuzzle = rig.muzzle(0);
      const rightMuzzle = rig.muzzle(1);
      expect(leftMuzzle.x).toBeLessThan(-0.2);
      expect(rightMuzzle.x).toBeGreaterThan(0.2);
    }

    const reconMesh = createArchetypeMesh('robot.recon');
    const reconDef = WeaponRigRegistry.get('robot.recon')!;
    const reconRanges = reconMesh.geometry.userData.partRanges as { name: string }[];
    expect(reconRanges.filter(p => p.name === 'wheel tyre')).toHaveLength(6);
    expect(reconRanges.some(p => p.name === 'recon radar dish')).toBe(true);
    expect(reconDef.head).toContain('recon radar dish');
    const colorAttr = reconMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const tyreRange = reconRanges.find(p => p.name === 'wheel tyre') as { start: number; count: number; name: string };
    expect(colorAttr.getX(tyreRange.start)).toBeLessThan(0.08);
    expect(colorAttr.getY(tyreRange.start)).toBeLessThan(0.08);
    expect(colorAttr.getZ(tyreRange.start)).toBeLessThan(0.08);
  });

  it('turrets and recon rotate smoothly at finite speed without teleporting and hold alignment until on-line', () => {
    for (const id of ['building.turret', 'building.laserTower', 'robot.recon']) {
      const mesh = createArchetypeMesh(id);
      const rig = new WeaponRig(mesh, WeaponRigRegistry.get(id)!);
      const firstTarget = new THREE.Vector3(0, 1, 10);
      const sideTarget = new THREE.Vector3(10, 1, 0);
      rig.snapAim(firstTarget);
      rig.update(0.016);
      expect(rig.hasSlewed).toBe(true);
      const initialYaw = rig.currentYaw;
      expect(rig.isAligned(sideTarget)).toBe(false);

      rig.aim(sideTarget);
      rig.update(0.02);
      const partialYaw = rig.currentYaw;
      expect(partialYaw).toBeGreaterThan(initialYaw);
      expect(partialYaw).toBeLessThan(Math.PI / 2 - 0.1);
      expect(rig.isAligned(sideTarget)).toBe(false);

      for (let i = 0; i < 40; i++) rig.update(0.025);
      expect(rig.isAligned(sideTarget)).toBe(true);
      expect((mesh.userData as { turretYaw?: number }).turretYaw).toBeCloseTo(rig.currentYaw, 5);

      const yawBeforeLoseTarget = rig.currentYaw;
      rig.aim(null);
      rig.update(0.15);
      expect(Math.abs(rig.currentYaw)).toBeLessThan(Math.abs(yawBeforeLoseTarget));
      expect(Math.abs(rig.currentYaw)).toBeGreaterThan(0.1);
      for (let i = 0; i < 40; i++) rig.update(0.05);
      expect(rig.currentYaw).toBeCloseTo(0, 5);
      expect((mesh.userData as { turretYaw?: number }).turretYaw).toBeCloseTo(0, 5);
    }
  });
});

describe('turret return-to-default on target loss', () => {
  it('returns every unit and turret rig smoothly along shortest yaw arc to default forward pose when losing targets', () => {
    for (const id of IDS) {
      for (const rearTarget of [new THREE.Vector3(-4, 2.2, -9), new THREE.Vector3(4, -0.4, -9)]) {
        const mesh = createArchetypeMesh(id);
        if (id.startsWith('building.')) stripBuildingPlinth(mesh);
        const rig = new WeaponRig(mesh, WeaponRigRegistry.get(id)!);
        rig.snapAim(rearTarget);
        rig.update(0.016);
        const startYaw = rig.currentYaw;
        expect(Math.abs(startYaw)).toBeGreaterThan(2.0);

        rig.aim(null);
        let prevAbs = Math.abs(startYaw);
        for (let step = 0; step < 30; step++) {
          rig.update(0.05);
          const curAbs = Math.abs(rig.currentYaw);
          expect(curAbs).toBeLessThanOrEqual(prevAbs + 1e-6);
          if (curAbs > 1e-4) expect(Math.sign(rig.currentYaw)).toBe(Math.sign(startYaw));
          prevAbs = curAbs;
        }
        expect(rig.currentYaw).toBeCloseTo(0, 6);
        expect((mesh.userData as { turretYaw?: number }).turretYaw).toBeCloseTo(0, 6);
        const forward = rig.direction(0);
        expect(forward.x).toBeCloseTo(0, 5);
        expect(forward.z).toBeCloseTo(1, 5);

        // Acquiring a fresh target after resting still slews at finite speed rather than teleporting.
        rig.aim(new THREE.Vector3(8, 1, 0));
        rig.update(0.02);
        expect(rig.currentYaw).toBeGreaterThan(0);
        expect(rig.currentYaw).toBeLessThan(Math.PI / 2 - 0.2);
      }
    }
  });
});

describe('barrel tip heating', () => {
  it('heats only the very end of the gun barrel, leaving the tube, cooling collars, evacuator and mantlet cool', () => {
    const cases: Array<{ id: string; strip?: boolean; coolParts: string[]; hotEndZ: number }> = [
      { id: 'robot.artillery', coolParts: ['cannon barrel', 'bore evacuator'], hotEndZ: 1.15 },
      { id: 'robot.recon', coolParts: ['recon gun mantlet', 'recon cannon barrel'], hotEndZ: 0.90 },
      { id: 'building.turret', strip: true, coolParts: ['autocannon barrel', 'barrel cooling collar', 'muzzle accelerator tube'], hotEndZ: 1.67 },
    ];

    for (const c of cases) {
      const mesh = createArchetypeMesh(c.id);
      const ranges = mesh.geometry.userData.partRanges as { name: string; start: number; count: number }[];
      const unstrippedPos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const partBoxes = new Map<string, { minZ: number; maxZ: number; midY: number }>();
      for (const name of c.coolParts) {
        const range = ranges.find(r => r.name === name)!;
        expect(range).toBeDefined();
        let minZ = Infinity;
        let maxZ = -Infinity;
        let sumY = 0;
        for (let i = range.start; i < range.start + range.count; i++) {
          const z = unstrippedPos.getZ(i);
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
          sumY += unstrippedPos.getY(i);
        }
        partBoxes.set(name, { minZ, maxZ, midY: sumY / range.count });
      }
      if (c.strip) stripBuildingPlinth(mesh);
      const rigDef = WeaponRigRegistry.get(c.id)!;
      const rig = new WeaponRig(mesh, rigDef);
      rig.fire(new THREE.Vector3(0, 1, 10));
      rig.update(0.01);

      const offsetY = (mesh.geometry.userData.stripOffsetY as number | undefined) ?? 0;
      const sock = rigDef.sockets[0]!;
      const pivot = { x: sock.pivot[0], y: sock.pivot[1], z: sock.pivot[2] };
      const muzzle = { x: sock.muzzle[0], y: sock.muzzle[1], z: sock.muzzle[2] };

      for (const name of c.coolParts) {
        const box = partBoxes.get(name)!;
        const midZ = (box.minZ + box.maxZ) * 0.5;
        const sampleY = box.midY - offsetY;
        expect(computeBarrelTipHeatMask({ x: sock.pivot[0], y: sampleY, z: box.minZ }, pivot, muzzle, offsetY)).toBe(0);
        expect(computeBarrelTipHeatMask({ x: sock.pivot[0], y: sampleY, z: midZ }, pivot, muzzle, offsetY)).toBe(0);
      }

      const tipMask = computeBarrelTipHeatMask(
        { x: sock.muzzle[0], y: sock.muzzle[1] - offsetY, z: c.hotEndZ },
        pivot,
        muzzle,
        offsetY,
      );
      expect(tipMask).toBeCloseTo(1, 5);
      const tubeRearZ = sock.pivot[2] + (sock.muzzle[2] - sock.pivot[2]) * 0.70;
      expect(
        computeBarrelTipHeatMask({ x: sock.muzzle[0], y: sock.muzzle[1] - offsetY, z: tubeRearZ }, pivot, muzzle, offsetY),
      ).toBe(0);
    }
  });

  it('tracks dual-barrel tip heat per side on building.turret and guards degenerate zero-length barrels', () => {
    const turret = createArchetypeMesh('building.turret');
    const turretRig = new WeaponRig(turret, WeaponRigRegistry.get('building.turret')!);
    const uTurret = turret.userData.uniforms;
    turretRig.fire(new THREE.Vector3(0, 1.5, 10));
    expect(turretRig.barrelHeatFor(0)).toBeGreaterThan(0.3);
    expect(turretRig.barrelHeatFor(1)).toBe(0);
    expect(uTurret.uWeaponSideHeat.value.x).toBeCloseTo(1, 5);
    expect(uTurret.uWeaponSideHeat.value.y).toBe(0);
    turretRig.fire(new THREE.Vector3(0, 1.5, 10));
    expect(turretRig.barrelHeatFor(1)).toBeGreaterThan(0.3);
    expect(uTurret.uWeaponSideHeat.value.y).toBeGreaterThan(0.9);
    turretRig.reset();
    expect(turretRig.barrelHeat).toBe(0);
    expect(uTurret.uWeaponSideHeat.value.x).toBe(1);
    expect(uTurret.uWeaponSideHeat.value.y).toBe(1);
    expect(Number.isFinite(computeBarrelTipHeatMask({ x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }))).toBe(true);
  });
});

describe('barrel tip plinth, side routing and cold rigs', () => {
  it('syncs uWeaponOffsetY on stripBuildingPlinth, aligns stampWeaponRig with explicit socket side, and keeps non-ballistic rigs cold', () => {
    const turret = createArchetypeMesh('building.turret');
    expect(turret.userData.uniforms.uWeaponOffsetY.value).toBe(0);
    stripBuildingPlinth(turret);
    const stripOffset = turret.geometry.userData.stripOffsetY as number;
    expect(stripOffset).toBeGreaterThan(0.1);
    expect(turret.userData.uniforms.uWeaponOffsetY.value).toBeCloseTo(stripOffset, 6);

    // Constructing a WeaponRig onto an already-stripped mesh also initializes uWeaponOffsetY immediately
    turret.userData.uniforms.uWeaponOffsetY.value = 0;
    new WeaponRig(turret, WeaponRigRegistry.get('building.turret')!);
    expect(turret.userData.uniforms.uWeaponOffsetY.value).toBeCloseTo(stripOffset, 6);

    // Explicit side: 1 single-socket definition stamps barrel slot 3 (matching uWeaponSideHeat.y)
    const rightSideMesh = createArchetypeMesh('robot.recon');
    const reconDef = WeaponRigRegistry.get('robot.recon')!;
    const rightOnlyDef = { ...reconDef, sockets: [{ ...reconDef.sockets[0]!, side: 1 as const }] };
    stampWeaponRig(rightSideMesh.geometry, rightOnlyDef);
    const rightSlots = Array.from(rightSideMesh.geometry.getAttribute('aWeaponPart').array);
    expect(rightSlots.some(v => v === 3)).toBe(true);
    expect(rightSlots.some(v => v === 2)).toBe(false);
    const rightRig = new WeaponRig(rightSideMesh, rightOnlyDef);
    rightRig.fire(new THREE.Vector3(0, 1, 10));
    expect(rightRig.barrelHeatFor(0)).toBeGreaterThan(0.2);
    expect(rightSideMesh.userData.uniforms.uWeaponSideHeat.value.x).toBe(0);
    expect(rightSideMesh.userData.uniforms.uWeaponSideHeat.value.y).toBeCloseTo(1, 5);

      for (const coldId of ['robot.tank', 'robot.combat', 'building.laserTower'] as const) {
      const m = createArchetypeMesh(coldId);
      const rig = new WeaponRig(m, WeaponRigRegistry.get(coldId)!);
      rig.fire(new THREE.Vector3(0, 1, 10));
      rig.update(0.02);
      expect(rig.barrelHeat).toBe(0);
      expect(m.userData.uniforms.uWeaponHeat.value).toBe(0);
      expect(m.userData.uniforms.uWeaponHeatScale.value).toBe(0);
    }
  });

  it('exposes cartridge ejection ports in turret heads and computes two-way and scaled eject origins', () => {
    const turretMesh = createArchetypeMesh('building.turret');
    const turretParts = turretMesh.geometry.userData.partRanges as { name: string }[];
    expect(turretParts.filter(p => p.name === 'ejection port opening')).toHaveLength(2);
    expect(turretParts.filter(p => p.name === 'ejection port hood')).toHaveLength(2);
    const turretDef = WeaponRigRegistry.get('building.turret')!;
    expect(turretDef.head).toContain('ejection port opening');
    expect(turretDef.head).toContain('ejection port hood');

    const turretRig = new WeaponRig(turretMesh, turretDef);
    turretRig.snapAim(new THREE.Vector3(0, 1.5, 10));
    const leftEject = turretRig.ejectOrigin(0);
    const rightEject = turretRig.ejectOrigin(1);
    expect(leftEject.pos.x).toBeLessThan(-0.4);
    expect(rightEject.pos.x).toBeGreaterThan(0.4);
    expect(leftEject.dir.dot(rightEject.dir)).toBeCloseTo(-1, 5);
    expect(Number.isFinite(turretRig.ejectOrigin(99).pos.x)).toBe(true);

    turretRig.snapAim(new THREE.Vector3(10, 1.5, 0));
    const turnedLeft = turretRig.ejectOrigin(0);
    const turnedRight = turretRig.ejectOrigin(1);
    expect(turnedLeft.dir.dot(turnedRight.dir)).toBeCloseTo(-1, 5);
    expect(Math.abs(turnedLeft.dir.z)).toBeGreaterThan(0.95);

    const artMesh = createArchetypeMesh('robot.artillery');
    const artParts = artMesh.geometry.userData.partRanges as { name: string }[];
    expect(artParts.filter(p => p.name === 'ejection port opening')).toHaveLength(1);
    const artRig = new WeaponRig(artMesh, WeaponRigRegistry.get('robot.artillery')!);
    expect(artRig.ejectOrigin(0).scale).toBeGreaterThan(turretRig.ejectOrigin(0).scale);

    const reconMesh = createArchetypeMesh('robot.recon');
    const reconParts = reconMesh.geometry.userData.partRanges as { name: string }[];
    expect(reconParts.filter(p => p.name === 'ejection port opening')).toHaveLength(1);
    const reconRig = new WeaponRig(reconMesh, WeaponRigRegistry.get('robot.recon')!);
    expect(turretRig.ejectOrigin(0).scale).toBeGreaterThan(reconRig.ejectOrigin(0).scale);
  });
});

describe('robot.recon gyro-stabilized move-and-fire turret', () => {
  it('gyro-stabilizes robot.recon turret on a flank target while driving and cornering and fires 3-round bursts from the moving muzzle', () => {
    const reconMesh = createArchetypeMesh('robot.recon');
    const targetMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    targetMesh.position.set(6, 0.8, 8);

    const battle = new BattlePresentation(id => (id === 1 ? reconMesh : id === 2 ? targetMesh : undefined));
    const vfx = new ProjectileVfxSystem();
    const shots = new CombatShotCoordinator(battle, vfx, id => (id === 1 ? reconMesh : id === 2 ? targetMesh : undefined));
    battle.sync({ byEntityId: { 1: { targetId: 2 } } });

    reconMesh.position.set(0, 0, 0);
    reconMesh.rotation.y = 0.2;
    battle.update(0.05);
    const rig = battle.getRig(1)!;
    // Let turret lock initially while chassis corners smoothly
    for (let i = 0; i < 8; i++) {
      reconMesh.position.x += 0.25;
      reconMesh.rotation.y += 0.14;
      tickArchetypeMesh(reconMesh, i * 0.05, 1.0, 0);
      battle.update(0.05);
    }
    const desiredDir = targetMesh.position.clone().sub(rig.muzzle()).normalize();
    expect(rig.direction().dot(desiredDir)).toBeGreaterThan(0.985);
    expect(Math.abs(rig.currentYaw)).toBeGreaterThan(0.2);

    const expectedChassisYaw = reconMesh.rotation.y;
    const shotInput = {
      weaponKind: 'bullet' as const,
      weaponId: 'reconGun',
      from: reconMesh.position.clone(),
      to: targetMesh.position.clone(),
      targetId: 2,
      firedTick: 10,
      speed: 40,
    };
    expect(shots.isReadyToFire(1, shotInput)).toBe(true);
    shots.dispatchShot(1, shotInput);
    expect(reconMesh.rotation.y).toBeCloseTo(expectedChassisYaw, 6);

    let maxProjectiles = 0;
    for (let i = 0; i < 6; i++) {
      reconMesh.position.x += 0.25;
      targetMesh.position.z += 0.12;
      tickArchetypeMesh(reconMesh, 0.5 + i * 0.04, 1.0, 0);
      battle.update(0.04);
      shots.update(0.04);
      vfx.update(0.04);
      maxProjectiles = Math.max(maxProjectiles, vfx.getActiveCounts().projectiles);
    }
    expect(maxProjectiles).toBeGreaterThanOrEqual(2);
    expect(reconMesh.rotation.y).toBeCloseTo(expectedChassisYaw, 6);

    battle.sync({ byEntityId: { 1: { targetId: null } } });
    for (let i = 0; i < 40; i++) battle.update(0.05);
    expect(rig.currentYaw).toBeCloseTo(0, 5);
    vfx.dispose();
  });
});
