// @vitest-environment jsdom
import * as THREE from 'three';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import { afterEach, describe, expect, it } from 'vitest';
import { RTSCamera } from './RTSCamera';

const cams: RTSCamera[] = [];
/** A camera 60 m from the origin target on a flat 60 m surface at height 1, canvas in the page. */
function rig() {
  const dom = document.body.appendChild(document.createElement('div'));
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  const surface = { halfSize: 60, heightAt: () => 1 } as unknown as PlanetSurface;
  const cam = new RTSCamera(camera, dom, surface, new THREE.Vector3(0, 40, 45), new THREE.Vector3(0, 0, 0));
  cams.push(cam);
  const settle = (s = 3) => { for (let i = 0; i < s * 20; i++) cam.update(0.05); };
  return { cam, camera, dom, settle };
}
const keyDown = (key: string, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const keyUp = (key: string) => window.dispatchEvent(new KeyboardEvent('keyup', { key }));
const pointer = (target: EventTarget, type: string, init: MouseEventInit) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
const dist = (camera: THREE.PerspectiveCamera, cam: RTSCamera) => camera.position.distanceTo(cam.target);

afterEach(() => {
  while (cams.length) cams.pop()!.dispose();
  document.body.replaceChildren();
});

describe('RTSCamera (keys)', () => {
  it('starts at FOV 28°, 42° elevation and the clamped distance, looking at the target', () => {
    const { cam, camera } = rig();
    expect(camera.fov).toBe(28);
    expect(dist(camera, cam)).toBeCloseTo(Math.hypot(40, 45), 5);
    const elev = Math.asin((camera.position.y - cam.target.y) / dist(camera, cam));
    expect(THREE.MathUtils.radToDeg(elev)).toBeCloseTo(42, 5);
  });

  it('W / arrow keys pan along the view, Shift doubles the speed, keyup and blur stop it; typing into an input does not pan', () => {
    const { cam, settle } = rig();
    keyDown('w');
    cam.update(0.1);
    settle(1);
    const z1 = cam.target.z;
    expect(z1).toBeLessThan(-1); // the camera looks toward -z: W moves the target away from it
    keyUp('w');
    settle(1);
    const still = cam.target.z;
    settle(1);
    expect(cam.target.z).toBeCloseTo(still, 3);

    keyDown('d');
    window.dispatchEvent(new Event('blur'));
    settle(1);
    expect(cam.target.x).toBeCloseTo(0, 3);

    const input = document.body.appendChild(document.createElement('input'));
    keyDown('a', input);
    settle(1);
    expect(cam.target.x).toBeCloseTo(0, 3);
    keyUp('a');

    keyDown('shift');
    keyDown('arrowright');
    settle(1);
    expect(cam.target.x).toBeGreaterThan(1);
    expect(cam.target.y).toBeCloseTo(1, 3); // follows the surface height
  });

  it('Q / E turn the view in 90° steps around the target', () => {
    const { cam, camera, settle } = rig();
    keyDown('q'); keyUp('q');
    settle(3);
    const off = camera.position.clone().sub(cam.target);
    expect(THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z))).toBeCloseTo(90, 1);
    keyDown('e'); keyUp('e');
    keyDown('e'); keyUp('e');
    settle(3);
    const off2 = camera.position.clone().sub(cam.target);
    expect(THREE.MathUtils.radToDeg(Math.atan2(off2.x, off2.z))).toBeCloseTo(-90, 1);
  });

});

describe('RTSCamera (mouse, follow, dispose)', () => {
  it('the wheel zooms within [minDist, maxDist]', () => {
    const { cam, camera, dom, settle } = rig();
    for (let i = 0; i < 20; i++) dom.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, cancelable: true }));
    settle(3);
    expect(dist(camera, cam)).toBeCloseTo(cam.maxDist, 1);
    for (let i = 0; i < 40; i++) dom.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true }));
    settle(3);
    expect(dist(camera, cam)).toBeCloseTo(cam.minDist, 1);
  });

  it('middle-drag pans; screen edges pan; a disabled camera ignores input; the target stays inside the map', () => {
    const { cam, dom, settle } = rig();
    pointer(dom, 'pointerdown', { button: 1, clientX: 400, clientY: 300 });
    pointer(window, 'pointermove', { clientX: 300, clientY: 300 });
    pointer(window, 'pointerup', { button: 1 });
    settle(1);
    expect(cam.target.x).toBeGreaterThan(5); // dragged the ground left: the view moves right

    const x = cam.target.x;
    pointer(window, 'pointermove', { clientX: 2, clientY: 300 }); // left screen edge
    cam.update(0.2);
    expect(cam.target.x).toBeLessThan(x);
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    pointer(window, 'pointermove', { clientX: 400, clientY: 300 });

    cam.enabled = false;
    keyDown('d');
    settle(1);
    const frozen = cam.target.x;
    settle(1);
    expect(cam.target.x).toBeCloseTo(frozen, 3);
    keyUp('d');
    cam.enabled = true;

    cam.focus(new THREE.Vector3(500, 0, -500), true);
    expect(cam.target.toArray()).toEqual([500, 0, -500]);
    settle(2);
    expect(cam.target.x).toBeCloseTo(58, 1); // clamped to halfSize - 2
    expect(cam.target.z).toBeCloseTo(-58, 1);
  });

  it('follow() trails an object until a manual pan; F re-arms it; dispose unbinds the keys', () => {
    const { cam, camera, settle } = rig();
    const obj = new THREE.Object3D();
    obj.position.set(10, 0, 10);
    obj.updateMatrixWorld();
    cam.follow(obj);
    settle(4);
    expect(cam.target.x).toBeCloseTo(10, 0);
    keyDown('a');
    cam.update(0.05);
    keyUp('a');
    expect(cam.following).toBe(false);
    keyDown('f'); keyUp('f');
    expect(cam.following).toBe(true);
    cam.follow(null);
    expect(cam.following).toBe(false);
    settle(3);

    cam.dispose();
    keyDown('q'); keyUp('q');
    keyDown('w');
    const before = cam.target.clone();
    settle(1);
    expect(cam.target.distanceTo(before)).toBeLessThan(1e-6);

    const restPos = camera.position.clone();
    cam.setShake(0.8);
    expect(cam.getShake()).toBeCloseTo(0.8, 5);
    cam.update(0.05);
    expect(camera.position.distanceTo(restPos)).toBeGreaterThan(0.1);
    cam.setShake(0);
    cam.update(0.05);
    expect(camera.position.distanceTo(restPos)).toBeLessThan(1e-4);
  });
});
