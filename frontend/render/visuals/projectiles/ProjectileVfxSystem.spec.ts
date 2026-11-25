import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  axialToWorldVfxPoint,
  evalParabolicArcY,
  LASER_BEAM_DURATION_S,
  ProjectileVfxSystem,
  resolveVfxWeaponKind,
} from './index';
import { createArchetypeMesh } from '../../kitbash';
import { BattlePresentation } from '../../combat/BattlePresentation';
import { CombatShotCoordinator, computeBurstSpreadTargets } from '../../combat/CombatShotCoordinator';
import {
  getColonyVisionUniforms,
  resetColonyVisionAndLights,
  setDynamicHazardLights,
} from '../../lighting';

describe('ProjectileVfxSystem (W07-22)', () => {
  it('converts axial hex coordinates to world metres via axialToWorldVfxPoint', () => {
    const origin = axialToWorldVfxPoint(0, 0, 0.8, 2);
    expect(origin).toEqual({ x: 0, y: 0.8, z: 0 });

    const east = axialToWorldVfxPoint(3, 0, 0.6, 2);
    expect(east.x).toBeCloseTo(6, 5);
    expect(east.y).toBeCloseTo(0.6, 5);
    expect(east.z).toBeCloseTo(0, 5);

    const diag = axialToWorldVfxPoint(1, 2, 1.2, 2);
    expect(diag.x).toBeCloseTo(4, 5);
    expect(diag.y).toBeCloseTo(1.2, 5);
    expect(diag.z).toBeCloseTo(2 * Math.sqrt(3), 5);
  });

  it('resolves weapon kinds from weaponKind, weaponType, weaponId, and arc hints', () => {
    expect(resolveVfxWeaponKind({ weaponKind: 'laser' })).toBe('laser');
    expect(resolveVfxWeaponKind({ weaponId: 'spitterAcid', weaponType: 'bullet' })).toBe('acid');
    expect(resolveVfxWeaponKind({ weaponId: 'artilleryShell' })).toBe('shell');
    expect(resolveVfxWeaponKind({ arc: 'indirect' })).toBe('shell');
    expect(resolveVfxWeaponKind({ weaponId: 'tankRocket' })).toBe('rocket');
    expect(resolveVfxWeaponKind({ weaponType: 'bullet' })).toBe('bullet');
  });

  it('spawns a bullet tracer, steps linear flight, and triggers arrival impact at t >= 1', () => {
    const scene = new THREE.Group();
    const vfx = new ProjectileVfxSystem(scene);

    vfx.onProjectileFired({
      weaponKind: 'bullet',
      from: { x: 0, y: 0.6, z: 0 },
      to: { x: 10, y: 0.6, z: 0 },
      durationS: 0.4,
    });

    expect(vfx.getActiveCounts().projectiles).toBe(1);
    vfx.update(0.2);
    const active = vfx.getActiveProjectiles()[0]!;
    expect(active.t).toBeCloseTo(0.5, 5);
    expect(active.x).toBeCloseTo(5, 5);
    expect(active.y).toBeCloseTo(0.6, 5);

    vfx.update(0.25);
    expect(vfx.getActiveCounts().projectiles).toBe(0);
    expect(vfx.getActiveCounts().impacts).toBe(1);
    vfx.dispose();
  });

  it('evaluates shell parabolic arc with y(0.5) > max(y0, y1)', () => {
    const vfx = new ProjectileVfxSystem();
    const y0 = 0.6;
    const y1 = 1.4;

    vfx.onProjectileFired({
      weaponKind: 'shell',
      from: { x: 0, y: y0, z: 0 },
      to: { x: 16, y: y1, z: 4 },
      durationS: 1.0,
      aoe: 1.5,
    });

    vfx.update(0.5);
    const shell = vfx.getActiveProjectiles()[0]!;
    expect(shell.weaponKind).toBe('shell');
    expect(shell.t).toBeCloseTo(0.5, 5);
    expect(shell.y).toBeGreaterThan(Math.max(y0, y1));
    expect(shell.y).toBeCloseTo(evalParabolicArcY(y0, y1, shell.arcHeight, 0.5), 5);

    // Arrival triggers a layered artillery detonation; no expanding damage-radius circle.
    vfx.update(0.55);
    expect(vfx.getActiveCounts().projectiles).toBe(0);
    expect(vfx.getActiveCounts().impacts).toBe(1);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);
    expect(vfx.getBurstCounts()['combat.artillery']).toBe(50);
    vfx.dispose();
  });
});

