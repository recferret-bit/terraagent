import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ProjectileVfxSystem } from './index';
import { createArchetypeMesh } from '../../kitbash';
import { BattlePresentation } from '../../combat/BattlePresentation';
import { ProceduralTextureRegistry } from '../ProceduralTextureRegistry';
import { sampleShellCraterPixel } from '../shellCraterTexture';
import { getColonyVisionUniforms } from '../../lighting';

describe('mechanical death explosions (bot & building fire, smoke, shockwave, crater clearing & smolder)', () => {
  it('emitBotDeath and emitBuildingDeath spawn fire/debris bursts, smoke plumes, dual shockwaves, dynamic lights & smolder without spawning solid aoeDecal disks', () => {
    const vfx = new ProjectileVfxSystem();
    const u = getColonyVisionUniforms();

    vfx.emitBotDeath({ at: { x: 2, y: 0.5, z: -3 }, groundY: 0, scale: 1 });
    expect(vfx.getBurstCounts()['combat.botDeath']).toBeGreaterThan(0);
    const botCounts = vfx.getActiveCounts();
    expect(botCounts.shockwaves).toBe(2);
    expect(botCounts.impacts).toBe(1);
    expect(botCounts.aoeDecals).toBe(0);
    expect(botCounts.smokePuffs).toBeGreaterThanOrEqual(5);
    expect(vfx.getSmolderSiteCount()).toBe(1);
    expect(u.uProjectorCount.value).toBeGreaterThanOrEqual(1);

    // Building blast scales bigger & adds its own dual shockwaves + clears pre-existing ground craters
    vfx.onProjectileImpact({ weaponKind: 'rocket', weaponId: 'tankRocket', at: { x: -4, y: 0.1, z: 5 }, groundY: 0 });
    expect(vfx.getActiveCounts().craters).toBe(1);
    vfx.emitBuildingDeath({ at: { x: -4, y: 0.8, z: 5 }, groundY: 0, scale: 1.5 });
    expect(vfx.getBurstCounts()['combat.buildingDeath']).toBeGreaterThan(0);
    expect(vfx.getActiveCounts().shockwaves).toBe(4);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);
    expect(vfx.getActiveCounts().craters).toBe(0);
    expect(vfx.getSmolderSiteCount()).toBe(2);

    // Insect & hive deaths clear ground craters and never spawn solid green cylinder aoeDecal disks
    vfx.onProjectileImpact({ weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 8, y: 0.1, z: 8 }, groundY: 0, aoe: 2 });
    expect(vfx.getActiveCounts().craters).toBe(1);
    vfx.emitInsectDeath({ at: { x: 8, y: 0.4, z: 8 }, groundY: 0, scale: 1 });
    vfx.emitInsectDeath({ at: { x: 8.4, y: 0.55, z: 8.2 }, groundY: 0, scale: 1.85 });
    expect(vfx.getBurstCounts()['combat.insectDeath']).toBeGreaterThan(0);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);
    expect(vfx.getActiveCounts().craters).toBe(0);

    // Stepping 1.0s fades out transient shockwaves & emits follow-up smolder smoke
    for (let i = 0; i < 10; i++) vfx.update(0.1);
    expect(vfx.getActiveCounts().shockwaves).toBe(0);
    expect(vfx.getSmolderSiteCount()).toBe(2);

    // Stepping another 4.0s expires smolder sites cleanly
    for (let i = 0; i < 40; i++) vfx.update(0.1);
    expect(vfx.getSmolderSiteCount()).toBe(0);

    // Clear resets shockwaves, decals, bursts and smolder state
    vfx.emitBotDeath({ at: { x: 0, y: 0.5, z: 0 }, groundY: 0 });
    expect(vfx.getActiveCounts().shockwaves).toBe(2);
    vfx.clear();
    expect(vfx.getActiveCounts().shockwaves).toBe(0);
    expect(vfx.getSmolderSiteCount()).toBe(0);

    vfx.dispose();
  });

  it('ejects oversized brass casings for artillery spider and two-way left/right casings for gun tower', () => {
    const readScaleAndPos = (vfx: ProjectileVfxSystem, idx: number) => {
      const mesh = vfx.group.children.find(c => (c as THREE.InstancedMesh).count === 96 && c.name !== 'projectile-ground-craters') as THREE.InstancedMesh;
      const mat = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      mesh.getMatrixAt(idx, mat);
      mat.decompose(pos, quat, scale);
      return { pos, scale: scale.x };
    };

    const artMesh = createArchetypeMesh('robot.artillery');
    const bug = createArchetypeMesh('fauna.blueBeetle');
    bug.position.set(0, 0, 12);
    const artBattle = new BattlePresentation(id => (id === 1 ? artMesh : id === 2 ? bug : undefined));
    const artVfx = new ProjectileVfxSystem();
    const artShot = artBattle.shot(1, {
      weaponId: 'artilleryShell', weaponKind: 'shell', targetId: 2,
      from: { x: 0, y: 1.1, z: 0 }, to: { x: 0, y: 0.5, z: 12 },
    });
    artVfx.onProjectileFired(artShot);
    expect(artVfx.getActiveCounts().cartridges).toBe(1);
    const artCasing = readScaleAndPos(artVfx, 0);
    expect(artCasing.scale).toBeGreaterThanOrEqual(2.0);
    artVfx.dispose();

    const towerMesh = createArchetypeMesh('building.turret');
    const towerBattle = new BattlePresentation(id => (id === 1 ? towerMesh : id === 2 ? bug : undefined));
    const towerVfx = new ProjectileVfxSystem();
    const s0 = towerBattle.shot(1, { weaponId: 'autocannon', weaponKind: 'bullet', targetId: 2, from: { x: 0, y: 1.5, z: 0 }, to: { x: 0, y: 0.5, z: 12 } });
    const s1 = towerBattle.shot(1, { weaponId: 'autocannon', weaponKind: 'bullet', targetId: 2, from: { x: 0, y: 1.5, z: 0 }, to: { x: 0, y: 0.5, z: 12 } });
    towerVfx.onProjectileFired(s0);
    towerVfx.onProjectileFired(s1);
    expect(towerVfx.getActiveCounts().cartridges).toBe(2);
    towerVfx.update(0.08);
    const c0 = readScaleAndPos(towerVfx, 0);
    const c1 = readScaleAndPos(towerVfx, 1);
    expect(c0.scale).toBeCloseTo(1.45, 2);
    expect(c0.pos.x).toBeLessThan(-0.5);
    expect(c1.pos.x).toBeGreaterThan(0.5);
    towerVfx.dispose();
  });
});

