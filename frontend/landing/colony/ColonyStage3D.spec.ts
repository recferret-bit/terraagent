// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { ColonyStage3D } from './ColonyStage3D';

function makeStubColonyViewport(host: HTMLElement): ColonyViewport {
  const domElement = document.createElement('canvas');
  host.appendChild(domElement);
  const noop = () => {};
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 1000),
    renderer: {
      domElement,
      setPixelRatio: noop,
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
      toneMappingExposure: 1,
    } as unknown as THREE.WebGLRenderer,
    composer: {} as unknown as ColonyViewport['composer'],
    bloom: { enabled: true, strength: 0.4, radius: 0.35 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    environment: new THREE.Texture(),
    setView: noop,
    applySky: noop,
    followShadow: noop,
    setResolution: noop,
    resize: noop,
    render: noop,
    dispose() {
      domElement.remove();
    },
  };
}

describe('ColonyStage3D pooled BuildingsOrchestrator & UnitsOrchestrator lifecycle', () => {
  it('prewarms oceanForest building/unit pools, acquires 4 colony buildings & 3 miner robots, steps, and disposes cleanly', () => {
    const host = document.createElement('div');
    const placeholder = document.createElement('canvas');
    placeholder.id = 'colony-canvas';
    host.appendChild(placeholder);

    const vp = makeStubColonyViewport(host);
    const stage = new ColonyStage3D(host, vp);

    expect(host.querySelector('#colony-canvas')).toBeNull();
    expect(host.classList.contains('is-live')).toBe(true);
    expect(stage.buildingsOrchestrator.activeCount).toBe(4);
    expect(stage.unitsOrchestrator.activeCount).toBe(3);

    const bStats = stage.buildingsOrchestrator.poolStats();
    const uStats = stage.unitsOrchestrator.poolStats();
    expect(bStats.length).toBeGreaterThanOrEqual(19);
    expect(uStats.length).toBeGreaterThanOrEqual(9);
    expect(bStats.every((s) => s.key.startsWith('building:oceanForest:') && s.allocated >= s.initialSize)).toBe(true);
    expect(uStats.every((s) => s.key.startsWith('unit:oceanForest:') && s.allocated >= s.initialSize)).toBe(true);

    // Track disposal of active pooled meshes & projector rigs on stage.dispose()
    const entityGroup = vp.scene.getObjectByName('landing-colony-entities')!;
    expect(entityGroup).toBeDefined();
    let disposedRigMats = 0;
    entityGroup.children.forEach((child) => {
      const rig = (child.userData as { projectorRig?: { beamMat: THREE.Material } } | undefined)?.projectorRig;
      if (rig?.beamMat) {
        rig.beamMat.addEventListener('dispose', () => { disposedRigMats++; });
      }
    });
    expect(entityGroup.children.length).toBeGreaterThan(10);

    stage.step(0.016);
    stage.step(0.032);
    expect(stage.tickCount).toBe(0);
    stage.step(0.05);
    stage.step(0.05);
    expect(stage.tickCount).toBeGreaterThanOrEqual(1);

    stage.dispose();
    expect(stage.buildingsOrchestrator.activeCount).toBe(0);
    expect(stage.unitsOrchestrator.activeCount).toBe(0);
    expect(stage.buildingsOrchestrator.poolStats()).toHaveLength(0);
    expect(stage.unitsOrchestrator.poolStats()).toHaveLength(0);
    expect(disposedRigMats).toBeGreaterThan(20);
    expect(vp.scene.getObjectByName('landing-colony-entities')).toBeUndefined();
  });
});