describe('ProjectileVfxSystem — rockets, acid, lasers & impacts (W07-22)', () => {
  it('spawns rocket with pooled 3D smoke trail puffs along its flight path', () => {
    const vfx = new ProjectileVfxSystem();

    vfx.onProjectileFired({
      weaponKind: 'rocket',
      from: { x: 0, y: 0.7, z: 0 },
      to: { x: 12, y: 0.7, z: 0 },
      durationS: 0.5,
    });

    expect(vfx.getActiveCounts().projectiles).toBe(1);
    expect(vfx.getActiveCounts().smokePuffs).toBeGreaterThanOrEqual(1);

    vfx.update(0.08);
    expect(vfx.getActiveCounts().smokePuffs).toBeGreaterThanOrEqual(2);
    vfx.dispose();
  });

  it('spawns arcing luminous acid glob for greenSpitter shots', () => {
    const vfx = new ProjectileVfxSystem();
    const y0 = 0.5;
    const y1 = 0.7;

    vfx.onProjectileFired({
      weaponId: 'spitterAcid',
      from: { x: 0, y: y0, z: 0 },
      to: { x: 8, y: y1, z: 2 },
      durationS: 0.6,
    });

    vfx.update(0.3);
    const glob = vfx.getActiveProjectiles()[0]!;
    expect(glob.weaponKind).toBe('acid');
    expect(glob.y).toBeGreaterThan(Math.max(y0, y1));
    vfx.dispose();
  });

  it('spawns an instant 0.1 s laser beam and expires it after > 0.1 s', () => {
    const vfx = new ProjectileVfxSystem();

    vfx.onProjectileFired({
      weaponKind: 'laser',
      from: { x: 0, y: 0.8, z: 0 },
      to: { x: 8, y: 0.8, z: 4 },
    });

    expect(vfx.getActiveCounts().lasers).toBe(1);
    expect(vfx.getActiveLasers()[0]!.durationS).toBeCloseTo(LASER_BEAM_DURATION_S, 5);

    vfx.update(0.05);
    expect(vfx.getActiveCounts().lasers).toBe(1);

    vfx.update(0.06);
    expect(vfx.getActiveCounts().lasers).toBe(0);
    vfx.dispose();
  });

  it('spawns surface chips and artillery bursts instead of expanding AoE circles', () => {
    const vfx = new ProjectileVfxSystem();

    vfx.onProjectileImpact({
      weaponKind: 'bullet',
      at: { x: 2, y: 0.5, z: 2 },
      hit: true,
      aoe: 0,
    });
    expect(vfx.getActiveCounts().impacts).toBe(1);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);

    vfx.onProjectileImpact({
      weaponKind: 'shell',
      at: { x: 6, y: 0.5, z: -2 },
      hit: true,
      aoe: 2,
    });
    expect(vfx.getActiveCounts().impacts).toBe(2);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);
    expect(vfx.getBurstCounts()['combat.artillery']).toBe(50);
    vfx.dispose();
  });
});

describe('ProjectileVfxSystem — @terra/sim event compatibility (W07-22)', () => {
  it('handles exact @terra/sim W07-03 and W07-05 projectileFired and projectileImpact event shapes', () => {
    const vfx = new ProjectileVfxSystem();
    const heightAt = () => 1.0;

    // W07-03 projectileFired event wrapper (shell with AoE)
    vfx.spawnFromSimFiredEvent(
      {
        kind: 'projectileFired',
        data: {
          attackerId: 10,
          targetId: 22,
          weaponId: 'artilleryShell',
          weaponType: 'shell',
          arc: 'indirect',
          fromX: 0,
          fromY: 0,
          aimX: 4,
          aimY: 2,
          q: 0,
          r: 0,
          aimQ: 4,
          aimR: 2,
          speed: 6,
          flightTicks: 4,
          aoe: 1.5,
        },
      },
      heightAt,
    );

    expect(vfx.getActiveCounts().projectiles).toBe(1);
    const shell = vfx.getActiveProjectiles()[0]!;
    expect(shell.weaponKind).toBe('shell');
    expect(shell.fromY).toBeCloseTo(1.6, 5);
    expect(shell.durationS).toBeCloseTo(0.8, 5);

    // W07-05 laser projectileFired and projectileImpact direct payload shapes
    vfx.spawnFromSimFiredEvent(
      {
        weaponId: 'pulseLaser',
        weaponType: 'laser',
        fromX: 1,
        fromY: 1,
        aimX: 3,
        aimY: 1,
        speed: 0,
        flightTicks: 0,
        aoe: 0,
      },
      heightAt,
    );
    expect(vfx.getActiveCounts().lasers).toBe(1);

    vfx.spawnFromSimImpactEvent(
      {
        kind: 'projectileImpact',
        data: {
          weaponId: 'artilleryShell',
          weaponType: 'shell',
          aimX: 4,
          aimY: 2,
          q: 4,
          r: 2,
          hit: true,
          aoe: 1.5,
        },
      },
      heightAt,
    );
    expect(vfx.getActiveCounts().impacts).toBe(1);
    expect(vfx.getActiveCounts().aoeDecals).toBe(0);
    expect(vfx.getBurstCounts()['combat.artillery']).toBe(50);
    vfx.dispose();
  });
});

