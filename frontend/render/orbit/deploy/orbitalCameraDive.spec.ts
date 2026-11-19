// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColonyViewport } from '../../core/createColonyViewport';
import { PLANET_SPECS } from '../../planets/PlanetSpec';
import { createOrbitalStage } from '../OrbitalStage';

function mock2dCanvas(): void {
  const grad = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(base, {
    get: (target, prop: string) => (prop in target ? target[prop] : () => {}),
    set: (target, prop: string, val) => { target[prop] = val; return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as RenderingContext);
}

function makeStubViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  const hemi = new THREE.HemisphereLight(0x99ccff, 0x334422, 0.8);
  scene.add(sun, hemi);
  const domElement = document.createElement('canvas');
  domElement.width = 1280;
  domElement.height = 720;
  return {
    scene,
    camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
    sun,
    hemi,
    bloom: { enabled: true, strength: 0.45 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    composer: { render: () => {} } as unknown as ColonyViewport['composer'],
    renderer: { domElement, toneMappingExposure: 1, shadowMap: { enabled: true }, setPixelRatio: () => {} } as unknown as THREE.WebGLRenderer,
    environment: new THREE.Texture(),
    setView: () => {},
    applySky: () => {},
    followShadow: () => {},
    setResolution: () => {},
    resize: () => {},
    render: () => {},
    dispose: () => {},
  };
}

describe('OrbitalCameraDive on OrbitalStage', () => {
  beforeEach(() => mock2dCanvas());
  afterEach(() => vi.restoreAllMocks());

  it('zooms the camera smoothly toward the planet surface without spawning any drop pod mesh', () => {
    const vp = makeStubViewport();
    const stage = createOrbitalStage(vp, PLANET_SPECS.oceanForest);
    stage.update(0.1, 0.1);

    const globeCenter = new THREE.Vector3(6, 0, 0);
    stage.beginCameraDive?.({ yaw: 0.12, pitch: -0.08, duration: 1.2 });
    const startDist = stage.camera.position.distanceTo(globeCenter);
    expect(stage.cameraDiveProgress?.()).toBe(0);

    let prevDist = startDist;
    for (let i = 1; i <= 6; i++) {
      stage.update(0.2, 0.1 + i * 0.2);
      const nextDist = stage.camera.position.distanceTo(globeCenter);
      expect(nextDist).toBeLessThan(prevDist);
      prevDist = nextDist;
    }

    expect(stage.cameraDiveProgress?.()).toBe(1);
    let podMeshFound = false;
    stage.scene.traverse((o) => {
      if (o.userData?.archetypeId === 'ship.dropPod' || o.name.toLowerCase().includes('droppod')) {
        podMeshFound = true;
      }
    });
    expect(podMeshFound).toBe(false);
    stage.dispose();
  });
});
