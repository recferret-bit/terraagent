// @vitest-environment jsdom
import { RESOURCE_KEYS, type AwayDigestV1, type AwayResources } from '@terra/contracts';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { flushDeferredDispose, pendingDeferredDisposeCount } from '@terra/render/core/deferredDispose';
import { ArchetypeCatalog, LANDING_PREWARM_ARCHETYPES } from '@terra/render/kitbash';
import '@terra/render/kitbash';
import { getActiveHexTerrains } from '@terra/render/planets/hex';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { getSharedTerrainPrep } from '@terra/render/planets/prep';
import { createPlanetSurface } from '@terra/render/planets/surface';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { disposePreparedDescentSession, type PreparedDescentSession } from '../app/descentBridge';
import { EntityMeshes } from '../app/online/EntityMeshes';
import type { FeatureHud } from '../app/online/featureHud';
import { OnlineSession } from '../app/online/OnlineSession';
import { resetAwayDismissMemory } from '../features/away-digest/AwayDigestModal';
import { LocalHost } from '../store/local/LocalHost';
import { ENTITY_STRIDE, type ClientTiles, type ClientView } from '../store/replica/viewCodec';
import { createDescentSequence } from './createDescent';

function mock2dCanvas(): void {
  const grad = { addColorStop: () => {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createRadialGradient: () => grad,
    fillRect: () => {},
    fillStyle: '',
  }) as unknown as RenderingContext);
}

function makeSmallClientTiles(radius: number): ClientTiles {
  const count = 3 * radius * (radius + 1) + 1;
  return {
    count,
    terrain: new Uint8Array(count),
    height: new Float32Array(count),
    prep: new Uint8Array(count),
    deposit: new Uint8Array(count),
    depositTier: new Uint8Array(count),
    richness: new Float32Array(count),
    owner: new Int8Array(count).fill(-1),
  };
}

describe('PodTouchdownFx Frame-Sliced Airborne Prewarm', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('keeps PodTouchdownFx unbuilt across 10 Hz syncView ticks when deferPodRig=true and slices prewarm across 4 separate frames', () => {
    mock2dCanvas();
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    try {
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
        true,
      );
      entities.setOwnerColonyIndex(0);
      entities.podTouchdown.setMode('full');
      entities.podTouchdown.setSpacePhase('orbit');

      const buf = new Float32Array(2 * ENTITY_STRIDE);
      buf[0] = 1; buf[1] = ENTITY_KIND.pod; buf[2] = 0; buf[8] = 100; buf[9] = 100; buf[10] = ENTITY_STATE.descending;
      buf[ENTITY_STRIDE] = 2; buf[ENTITY_STRIDE + 1] = ENTITY_KIND.worker; buf[ENTITY_STRIDE + 2] = 1;
      buf[ENTITY_STRIDE + 8] = 100; buf[ENTITY_STRIDE + 9] = 100; buf[ENTITY_STRIDE + 10] = ENTITY_STATE.idle;

      for (const tick of [1, 2, 3]) {
        entities.syncView({ tick, planet: { id: 'pl_1', type: 'desert', radius: 8 }, entities: buf, count: 2, colonies: [] }, null, 'dune');
      }
      const podMesh = entities.getRecord(1)!.mesh;
      expect(entities.podTouchdown.impactRig.isWavesBuilt).toBe(false);
      expect(entities.podTouchdown.impactRig.isEgressBuilt).toBe(false);
      expect(scene.getObjectByName('pod-ground-fx')).toBeUndefined();
      expect(podMesh.getObjectByName('pod-retro-flames')).toBeUndefined();

      expect(entities.stepLandingFxPrewarm()).toBe(false);
      expect(entities.podTouchdown.impactRig.isWavesBuilt).toBe(true);
      expect(entities.podTouchdown.impactRig.isEgressBuilt).toBe(false);

      expect(entities.stepLandingFxPrewarm()).toBe(false);
      expect(entities.podTouchdown.impactRig.isEgressBuilt).toBe(true);
      expect(scene.getObjectByName('pod-ground-fx')).toBeUndefined();

      expect(entities.stepLandingFxPrewarm()).toBe(false);
      expect(scene.getObjectByName('pod-ground-fx')?.visible).toBe(false);
      expect(podMesh.getObjectByName('pod-retro-flames')).toBeUndefined();

      expect(entities.stepLandingFxPrewarm()).toBe(false);
      expect(podMesh.getObjectByName('pod-retro-flames')?.visible).toBe(false);

      expect(entities.stepLandingFxPrewarm()).toBe(true);
      entities.dispose();
    } finally {
      window.requestAnimationFrame = origRaf;
    }
  });
});

function makeSampleAwayDigest(story: string): AwayDigestV1 {
  const res = {} as AwayResources;
  for (const k of RESOURCE_KEYS) res[k] = { before: 0, after: 0 };
  return {
    colonyId: 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    awayFrom: '2026-11-19T01:00:00.000Z',
    awayTo: '2026-11-19T02:00:00.000Z',
    durationS: 3600,
    resources: res,
    energy: { before: 0, after: 0 },
    built: [], lost: [],
    robots: { before: 0, after: 0, produced: 0, lost: 0 },
    territory: { before: 0, after: 0 },
    attacks: { count: 0, repelled: 0, byColony: [] },
    hazards: [],
    ai: { decisions: 0, rejected: 0, highlights: [] },
    trades: { settled: 0, items: [] },
    alerts: [],
    story,
  };
}