describe('ProjectileVfxSystem — /boost shells, cartridges, bursts, acid & dynamic lights', () => {
  afterEach(() => resetColonyVisionAndLights());

  it('sizes artillery shells smaller than autocannon shells with a longer superheated smoke trail', () => {
    const vfx = new ProjectileVfxSystem();
    vfx.onProjectileFired({
      weaponId: 'artilleryShell', weaponKind: 'shell',
      from: { x: 0, y: 1.1, z: 0 }, to: { x: 14, y: 0.5, z: 0 }, durationS: 0.8,
    });
    vfx.onProjectileFired({
      weaponId: 'autocannon', weaponKind: 'bullet',
      from: { x: 0, y: 1.5, z: 2 }, to: { x: 10, y: 0.5, z: 2 }, durationS: 0.8,
    });
    const active = vfx.getActiveProjectiles();
    const shell = active.find(p => p.weaponId === 'artilleryShell')!;
    const towerRound = active.find(p => p.weaponId === 'autocannon')!;
    expect(shell.scale).toBeCloseTo(0.56, 3);
    expect(towerRound.scale).toBeGreaterThan(1.5);
    expect(vfx.getActiveCounts().cartridges).toBe(2);

    for (let i = 0; i < 6; i++) vfx.update(0.05);
    expect(vfx.getArtilleryTrailCount()).toBeGreaterThan(0);
    expect(vfx.getActiveCounts().smokePuffs).toBeGreaterThan(2);
    expect(vfx.getActiveCounts().cartridges).toBe(2);
    vfx.dispose();
  });

  it('recon 3-burst mode fires staggered spread shots, ejects 3 cartridges, heats barrel, and adds acid on insect hit', () => {
    const shooter = createArchetypeMesh('robot.recon');
    const bug = createArchetypeMesh('fauna.blueBeetle');
    bug.position.set(12, 0, 0);
    const battle = new BattlePresentation(id => (id === 1 ? shooter : id === 2 ? bug : undefined));
    const vfx = new ProjectileVfxSystem();
    const shots = new CombatShotCoordinator(battle, vfx, id => (id === 1 ? shooter : id === 2 ? bug : undefined));

    const targets = computeBurstSpreadTargets({ x: 0, y: 0.9, z: 0 }, { x: 12, y: 0.5, z: 0 }, 3, 7);
    expect(targets).toHaveLength(3);
    const dir0 = targets[0]!.clone().sub(new THREE.Vector3(0, 0.9, 0)).normalize();
    const dir1 = targets[1]!.clone().sub(new THREE.Vector3(0, 0.9, 0)).normalize();
    const dir2 = targets[2]!.clone().sub(new THREE.Vector3(0, 0.9, 0)).normalize();
    expect(dir0.distanceTo(dir1)).toBeGreaterThan(0.02);
    expect(dir1.distanceTo(dir2)).toBeGreaterThan(0.02);

    shots.dispatchShot(1, {
      weaponId: 'reconGun', weaponKind: 'bullet', targetId: 2,
      from: { x: 0, y: 0.9, z: 0 }, to: { x: 12, y: 0.5, z: 0 }, speed: 30, autoImpactOnArrival: true,
    }, { burstSeed: 7 });

    expect(vfx.getActiveCounts().projectiles).toBe(1);
    expect(vfx.getActiveCounts().cartridges).toBe(1);

    battle.update(0.08);
    shots.update(0.08);
    vfx.update(0.08);
    expect(vfx.getActiveCounts().projectiles).toBe(2);
    expect(vfx.getActiveCounts().cartridges).toBe(2);

    battle.update(0.08);
    shots.update(0.08);
    vfx.update(0.08);
    expect(vfx.getActiveCounts().projectiles).toBe(3);
    expect(vfx.getActiveCounts().cartridges).toBe(3);
    expect(battle.getRig(1)!.barrelHeat).toBeGreaterThan(0.5);

    for (let i = 0; i < 12; i++) vfx.update(0.05);
    expect(vfx.getBurstCounts()['combat.acidHit']).toBeGreaterThan(0);
    shots.clear();
    vfx.dispose();
  });
});

