// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import { RTSCamera } from './RTSCamera';

function makeSurface(): PlanetSurface {
  return {
    landingSite: new THREE.Vector3(),
    heightAt: () => 2.5,
    isLiquid: () => false,
    halfSize: 100,
    group: new THREE.Group(),
    spec: PLANET_SPECS.dune,
    update: () => {},
    dispose: () => {},
  };
}

describe('RTSCamera.startOrbitalDrop', () => {
  it('drops smoothly from high orbital altitude/FOV down onto a moving HQ bot and finishes at 28 deg FOV', () => {
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    const dom = document.createElement('div');
    const surface = makeSurface();
    const bot = new THREE.Group();
    bot.position.set(12, 2.5, -8);

    const rts = new RTSCamera(
      camera,
      dom,
      surface,
      new THREE.Vector3(12 + 30, 32, -8 + 30),
      new THREE.Vector3(12, 2.5, -8),
    );

    rts.startOrbitalDrop(bot.position, { duration: 1.2, followObj: bot });
    expect(rts.isOrbitalDropping()).toBe(true);
    expect(camera.fov).toBeCloseTo(36, 4);
    const startAlt = camera.position.y;
    expect(startAlt).toBeGreaterThan(120);

    let prevAlt = startAlt;
    for (let i = 0; i < 6; i++) {
      bot.position.x += 0.4;
      rts.update(0.15);
      expect(camera.position.y).toBeLessThan(prevAlt);
      prevAlt = camera.position.y;
    }

    expect(rts.isOrbitalDropping()).toBe(true);
    rts.update(0.5);
    expect(rts.isOrbitalDropping()).toBe(false);
    expect(camera.fov).toBe(28);
    expect(rts.target.x).toBeGreaterThan(13);

    rts.dispose();
  });

  it('cancels the orbital drop cleanly via completeOrbitalDrop or manual wheel input', () => {
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    const dom = document.createElement('div');
    const rts = new RTSCamera(camera, dom, makeSurface(), new THREE.Vector3(30, 32, 30), new THREE.Vector3(0, 2.5, 0));

    rts.startOrbitalDrop(new THREE.Vector3(5, 2.5, 5), { duration: 1.5 });
    expect(rts.isOrbitalDropping()).toBe(true);
    rts.completeOrbitalDrop();
    expect(rts.isOrbitalDropping()).toBe(false);
    expect(camera.fov).toBe(28);
    expect(camera.position.y).toBeLessThan(60);

    rts.startOrbitalDrop(new THREE.Vector3(5, 2.5, 5), { duration: 1.5 });
    expect(rts.isOrbitalDropping()).toBe(true);
    dom.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
    expect(rts.isOrbitalDropping()).toBe(false);
    expect(camera.fov).toBe(28);

    rts.dispose();
  });

  it('clears prior camera shake on startOrbitalDrop, ignores shake while dropping, and lands smoothly at surface height', () => {
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    const dom = document.createElement('div');
    const surface = makeSurface();
    const bot = new THREE.Group();
    bot.position.set(10, 9.9, 6);
    const rts = new RTSCamera(camera, dom, surface, new THREE.Vector3(40, 32, 36), new THREE.Vector3(10, 2.5, 6));

    rts.setShake(0.95);
    rts.startOrbitalDrop(bot.position, { duration: 1.0, followObj: bot });
    expect(rts.getShake()).toBe(0);
    expect(rts.target.y).toBeCloseTo(2.5, 5);

    // Even if an external source tries to inject shake mid-drop, camera position remains unshaken
    rts.setShake(0.8);
    rts.update(0.5);
    const posWithAttemptedShake = camera.position.clone();
    rts.setShake(0);
    rts.update(0);
    expect(camera.position.distanceTo(posWithAttemptedShake)).toBeLessThan(1e-6);

    // Completing the drop transitions cleanly onto terrain surface height without any Y jump
    rts.update(0.6);
    expect(rts.isOrbitalDropping()).toBe(false);
    const endTarget = rts.target.clone();
    rts.update(0.016);
    expect(rts.target.distanceTo(endTarget)).toBeLessThan(1e-4);

    rts.dispose();
  });
});