describe('OnlineSession Deferred FeatureHud Mount Across Welcome', () => {
  afterEach(() => {
    flushDeferredDispose();
    resetAwayDismissMemory();
    vi.restoreAllMocks();
  });

  it('does not mount FeatureHud prematurely before welcome arrives (even with pre-warmed archetypes), avoiding double-mount on welcome', () => {
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    try {
      // Pre-populate ArchetypeCatalog as Orbit menu does before Deploy
      const orbitQueue = [...LANDING_PREWARM_ARCHETYPES];
      ArchetypeCatalog.prewarmStep(orbitQueue, 500);

      const root = document.createElement('div');
      document.body.appendChild(root);
      const lh = new LocalHost({ flags: ['W00', 'W01', 'W09'], radius: 6 });
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
      const hud = (session as unknown as { hud: FeatureHud }).hud;

      // Simulate 15 airborne frames (~250 ms) BEFORE server welcome arrives: must stay at 0 mounts
      for (let i = 0; i < 15; i++) {
        session.stepFrame(1 / 60, 16.67 * (i + 1));
      }
      expect(hud.mounts).toBe(0);

      // Welcome arrives with subset flags ['W00', 'W01', 'W09'] -> still 0 synchronous mounts on welcome frame
      lh.send({ t: 'join', d: { planetId: 'local' } });
      expect(hud.mounts).toBe(0);

      // Subsequent airborne frames mount FeatureHud exactly once with authoritative flags
      for (let i = 0; i < 40 && hud.mounts === 0; i++) {
        session.stepFrame(1 / 60, 400 + i * 16.67);
      }
      expect(hud.mounts).toBe(1);

      session.dispose();
      lh.stop();
      root.remove();
    } finally {
      window.requestAnimationFrame = origRaf;
    }
  });
});

describe('Returning Colony Dive Escape & AwayDigestModal Preservation', () => {
  afterEach(() => {
    flushDeferredDispose();
    resetAwayDismissMemory();
    vi.restoreAllMocks();
  });

  it('preserves AwayDigestModal when Escape is pressed mid-dive (deferReveal=true) and reveals it cleanly on colony entry', () => {
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      const lh = new LocalHost({ flags: ['W00', 'W01', 'W09'], radius: 6 });
      const session = new OnlineSession(root, 'scenario', {
        localHost: lh,
        externalFrameLoop: true,
        loadMode: 'direct',
        deferReveal: true,
        orbitalCameraDrop: true,
        makeMesh: () => new THREE.Group(),
      });
      const hud = (session as unknown as { hud: FeatureHud }).hud;
      lh.send({ t: 'join', d: { planetId: 'local' } });
      hud.showWelcome({ reason: 'join', away: makeSampleAwayDigest('Returning dive away report.') });

      // Step airborne frames so FeatureHud mounts hidden inside `.ta-hud[hidden]` while still mid-dive
      for (let i = 0; i < 40 && hud.mounts === 0; i++) {
        session.stepFrame(1 / 60, 100 + i * 16.67);
      }
      expect(hud.mounts).toBe(1);
      expect(document.querySelector<HTMLElement>('.ta-hud')?.hidden).toBe(true);

      // User presses Escape mid-dive to skip the globe plunge -> must NOT dismiss the unseen AwayDigestModal
      const skipEv = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(skipEv);
      skipEv.preventDefault();
      window.dispatchEvent(skipEv);
      session.revealFromOrbitalDive(true);

      expect(document.querySelector<HTMLElement>('.ta-hud')?.hidden).toBe(false);
      expect(document.querySelector('[data-testid="away-digest"]')?.textContent).toContain('Returning dive away report.');

      // Pressing Escape now on the visible colony dismisses AwayDigestModal without opening PauseOverlay
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
      expect(session.pauseOverlay.paused).toBe(false);

      session.dispose();
      lh.stop();
    } finally {
      window.requestAnimationFrame = origRaf;
      root.remove();
    }
  });
});

