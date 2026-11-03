import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setViewFocusEnabled, updateViewFocus } from '../core/viewFocus';
import { WorkParticleSystem, type ActiveWorkSiteInput } from './index';

const site: ActiveWorkSiteInput = {
  workerId: '7', targetKind: 'tree', botOrigin: [1, 0, 0], toolOrigins: [[1, 1, 0]], targetPos: [0, 0.5, 0], groundY: 0,
};

function lookAt(x: number, z: number): void {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 400);
  cam.position.set(x, 30, z + 30);
  cam.lookAt(x, 0, z);
  updateViewFocus(cam);
}

afterEach(() => setViewFocusEnabled(true));

describe('work particles outside the view focus', () => {
  it('hides an off-focus emitter and pauses its simulation, then resumes it on screen', () => {
    const sys = new WorkParticleSystem(new THREE.Scene());
    sys.syncSites([site]);
    const emitter = sys.group.children[0]!;
    lookAt(0, 0);
    sys.update(0.05);
    expect(emitter.visible).toBe(true);
    const snapshot = () => JSON.stringify(emitter.children.map((c) => c.visible));
    lookAt(500, 500);
    const before = snapshot();
    for (let i = 0; i < 10; i++) sys.update(0.05);
    expect(emitter.visible).toBe(false);
    expect(snapshot()).toBe(before); // nothing stepped off-screen
    lookAt(0, 0);
    sys.update(0.05);
    expect(emitter.visible).toBe(true);
    expect(sys.getActiveCount()).toBe(1);
    sys.dispose();
  });

  it('drops a fading emitter that is off the focus at once', () => {
    const sys = new WorkParticleSystem(new THREE.Scene());
    sys.syncSites([site]);
    sys.syncSites([]); // the worker stopped: its emitter fades out
    lookAt(500, 500);
    sys.update(0.05);
    expect(sys.getActiveCount()).toBe(0);
    sys.dispose();
  });
});
