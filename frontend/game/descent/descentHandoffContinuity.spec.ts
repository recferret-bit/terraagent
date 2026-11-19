// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeWire, encodeWire, flagsFromList } from '@terra/contracts';
import {
  getDayNightParams,
  resetDayNightParams,
  setDayNight,
  setDayNightParams,
} from '@terra/render/core/dayNightConfig';
import { resetShadowParams } from '@terra/render/core/shadowConfig';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { compileData, createPlanet, SIM_VERSION, SimHost, spawnColonyLanding } from '@terra/sim';
import type { WsTransportDeps } from '../net/WsTransport';
import { stepOnlineRetroHud } from '../app/descentBridge';
import { activeHome, TEST_COLONY_ID } from '../app/online/homeFixture';
import { OnlineSession } from '../app/online/OnlineSession';
import { POD_EGRESS_YAW } from '../app/online/PodImpactRig';
import { POD_ENGINE_STOP_END_S, POD_TOUCHDOWN_DESCENT_S, PodTouchdownFx } from '../app/online/PodTouchdownFx';
import { BootOverlay } from '../app/online/BootOverlay';
import { EntityMeshes } from '../app/online/EntityMeshes';
import { syncSessionBootOverlayOnView } from '../app/online/parts/sessionViewSync';
import { createClientFlagsStore } from '../core/flags';
import { DescentHud } from '../ui/hud';
import { DescentSolarEvaluator } from './parts/descentSolarSync';
import { Trajectory } from './parts/Trajectory';
import { Telemetry } from './timeline';