describe('persistent shell craters & dustBurst plumes', () => {
  it('registers shellImpactCrater PBR texture and stamps persistent sized ground craters without touching aoeDecals', () => {
    const tex = ProceduralTextureRegistry.get('shellImpactCrater', 256);
    expect(tex.map).toBeDefined();
    expect(tex.normalMap).toBeDefined();
    expect(tex.roughnessMap).toBeDefined();
    expect(tex.map!.wrapS).toBe(THREE.ClampToEdgeWrapping);
    const corner = sampleShellCraterPixel(0, 0);
    const center = sampleShellCraterPixel(0.5, 0.5);
    const rim = sampleShellCraterPixel(0.74, 0.5);
    expect(corner.a).toBe(0);
    expect(center.a).toBeGreaterThan(200);
    expect(center.r).toBeLessThan(rim.r);

    const vfx = new ProjectileVfxSystem();
    vfx.onProjectileImpact({ weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 0, y: 0.1, z: 0 }, groundY: 0, aoe: 2 });
    vfx.onProjectileImpact({ weaponKind: 'rocket', weaponId: 'tankRocket', at: { x: 4, y: 0.1, z: 0 }, groundY: 0 });
    vfx.onProjectileImpact({ weaponKind: 'bullet', weaponId: 'autocannon', at: { x: 8, y: 0.1, z: 0 }, groundY: 0, hit: false });
    vfx.onProjectileImpact({ weaponKind: 'bullet', weaponId: 'reconGun', at: { x: 12, y: 0.1, z: 0 }, groundY: 0, hit: false });
    vfx.onProjectileImpact({ weaponKind: 'laser', weaponId: 'pulseLaser', at: { x: 16, y: 0.1, z: 0 }, groundY: 0 });
    vfx.onProjectileImpact({ weaponKind: 'acid', weaponId: 'spitterAcid', at: { x: 20, y: 0.1, z: 0 }, groundY: 0 });
    vfx.onProjectileImpact({ weaponKind: 'bullet', weaponId: 'autocannon', at: { x: 24, y: 0.9, z: 0 }, groundY: 0, hit: true, targetId: 7 });

    const craters = vfx.getActiveCraters();
    expect(craters).toHaveLength(4);
    expect(vfx.getActiveCounts().craters).toBe(4);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);
    expect(craters[0]!.radiusM).toBeGreaterThan(craters[1]!.radiusM);
    expect(craters[1]!.radiusM).toBeGreaterThan(craters[2]!.radiusM);
    expect(craters[2]!.radiusM).toBeGreaterThan(craters[3]!.radiusM);

    // Direct elevated hull hits AND autoImpactOnArrival burst rounds with targetId near y=0 must not stamp crater quads
    vfx.onProjectileImpact({ weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 30, y: 0.9, z: 0 }, groundY: 0, hit: true, targetId: 9 });
    vfx.onProjectileImpact({ weaponKind: 'rocket', weaponId: 'tankRocket', at: { x: 34, y: 0.9, z: 0 }, groundY: 0, hit: true, targetId: 10 });
    vfx.onProjectileFired({
      weaponKind: 'bullet',
      weaponId: 'reconGun',
      from: { x: 38, y: 0.5, z: 0 },
      to: { x: 40, y: 0.08, z: 0 },
      speed: 80,
      targetId: 11,
      targetIsInsect: true,
      autoImpactOnArrival: true,
    });
    vfx.update(0.2);
    expect(vfx.getActiveCounts().craters).toBe(4);

    // Owner-tagged wreck exclusion zones block ground craters beyond 12s until released
    vfx.clearCratersInRadius(50, 0, 2.0, 999);
    for (let i = 0; i < 150; i++) vfx.update(0.1);
    vfx.onProjectileImpact({ weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 50.2, y: 0.1, z: 0 }, groundY: 0 });
    expect(vfx.getActiveCounts().craters).toBe(4);
    vfx.releaseNoCraterZone(999);
    vfx.onProjectileImpact({ weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 50.2, y: 0.1, z: 0 }, groundY: 0 });
    expect(vfx.getActiveCounts().craters).toBe(5);
    for (let i = 0; i < 40; i++) vfx.update(0.1);

    expect(vfx.getActiveCraters()[0]!.ageS).toBeGreaterThan(11);
    expect(vfx.getBurstCounts()['combat.dustBurst']).toBe(0);

    vfx.clear();
    expect(vfx.getActiveCraters()).toHaveLength(0);
    vfx.dispose();
  });
});