describe('SessionTerrainPreloader Replaced HexTerrain Retirement', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('detaches and defer-disposes replaced HexTerrain on async worker rebuild and on mid-flight flushForSurface', async () => {
    const origRaf = window.requestAnimationFrame;
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    window.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      const session = new OnlineSession(root, 'scenario', {
        transport: {
          state: { phase: 'idle', attempt: 0, downSinceMs: null },
          start() {}, stop() {}, send() {},
          onMessage: () => () => {}, onState: () => () => {},
        },
        externalFrameLoop: true,
        loadMode: 'pod',
        fromSpaceDescent: true,
        makeMesh: () => new THREE.Group(),
      });

      const view1: ClientView = { tick: 1, planet: { id: 'pl_a', type: 'desert', radius: 4 }, entities: new Float32Array(0), count: 0, colonies: [], tiles: makeSmallClientTiles(4) };
      session.store.pushView(view1);
      const terrain1 = session.terrain!;
      expect(terrain1.group.parent).toBe(session.viewport.scene);
      const disposeSpy1 = vi.spyOn(terrain1, 'dispose');

      (globalThis as { Worker?: unknown }).Worker = function MockWorker() {};
      let resolveWorker!: (v: never) => void;
      vi.spyOn(getSharedTerrainPrep(), 'preloadHexTerrain').mockImplementation(
        () => new Promise((res) => { resolveWorker = res as (v: never) => void; }),
      );
      const view2: ClientView = { tick: 2, planet: { id: 'pl_b', type: 'temperate', radius: 4 }, entities: new Float32Array(0), count: 0, colonies: [], tiles: makeSmallClientTiles(4) };
      session.store.pushView(view2);
      expect(session.terrain).toBe(terrain1);

      // Push another same-radius/same-type 10 Hz view while worker job is still in flight -> must NOT cancel worker rebuild
      const view2b: ClientView = { tick: 3, planet: { id: 'pl_b', type: 'temperate', radius: 4 }, entities: new Float32Array(0), count: 0, colonies: [], tiles: makeSmallClientTiles(4) };
      session.store.pushView(view2b);
      expect(session.terrain).toBe(terrain1);

      resolveWorker(undefined as never);
      await Promise.resolve();
      await Promise.resolve();

      const terrain2 = session.terrain!;
      expect(terrain2).not.toBe(terrain1);
      expect(terrain1.group.parent).toBeNull();
      expect(getActiveHexTerrains().has(terrain1)).toBe(false);
      expect(terrain2.group.parent).toBe(session.viewport.scene);
      expect(disposeSpy1).not.toHaveBeenCalled();
      expect(pendingDeferredDisposeCount()).toBeGreaterThanOrEqual(3);
      flushDeferredDispose();
      expect(disposeSpy1).toHaveBeenCalledTimes(1);

      const disposeSpy2 = vi.spyOn(terrain2, 'dispose');
      const view3: ClientView = { tick: 3, planet: { id: 'pl_c', type: 'ocean', radius: 6 }, entities: new Float32Array(0), count: 0, colonies: [], tiles: makeSmallClientTiles(6) };
      session.store.pushView(view3);
      session.setSpacePhase(null);
      expect(session.terrain?.radius).toBe(6);
      expect(terrain2.group.parent).toBeNull();
      flushDeferredDispose();
      expect(disposeSpy2).toHaveBeenCalledTimes(1);

      session.dispose();
    } finally {
      if (origWorker === undefined) delete (globalThis as { Worker?: unknown }).Worker;
      else (globalThis as { Worker?: unknown }).Worker = origWorker;
      window.requestAnimationFrame = origRaf;
      root.remove();
    }
  });
});

describe('Deferred Prepared Descent Session Disposal', () => {
  afterEach(() => {
    flushDeferredDispose();
    vi.restoreAllMocks();
  });

  it('detaches prepared DescentSequence & PlanetSurface immediately and slices GPU disposal in disposePreparedDescentSession', () => {
    mock2dCanvas();
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    try {
      const scene = new THREE.Scene();
      const baseLight = new THREE.DirectionalLight();
      scene.add(baseLight);
      const domElement = document.createElement('canvas');
      domElement.width = 1280; domElement.height = 720;
      const vp = {
        scene,
        camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
        renderer: { domElement, toneMappingExposure: 1.33 },
        sun: baseLight,
        hemi: new THREE.HemisphereLight(),
        bloom: { strength: 0.61, enabled: true },
        environment: new THREE.Texture(),
        applySky: () => {},
        followShadow: () => {},
      } as unknown as ColonyViewport;

      const surface = createPlanetSurface(PLANET_SPECS.dune, { quality: 'low', halfSize: 16 });
      const syncDisposeSpy = vi.spyOn(surface, 'dispose');
      scene.add(surface.group);
      const descent = createDescentSequence({
        viewport: vp, scene, camera: vp.camera, spec: PLANET_SPECS.dune, surface, startAt: 9, deferPartDispose: true,
      });
      const prepared: PreparedDescentSession = {
        key: 'dune:1:low', spec: PLANET_SPECS.dune, surface, descent, ready: true, whenReady: Promise.resolve(),
      };

      disposePreparedDescentSession({
        viewport: vp,
        prepared,
        resetScene: () => {
          for (const c of [...scene.children]) if (c !== baseLight) scene.remove(c);
        },
      });

      expect(surface.group.parent).toBeNull();
      expect(scene.getObjectByName('descent:root')).toBeUndefined();
      expect(syncDisposeSpy).not.toHaveBeenCalled();
      expect(vp.renderer.toneMappingExposure).toBeCloseTo(1.33, 5);
      expect(vp.bloom.strength).toBeCloseTo(0.61, 5);
      expect(pendingDeferredDisposeCount()).toBeGreaterThanOrEqual(8);

      flushDeferredDispose();
      expect(pendingDeferredDisposeCount()).toBe(0);
    } finally {
      window.requestAnimationFrame = origRaf;
    }
  });
});
