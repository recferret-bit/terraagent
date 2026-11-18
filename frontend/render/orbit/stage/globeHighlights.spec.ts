import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLANET_SPECS } from '../../planets/PlanetSpec';
import type { PlanetGlobe } from '../../planets/PlanetGlobe';
import { GlobeHighlights } from './GlobeHighlights';
import { CAM_DIST, R } from './StageGlobes';

function makeMockGlobe(kind: 'dune' | 'oceanForest' | 'forestRock', initialSpinY = 0): PlanetGlobe {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  spin.rotation.z = PLANET_SPECS[kind].orbital.axialTilt;
  spin.rotation.y = initialSpinY;
  group.add(spin);
  const noopMat = new THREE.MeshBasicMaterial();
  const clouds = new THREE.Mesh(new THREE.BufferGeometry(), noopMat);
  const atmosphere = new THREE.Mesh(new THREE.BufferGeometry(), noopMat);
  let spinRate = 0.025;
  return {
    group,
    spin,
    clouds,
    atmosphere,
    radius: R,
    spec: PLANET_SPECS[kind],
    shared: {} as PlanetGlobe['shared'],
    setSunDirection() {},
    setOpacity() {},
    setCloudPresence() {},
    setTerraform() {},
    setSpinRate(r) { spinRate = r; },
    update(dt) { spin.rotation.y += dt * spinRate; },
    dispose() { noopMat.dispose(); },
  };
}

describe('GlobeHighlights rotation sync', () => {
  it('moves projected sector markers monotonically in exact lockstep with planet spin and resets on planet switch', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 4000);
    camera.position.set(0, 1.4, CAM_DIST);
    camera.lookAt(0, 0.3, 0);
    camera.updateMatrixWorld();

    const planetPos = new THREE.Vector3(6, 0, 0);
    const highlights = new GlobeHighlights(scene, R);
    highlights.setHighlights([
      { id: 'sec_0_0', yaw: 0, pitch: 0.04, role: 'target', players: 1, bots: 0 },
      { id: 'sec_back', yaw: 2.9, pitch: 0, role: 'sector', players: 0, bots: 0 },
    ]);

    const dune = makeMockGlobe('dune', 0.2);
    const nxSamples: number[] = [];
    for (let i = 0; i < 6; i++) {
      dune.update(1.0, i);
      highlights.update(dune, planetPos, camera, 1.0, i);
      const frame = highlights.project(camera, planetPos, i, new THREE.Vector2(0.1, -0.2));
      const targetAnchor = frame.anchors.find((a) => a.id === 'sec_0_0')!;
      const backAnchor = frame.anchors.find((a) => a.id === 'sec_back')!;
      expect(targetAnchor.visible).toBe(true);
      expect(backAnchor.visible).toBe(false);
      expect(frame.time).toBe(i);
      expect(frame.pointerX).toBeCloseTo(0.1);
      expect(frame.pointerY).toBeCloseTo(-0.2);
      nxSamples.push(targetAnchor.nx);
    }

    for (let i = 1; i < nxSamples.length; i++) {
      expect(nxSamples[i]!).toBeGreaterThan(nxSamples[i - 1]!);
    }

    // Switching planet re-acquires sector markers cleanly on the camera-facing hemisphere
    const ocean = makeMockGlobe('oceanForest', dune.spin.rotation.y + 0.9);
    highlights.update(ocean, planetPos, camera, 0.016, 7);
    const switchedFrame = highlights.project(camera, planetPos, 7);
    expect(switchedFrame.anchors.find((a) => a.id === 'sec_0_0')?.visible).toBe(true);

    highlights.dispose();
    dune.dispose();
    ocean.dispose();
  });
});