describe('dustBurst plumes across projectile kinds', () => {
  it('emits sized dustBurst plumes on shell, rocket, and bullet impacts and excludes laser and acid', () => {
    const measureDustScale = (input: Parameters<ProjectileVfxSystem['onProjectileImpact']>[0]) => {
      const vfx = new ProjectileVfxSystem();
      vfx.onProjectileImpact(input);
      const count = vfx.getBurstCounts()['combat.dustBurst'] ?? 0;
      const mesh = vfx.group.children.find(c => c.name === 'combat.dustBurst/Billowing impact dust') as THREE.InstancedMesh | undefined;
      let scale = 0;
      if (mesh) {
        const mat = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        mesh.getMatrixAt(0, mat);
        mat.decompose(pos, quat, scl);
        scale = scl.x;
      }
      vfx.dispose();
      return { count, scale };
    };

    const shellDust = measureDustScale({ weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 0, y: 0.2, z: 0 }, groundY: 0 });
    const rocketDust = measureDustScale({ weaponKind: 'rocket', weaponId: 'tankRocket', at: { x: 0, y: 0.2, z: 0 }, groundY: 0 });
    const autocannonDust = measureDustScale({ weaponKind: 'bullet', weaponId: 'autocannon', at: { x: 0, y: 0.2, z: 0 }, groundY: 0 });
    const reconDust = measureDustScale({ weaponKind: 'bullet', weaponId: 'reconGun', at: { x: 0, y: 0.2, z: 0 }, groundY: 0 });
    const laserDust = measureDustScale({ weaponKind: 'laser', weaponId: 'pulseLaser', at: { x: 0, y: 0.2, z: 0 }, groundY: 0 });
    const acidDust = measureDustScale({ weaponKind: 'acid', weaponId: 'spitterAcid', at: { x: 0, y: 0.2, z: 0 }, groundY: 0 });

    expect(shellDust.count).toBe(24);
    expect(rocketDust.count).toBe(24);
    expect(autocannonDust.count).toBe(24);
    expect(reconDust.count).toBe(24);
    expect(laserDust.count).toBe(0);
    expect(acidDust.count).toBe(0);

    expect(shellDust.scale).toBeGreaterThan(rocketDust.scale);
    expect(rocketDust.scale).toBeGreaterThan(autocannonDust.scale);
    expect(autocannonDust.scale).toBeGreaterThan(reconDust.scale);
  });
});

describe('ProjectileVfxSystem — spawnFromSimImpactEvent targetId forwarding', () => {
  it('forwards targetId in spawnFromSimImpactEvent so direct entity hits skip ground crater disks', () => {
    const vfx = new ProjectileVfxSystem();
    vfx.spawnFromSimImpactEvent(
      {
        weaponKind: 'rocket',
        weaponId: 'tankRocket',
        targetId: 42,
        hit: true,
        q: 2,
        r: 1,
        aoe: 0,
      },
      () => 0,
      1.732,
      (inp) => ({ ...inp, at: { ...inp.at, y: 0.1 } }),
    );
    expect(vfx.getActiveCraters()).toHaveLength(0);

    vfx.spawnFromSimImpactEvent(
      {
        weaponKind: 'rocket',
        weaponId: 'tankRocket',
        hit: false,
        q: 3,
        r: 1,
        aoe: 0,
      },
      () => 0,
      1.732,
      (inp) => ({ ...inp, at: { ...inp.at, y: 0.1 } }),
    );
    expect(vfx.getActiveCraters()).toHaveLength(1);
    vfx.dispose();
  });
});