describe('ProjectileVfxSystem — /boost dynamic lights & rocket pods', () => {
  afterEach(() => resetColonyVisionAndLights());

  it('publishes omnidirectional dynamic lights for lasers, projectiles, explosions & insect deaths alongside hazards', () => {
    setDynamicHazardLights([{
      x: 50, y: 1, z: 50, range: 12, dirX: 0, dirY: -1, dirZ: 0, cosAngle: -1, r: 1, g: 0.3, b: 0.05, intensity: 4,
    }]);
    const vfx = new ProjectileVfxSystem();
    const u = getColonyVisionUniforms();
    expect(u.uProjectorCount.value).toBe(1);

    vfx.onProjectileFired({
      weaponId: 'pulseLaser', weaponKind: 'laser',
      from: { x: 1, y: 2, z: 1 }, to: { x: 8, y: 0.6, z: 3 }, durationS: 0.2,
    });
    expect(u.uProjectorCount.value).toBeGreaterThanOrEqual(3);
    expect(u.uProjectorDirAngle.value[0]!.w).toBe(-1);

    vfx.onProjectileFired({
      weaponId: 'artilleryShell', weaponKind: 'shell',
      from: { x: 2, y: 1, z: 2 }, to: { x: 14, y: 0.5, z: 4 }, durationS: 0.8,
    });
    vfx.onProjectileImpact({
      weaponKind: 'shell', weaponId: 'artilleryShell', at: { x: 14, y: 0.5, z: 4 }, hit: true, aoe: 2, targetIsInsect: true,
    });
    expect(vfx.getBurstCounts()['combat.acidHit']).toBeGreaterThan(0);
    expect(u.uProjectorCount.value).toBeGreaterThanOrEqual(5);

    vfx.emitInsectDeath({ at: { x: 4, y: 0.4, z: 4 }, groundY: 0, scale: 1 });
    expect(vfx.getBurstCounts()['combat.insectDeath']).toBeGreaterThan(0);
    expect(vfx.getActiveAoeDecals()).toHaveLength(0);
    expect(u.uProjectorCount.value).toBeGreaterThanOrEqual(6);

    vfx.onProjectileFired({
      weaponId: 'autocannon', weaponKind: 'bullet',
      from: { x: 0, y: 1.5, z: 1.2 }, to: { x: 0, y: 0.6, z: 10 },
      ejectCartridge: true, ejectFrom: { x: 0.28, y: 1.54, z: 0.16 }, ejectGroundY: 0,
    });
    expect(vfx.getActiveCounts().cartridges).toBe(2);

    vfx.dispose();
    expect(u.uProjectorCount.value).toBe(1);
  });

  it('robot.tank rocket spider alternates rockets straight from its left and right 4-tube rocket pods', () => {
    const tank = createArchetypeMesh('robot.tank');
    const bug = createArchetypeMesh('fauna.blackAnt');
    bug.position.set(0, 0, 12);
    const battle = new BattlePresentation(id => (id === 1 ? tank : id === 2 ? bug : undefined));
    const vfx = new ProjectileVfxSystem();

    const s0 = battle.shot(1, { weaponId: 'tankRocket', weaponKind: 'rocket', targetId: 2, from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 0.5, z: 12 } });
    vfx.onProjectileFired(s0);
    const s1 = battle.shot(1, { weaponId: 'tankRocket', weaponKind: 'rocket', targetId: 2, from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 0.5, z: 12 } });
    vfx.onProjectileFired(s1);
    const projectiles = vfx.getActiveProjectiles();
    expect(projectiles).toHaveLength(2);
    expect(projectiles[0]!.fromX).toBeLessThan(-0.2);
    expect(projectiles[1]!.fromX).toBeGreaterThan(0.2);
    vfx.dispose();
  });
});
