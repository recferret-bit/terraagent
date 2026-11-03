import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setViewFocusEnabled, updateViewFocus } from '@terra/render/core/viewFocus';
import { spawnHqUnit } from '@terra/sim';
import { LocalHost } from '../../store/local/LocalHost';
import { EntityMeshes } from './EntityMeshes';
import { isEntityInViewFocus } from './entityFocus';

const stub = (id: string) => {
  const g = new THREE.Group();
  g.name = id;
  g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
  return g;
};
const uTime = (m: THREE.Object3D) => (m.userData as { uniforms: { uTime: { value: number } } }).uniforms.uTime.value;

/** A camera looking at ground ~500 m away from the colony: its view focus misses every entity. */
function focusFarAway(): void {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 400);
  cam.position.set(500, 30, 530);
  cam.lookAt(500, 0, 500);
  updateViewFocus(cam);
}

afterEach(() => setViewFocusEnabled(true));

describe('entities outside the view focus', () => {
  it('skip their visual per-frame work but keep walking with the sim, so they come back without a jump', () => {
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const off = new EntityMeshes(new THREE.Scene(), stub);
    const ref = new EntityMeshes(new THREE.Scene(), stub);
    let view = host.sync(true);
    off.syncView(view, null);
    ref.syncView(view, null);
    host.store.sendCommand({ type: 'moveUnit', entityId: hqId, q: 4, r: 0 });

    for (let i = 0; i < 12; i++) {
      if (i % 3 === 0) {
        view = host.step(1);
        off.syncView(view, null);
        ref.syncView(view, null);
      }
      setViewFocusEnabled(true);
      focusFarAway();
      off.update(0.1, null);
      setViewFocusEnabled(false); // the reference draws everything
      ref.update(0.1, null);
    }
    const a = off.getRecord(hqId)!, b = ref.getRecord(hqId)!;
    setViewFocusEnabled(true);
    focusFarAway();
    expect(isEntityInViewFocus(a.mesh)).toBe(false);
    expect(a.mesh.position.x).toBeGreaterThan(0); // it walked while off-screen
    expect(a.mesh.position.distanceTo(b.mesh.position)).toBeLessThan(1e-9);
    expect(a.mesh.rotation.y).toBeCloseTo(b.mesh.rotation.y, 9);
    expect(a.walk).toBeCloseTo(b.walk, 9);
    expect(uTime(a.mesh)).toBe(0); // no shader clock upload off-screen
    expect(uTime(b.mesh)).toBeGreaterThan(0);
    expect(off.healthBars.group.children.every((c) => !c.visible)).toBe(true);
    expect(a.mesh.visible).toBe(true); // gameplay visibility (vision, selection) is untouched

    setViewFocusEnabled(false); // the camera comes back
    off.update(0.1, null);
    ref.update(0.1, null);
    expect(uTime(a.mesh)).toBeCloseTo(uTime(b.mesh), 9);
    expect(a.mesh.position.distanceTo(b.mesh.position)).toBeLessThan(1e-9);
    expect(off.healthBars.group.children.some((c) => c.visible)).toBe(true);
    off.dispose();
    ref.dispose();
  });
});
