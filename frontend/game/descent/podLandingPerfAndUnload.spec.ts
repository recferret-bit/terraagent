// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { flushDeferredDispose, pendingDeferredDisposeCount } from '@terra/render/core/deferredDispose';
import { ArchetypeCatalog, LANDING_PREWARM_ARCHETYPES, createArchetypeMesh, stripBuildingPlinth } from '@terra/render/kitbash';
import '@terra/render/kitbash';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { getSharedTerrainPrep } from '@terra/render/planets/prep';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { EntityMeshes } from '../app/online/EntityMeshes';
import { FeatureHud } from '../app/online/featureHud';
import { OnlineSession } from '../app/online/OnlineSession';
import { POD_TOUCHDOWN_TOTAL_S, PodTouchdownFx } from '../app/online/PodTouchdownFx';
import { createClientFlagsStore } from '../core/flags';
import { LocalHost } from '../store/local/LocalHost';
import { ENTITY_STRIDE } from '../store/replica/viewCodec';
import { createDescentSequence } from './createDescent';
import { FrameState } from './parts/FrameState';
import { GroundFx } from './parts/GroundFx';
import { Trajectory } from './parts/Trajectory';

function mock2dCanvas(): void {
  const grad = { addColorStop: () => {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createRadialGradient: () => grad,
    fillRect: () => {},
    fillStyle: '',
  }) as unknown as RenderingContext);
}

function countVisiblePointLights(scene: THREE.Scene): number {
  let count = 0;
  scene.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight && o.visible) count++;
  });
  return count;
}

describe('Pod Landing PointLight Invariance Across Stages', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('keeps NUM_POINT_LIGHTS strictly invariant (= 1) across freefall -> reentry -> chute -> retro handoff -> settled colony', () => {
    mock2dCanvas();
    const scene = new THREE.Scene();
    const domElement = document.createElement('canvas');
    domElement.height = 720;
    const vp = {
      scene,
      camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
      renderer: { domElement },
    } as unknown as ColonyViewport;
    const surf = {
      landingSite: new THREE.Vector3(),
      heightAt: () => 0,
      isLiquid: () => false,
      halfSize: 100,
      group: new THREE.Group(),
      spec: PLANET_SPECS.dune,
      update: () => {},
      dispose: () => {},
    };
    const root = new THREE.Group();
    scene.add(root);
    const gfx = new GroundFx({
      viewport: vp, scene, camera: vp.camera, spec: PLANET_SPECS.dune, surface: surf,
      dens: 0.4, startAt: 9, tScale: 1, sunDir: new THREE.Vector3(0, 1, 0), traj: new Trajectory(surf), root,
    });

    const tdFx = new PodTouchdownFx(scene, true, 'full');
    tdFx.setSpacePhase('orbit');

    const f = new FrameState();
    for (const [tn, plasmaI, thr] of [[10, 0, 0], [18.5, 1, 0], [25, 0, 0], [31, 0, 0.85]] as const) {
      f.tn = tn;
      f.plasmaI = plasmaI;
      f.thr = thr;
      gfx.update(f);
      expect(countVisiblePointLights(scene)).toBe(1);
    }

    root.removeFromParent();
    tdFx.setSpacePhase(null);
    expect(countVisiblePointLights(scene)).toBe(1);

    const podMesh = new THREE.Group();
    podMesh.userData.entityId = 1;
    tdFx.update(POD_TOUCHDOWN_TOTAL_S + 0.5, podMesh, 0, false, 1, 'dune');
    expect(countVisiblePointLights(scene)).toBe(1);
    expect(tdFx.thrLight.intensity).toBe(0);

    gfx.dispose();
    tdFx.dispose();
  });
});