function makeWsDeps(serverSim: SimHost): WsTransportDeps {
  return {
    socket() {
      const sock = {
        binaryType: 'arraybuffer' as BinaryType,
        onopen: null as (() => void) | null,
        onmessage: null as ((ev: { data: unknown }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as (() => void) | null,
        send(raw: unknown) {
          const msg = decodeWire(raw as string | ArrayBuffer) as { t: string };
          if (msg.t === 'hello') {
            queueMicrotask(() =>
              sock.onmessage?.({ data: encodeWire({ v: 1, t: 'ready', d: { playerId: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', flags: ['W00', 'W01'] } }) }),
            );
          } else if (msg.t === 'join') {
            queueMicrotask(() =>
              sock.onmessage?.({
                data: encodeWire({
                  v: 1,
                  t: 'welcome',
                  d: {
                    reason: 'join',
                    colonyId: TEST_COLONY_ID,
                    planet: { id: 'pl_dev', type: 'desert', name: 'Kharon' },
                    state: serverSim.snapshot(),
                    simVersion: SIM_VERSION,
                    dataHash: compileData(flagsFromList(['W00', 'W01'])).hash,
                    tick: serverSim.tick,
                    serverTimeMs: Date.now(),
                    tickMs: 200,
                    deltaHz: 5,
                    flags: ['W00', 'W01'],
                  },
                }),
              }),
            );
          }
        },
        close() {},
      };
      queueMicrotask(() => sock.onopen?.());
      return sock;
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random: () => 0.5,
    clientVersion: '0.1.0-test',
  };
}

describe('Pod Landing C0 Continuity, 120 FPS Trend & Pure Peak-G', () => {
  beforeEach(() => {
    setDayNight(true);
    resetDayNightParams('sync');
    resetShadowParams();
  });

  it('maintains C0 continuity across 0..35s at 10ms resolution and pure order-independent peakG', () => {
    for (const kind of ['dune', 'oceanForest', 'forestRock'] as const) {
      const spec = PLANET_SPECS[kind];
      const tel = new Telemetry(spec.orbital.atmosphereDensity, spec.name, 35, 1, kind);

      // Query high-G reentry FIRST, then verify early orbit/freefall peakG is NOT poisoned
      expect(tel.at(20).peakG).toBeGreaterThan(7.0);
      expect(tel.at(2.0).peakG).toBeLessThan(0.05);
      expect(tel.at(9.0).peakG).toBeCloseTo(0.38, 1);

      // Exact C0 boundary checks at every piecewise transition (0.1 ms epsilon)
      for (const b of [2.0, 3.5, 4.0, 5.5, 8.2, 11.5, 12.2, 13.8, 14.8, 22.9, 23.0, 23.2, 24.6, 28.9, 29.0, 32.0, 34.0]) {
        const lo = tel.at(b - 1e-4);
        const hi = tel.at(b + 1e-4);
        expect(Math.abs(hi.hullTempC - lo.hullTempC)).toBeLessThan(0.25);
        expect(Math.abs(hi.gForce - lo.gForce)).toBeLessThan(0.01);
        expect(Math.abs(hi.speedKmh - lo.speedKmh)).toBeLessThan(2.0);
        expect(Math.abs(hi.altitudeKm - lo.altitudeKm)).toBeLessThan(0.05);
      }

      let prev = tel.at(0);
      for (let step = 1; step <= 3500; step++) {
        const tn = step * 0.01;
        const cur = tel.at(tn);
        expect(Math.abs(cur.hullTempC - prev.hullTempC)).toBeLessThan(22);
        expect(Math.abs(cur.gForce - prev.gForce)).toBeLessThan(0.2);
        expect(Math.abs(cur.speedKmh - prev.speedKmh)).toBeLessThan(95);
        prev = cur;
      }
    }
  });

  it('keeps DescentHud thermal trend indicator steady without flickering at 120 FPS', () => {
    const host = document.createElement('div');
    const hud = new DescentHud(host);
    const tel = new Telemetry(PLANET_SPECS.forestRock.orbital.atmosphereDensity, 'Granite Hollow', 35, 1, 'forestRock');

    // Vacuum vent cooling (~20 °C/s => only ~0.16 °C per 120Hz frame)
    for (let i = 0; i < 60; i++) {
      hud.update(tel.at(1.2 + i / 120));
      expect(host.querySelector('#d-trend')?.textContent).toBe('▼');
    }
    // Slip heating (~70 °C/s)
    for (let i = 0; i < 60; i++) {
      hud.update(tel.at(10.5 + i / 120));
      expect(host.querySelector('#d-trend')?.textContent).toBe('▲');
    }
    hud.dispose();
  });
});

describe('Pod Landing Cut Continuity: Dusk NightFactor, Delayed Welcome Slew & Pod Yaw', () => {
  beforeEach(() => {
    setDayNight(true);
    resetDayNightParams('sync');
    resetShadowParams();
  });

  it('matches dusk shaderNightFactor (0.88), night shadow fade, and slews delayed server welcome smoothly', () => {
    const evaluator = new DescentSolarEvaluator();
    const spec = PLANET_SPECS.dune;

    // Dusk 18:15 (18.25h): nightFactor is ~0.638, but entityVisionSync shaderNightFactor is 0.88
    setDayNightParams({ timeOfDay: 18.25 }, 'sync');
    const dusk = evaluator.evaluate(spec, 0);
    expect(dusk.nightFactor).toBeLessThan(0.7);
    expect(dusk.shaderNightFactor).toBeCloseTo(0.88, 2);

    // Delayed welcome jump: start at 12:00 DAY, then jump to 23:00 NIGHT during 60 FPS playback
    evaluator.reset();
    setDayNightParams({ timeOfDay: 12.0 }, 'sync');
    expect(evaluator.evaluate(spec, 1 / 60).daylight).toBeCloseTo(1, 3);

    setDayNightParams({ timeOfDay: 23.0 }, 'sync');
    let prevDaylight = 1;
    for (let frame = 0; frame < 95; frame++) {
      const cur = evaluator.evaluate(spec, 1 / 60);
      // Never snaps from 1 -> 0 in a single frame
      expect(Math.abs(cur.daylight - prevDaylight)).toBeLessThan(0.16);
      prevDaylight = cur.daylight;
    }
    const settled = evaluator.evaluate(spec, 1 / 60);
    expect(settled.daylight).toBeCloseTo(0, 3);
    expect(settled.hour).toBeCloseTo(getDayNightParams().timeOfDay, 2);
    expect(settled.primaryShadowIntensity).toBeCloseTo(0, 3);
    expect(settled.secondaryShadowIntensity).toBeGreaterThan(0.02);
  });

  it('aligns Trajectory pod yaw smoothly to POD_EGRESS_YAW by tn=32 with zero cut rotation snap', () => {
    const mockSurface = {
      landingSite: new THREE.Vector3(0, 0, 0),
      heightAt: () => 2.5,
      isLiquid: () => false,
      halfSize: 100,
      group: new THREE.Group(),
      spec: PLANET_SPECS.dune,
      update: () => {},
      dispose: () => {},
    };
    const traj = new Trajectory(mockSurface);
    const rot32 = traj.podRot(32, new THREE.Euler());
    expect(rot32.x).toBeCloseTo(0, 4);
    expect(rot32.z).toBeCloseTo(0, 4);
    expect(rot32.y).toBeCloseTo(POD_EGRESS_YAW, 4);

    traj.externalGround = true;
    const pos32 = traj.pos(32, new THREE.Vector3());
    expect(pos32.y).toBeCloseTo(21, 4);
  });
});

describe('Online Retro HUD & Existing Landed Colony Re-Entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not soft-lock when deploying from orbit onto an already-landed colony (no pod entity)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const root = document.createElement('div');
    const body = document.createElement('div');
    document.body.replaceChildren(body);
    body.appendChild(root);

    const serverSim = new SimHost({ flags: flagsFromList(['W00', 'W01']) });
    const planet = createPlanet({ id: 'pl_dev', type: 'desert', seed: 'reentry-landed', radius: 16 });
    spawnColonyLanding(planet, { colonyId: 0, colonyIdStr: TEST_COLONY_ID, name: 'Existing Colony', q: 2, r: -1 });
    serverSim.load(planet);
    serverSim.step(35); // Pod already opened into active HQ on server

    const session = new OnlineSession(root, 'boot', {
      uiParent: body,
      planetKind: 'dune',
      fromSpaceDescent: true,
      skipDescent: false,
      tryRefresh: false,
      makeMesh: (id) => {
        const g = new THREE.Group();
        g.name = id;
        g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
        return g;
      },
      fetch: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return url === '/v1/auth/guest'
            ? { accessToken: 'tok', expiresIn: 900, player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Pilot', isGuest: true } }
            : activeHome({ type: 'desert', radius: 16 });
        },
      }),
      storage: { getItem: () => null, setItem: () => {} },
      wsDeps: makeWsDeps(serverSim),
    });

    await session.whenBooted;
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    // Handoff at tn = 32: must immediately transition to 'colony' and retire DescentHud without soft-locking
    session.setSpacePhase(null);
    expect(session.entities.hasPodTouchedDown()).toBe(true);
    expect(session.entities.isHqDeployed()).toBe(true);
    expect(session.bootPhase).toBe('colony');

    const hudHost = document.createElement('div');
    const dHud = new DescentHud(hudHost);
    const tel = new Telemetry(PLANET_SPECS.dune.orbital.atmosphereDensity, 'Kharon Dunes', 35, 1, 'dune');
    expect(stepOnlineRetroHud({ dHud, online: session, retroTelAt: tel.at, skipOnlineLanding: false })).toBe(true);

    dHud.dispose();
    session.dispose();
  });

  it('holds TOUCHDOWN / LAND on DescentHud across engine spool-down (1.75s..2.35s) before retiring', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const scene = new THREE.Scene();
    const fx = new PodTouchdownFx(scene, true, 'full');
    const podMesh = new THREE.Group();
    podMesh.userData.entityId = 1;
    const hudHost = document.createElement('div');
    const dHud = new DescentHud(hudHost);
    const tel = new Telemetry(PLANET_SPECS.dune.orbital.atmosphereDensity, 'Kharon Dunes', 35, 1, 'dune');
    const mockOnline = { bootPhase: 'descent', entities: { podTouchdown: fx } } as unknown as OnlineSession;

    fx.update(0.8, podMesh, 0, true, 0.5, 'dune');
    expect(stepOnlineRetroHud({ dHud, online: mockOnline, retroTelAt: tel.at, skipOnlineLanding: false })).toBe(false);
    expect(hudHost.querySelector('#d-phase')?.textContent).toBe('RETRO-BURN');

    fx.update(POD_TOUCHDOWN_DESCENT_S - 0.8 + 0.15, podMesh, 0, false, 1, 'dune');
    expect(stepOnlineRetroHud({ dHud, online: mockOnline, retroTelAt: tel.at, skipOnlineLanding: false })).toBe(false);
    expect(hudHost.querySelector('#d-phase')?.textContent).toBe('TOUCHDOWN');
    expect(hudHost.querySelector('#d-alt')?.textContent).toBe('0.0');

    fx.update(POD_ENGINE_STOP_END_S, podMesh, 0, false, 1, 'dune');
    expect(stepOnlineRetroHud({ dHud, online: mockOnline, retroTelAt: tel.at, skipOnlineLanding: false })).toBe(true);

    dHud.dispose();
    fx.dispose();
  });
});

describe('Direct-Boot BootOverlay Monotonic Progress', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps direct-boot BootOverlay progress strictly monotonic when 5 Hz server deltas lag behind 60 Hz PodTouchdownFx', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const uiHost = document.createElement('div');
    const bootOverlay = new BootOverlay(uiHost);
    const entities = new EntityMeshes(new THREE.Scene(), (id) => {
      const g = new THREE.Group(); g.name = id; g.userData = { archetypeId: id, uniforms: {} }; return g;
    }, true);
    const podMesh = new THREE.Group();
    podMesh.userData.entityId = 1;

    // Client PodTouchdownFx has already advanced 1.4s (80% of 1.75s), while incoming 5Hz server delta is only at 20% of 6.0s
    entities.podTouchdown.update(1.4, podMesh, 0, true, 0.2, 'dune');
    bootOverlay.showDescent({ progress: 0.8, q: 2, r: -1, landed: false, planetType: 'desert' });
    expect(uiHost.querySelector('[data-testid="descent-progress"]')?.textContent).toBe('80%');

    syncSessionBootOverlayOnView({
      view: { tick: 6, planet: { id: 'pl_dev', type: 'desert', radius: 16 }, entities: new Float32Array(0), count: 0, colonies: [] },
      status: { descending: true, hqLanded: false, progress: 0.2, q: 2, r: -1, podEntityId: 1, hqEntityId: null },
      hqReady: false,
      entities,
      terrain: null,
      showSpaceTerrain: false,
      bootOverlay,
      hud: { setVisible: () => {} } as never,
      cam: null,
      landfall: { selectHq: () => null } as never,
      flags: createClientFlagsStore(''),
      planetId: 'pl_dev',
      fastStartLand: true,
      skipDescent: false,
      fromSpaceDescent: false,
      cameraCentered: true,
      colonyFramed: false,
      arrival: { hold: false, quiet: false, noSelect: false, started: false },
      sendLandOnce: () => {},
      focusTile: () => {},
      setCameraTargetTile: () => {},
      setCameraCentered: () => {},
      setColonyFramed: () => {},
    });

    // Must remain at 80% RETRO-BURN, NEVER snapping backward to 20% ATMOSPHERIC ENTRY!
    expect(uiHost.querySelector('[data-testid="descent-progress"]')?.textContent).toBe('80%');
    expect(uiHost.querySelector('[data-testid="descent-phase-label"]')?.textContent).toBe('RETRO-BURN');
    bootOverlay.dispose();
    entities.dispose();
  });
});
