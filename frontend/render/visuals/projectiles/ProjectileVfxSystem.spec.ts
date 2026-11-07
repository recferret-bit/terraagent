import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  axialToWorldVfxPoint,
  evalParabolicArcY,
  LASER_BEAM_DURATION_S,
  ProjectileVfxSystem,
  resolveVfxWeaponKind,
} from './index';

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