describe('Pod Landing Prewarm & Post-Landing Resource Unload', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('prewarms Flames + GroundFX + PodImpactRig in space, then unloads transient landing GPU objects & worker on touchdown', async () => {
    mock2dCanvas();
    await getSharedTerrainPrep().preloadSurface('dune', 42, 'low', 32);
    expect(getSharedTerrainPrep().cachedSurfaceCount).toBe(1);

    const scene = new THREE.Scene();
    const tdFx = new PodTouchdownFx(scene, true, 'full');
    tdFx.setSpacePhase('orbit');
    const podMesh = new THREE.Group();
    podMesh.userData.entityId = 7;
    scene.add(podMesh);

    expect(tdFx.prewarm('dune', podMesh).length).toBe(3);
    expect(podMesh.getObjectByName('pod-retro-flames')).toBeDefined();
    expect(scene.getObjectByName('pod-ground-fx')).toBeDefined();
    expect(tdFx.impactRig.isWavesBuilt).toBe(true);
    expect(tdFx.impactRig.isEgressBuilt).toBe(true);

    tdFx.setSpacePhase(null);
    tdFx.update(1.0, podMesh, 0, true, 0.5, 'dune');
    expect(podMesh.getObjectByName('pod-retro-flames')?.visible).toBe(true);

    tdFx.update(POD_TOUCHDOWN_TOTAL_S + 0.2, podMesh, 0, false, 1, 'dune');
    flushDeferredDispose();

    expect(podMesh.getObjectByName('pod-retro-flames')).toBeUndefined();
    expect(scene.getObjectByName('pod-ground-fx')).toBeUndefined();
    expect(tdFx.impactRig.isWavesBuilt).toBe(false);
    expect(tdFx.impactRig.waveGroup.children.length).toBe(0);
    expect(tdFx.impactRig.isEgressBuilt).toBe(true);
    expect(getSharedTerrainPrep().cachedSurfaceCount).toBe(0);

    tdFx.update(0.1, null, 0, false, 1, 'dune');
    flushDeferredDispose();
    expect(tdFx.impactRig.isEgressBuilt).toBe(false);
    expect(tdFx.impactRig.egressGroup.children.length).toBe(0);

    tdFx.impactRig.setSettled(new THREE.Vector3(3, 1, -2));
    expect(tdFx.impactRig.isEgressBuilt).toBe(true);
    expect(tdFx.impactRig.egressGroup.visible).toBe(true);
    tdFx.dispose();
  });
});

describe('Space Descent Entity Slicing & Hidden HUD Deferral', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('slices foreign entity creation during space descent and skips hidden FeatureHud updates until colony reveal', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(
      scene,
      (id) => {
        const g = new THREE.Group();
        g.name = id;
        g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
        return g;
      },
      true,
    );
    entities.setOwnerColonyIndex(0);
    entities.podTouchdown.setMode('full');
    entities.podTouchdown.setSpacePhase('reentry');

    const count = 7;
    const buf = new Float32Array(count * ENTITY_STRIDE);
    const writeRow = (idx: number, id: number, kind: number, owner: number, state: number) => {
      const o = idx * ENTITY_STRIDE;
      buf[o] = id; buf[o + 1] = kind; buf[o + 2] = owner;
      buf[o + 8] = 100; buf[o + 9] = 100; buf[o + 10] = state;
    };
    writeRow(0, 1, ENTITY_KIND.pod, 0, ENTITY_STATE.descending);
    for (let i = 1; i < count; i++) writeRow(i, 10 + i, ENTITY_KIND.worker, 1, ENTITY_STATE.idle);

    entities.syncView({ tick: 5, planet: { id: 'pl_1', type: 'desert', radius: 16 }, entities: buf, count, colonies: [] }, null, 'dune');
    expect(entities.count).toBe(1);
    expect(entities.stepSpacePrewarm(null, 2)).toBe(false);
    expect(entities.count).toBe(3);
    entities.flushSpacePrewarm(null);
    expect(entities.count).toBe(7);

    const host = document.createElement('div');
    const hud = new FeatureHud(host, createClientFlagsStore('?waves=W00,W01'), 'local', {});
    const rootSpy = vi.spyOn((hud as unknown as { root: { update: (v: unknown) => void } }).root, 'update');
    hud.setVisible(false);
    rootSpy.mockClear();

    hud.update({ tick: 1 });
    hud.update({ tick: 3 });
    expect(rootSpy).not.toHaveBeenCalled();
    hud.setVisible(true);
    expect(rootSpy).toHaveBeenCalledTimes(1);
    expect(rootSpy).toHaveBeenLastCalledWith({ tick: 3 });

    hud.dispose();
    entities.dispose();
  });
});

describe('Landing Archetype Prewarm, Sliced DescentRunner Disposal & Skip-to-Pause Flow', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('validates every LANDING_PREWARM_ARCHETYPES id exists, pre-bakes stripped plinths, slices DescentRunner disposal, and keeps Esc pause responsive after skipLanding', () => {
    for (const id of LANDING_PREWARM_ARCHETYPES) {
      expect(ArchetypeCatalog.has(id), `Expected "${id}" to exist in ArchetypeCatalog`).toBe(true);
    }
    const q = ['building.commandHub', 'building.mine'];
    ArchetypeCatalog.prewarmStep(q, 50);
    expect(q.length).toBe(0);
    const hub = createArchetypeMesh('building.commandHub', 'dune');
    stripBuildingPlinth(hub);
    expect(hub.geometry.userData.stripOffsetY).toBeGreaterThanOrEqual(0);

    // DescentRunner with deferPartDispose detaches immediately on skip() while deferring GPU part disposal
    mock2dCanvas();
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    try {
      const scene = new THREE.Scene();
      const domElement = document.createElement('canvas');
      domElement.width = 1280; domElement.height = 720;
      const vp = {
        scene,
        camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
        renderer: { domElement, toneMappingExposure: 1.1 },
        sun: new THREE.DirectionalLight(),
        hemi: new THREE.HemisphereLight(),
        bloom: { strength: 0.45, enabled: true },
        environment: new THREE.Texture(),
        applySky: () => {},
        followShadow: () => {},
      } as unknown as ColonyViewport;
      const surf = {
        landingSite: new THREE.Vector3(),
        heightAt: () => 0,
        isLiquid: () => false,
        halfSize: 64,
        group: new THREE.Group(),
        spec: PLANET_SPECS.dune,
        update: () => {},
        dispose: () => {},
      };
      scene.add(surf.group);
      const runner = createDescentSequence({
        viewport: vp, scene, camera: vp.camera, spec: PLANET_SPECS.dune, surface: surf, startAt: 9, deferPartDispose: true,
      });
      expect(scene.getObjectByName('descent:root')).toBeDefined();
      runner.skip();
      expect(scene.getObjectByName('descent:root')).toBeUndefined();
      expect(pendingDeferredDisposeCount()).toBeGreaterThanOrEqual(6);
      flushDeferredDispose();
      expect(pendingDeferredDisposeCount()).toBe(0);

      // Deferred FeatureHud mounts on demand
      const host = document.createElement('div');
      const deferredHud = new FeatureHud(host, createClientFlagsStore('?waves=W00,W01'), 'local', {}, true);
      expect(deferredHud.mounts).toBe(0);
      deferredHud.update({ tick: 7 });
      expect(deferredHud.mounts).toBe(0);
      expect(deferredHud.activeServices).not.toBeNull();
      expect(deferredHud.mounts).toBe(1);
      deferredHud.dispose();

      // OnlineSession externalFrameLoop + Esc pause immediately after skipLanding()
      const root = document.createElement('div');
      document.body.appendChild(root);
      const lh = new LocalHost();
      const session = new OnlineSession(root, 'scenario', {
        localHost: lh,
        externalFrameLoop: true,
        loadMode: 'pod',
        fromSpaceDescent: true,
        makeMesh: (id) => {
          const g = new THREE.Group();
          g.name = id;
          g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
          return g;
        },
      });
      lh.step(1);
      session.stepFrame(1 / 60, 100);
      session.skipLanding();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(session.pauseOverlay.paused).toBe(true);
      session.dispose();
      lh.stop();
      root.remove();
    } finally {
      window.requestAnimationFrame = origRaf;
    }
  });
});
