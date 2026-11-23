// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeWire, encodeWire, flagsFromList } from '@terra/contracts';
import { resetDayNightParams, setDayNight, setDayNightParams } from '@terra/render/core/dayNightConfig';
import { resetShadowParams } from '@terra/render/core/shadowConfig';
import { createOrbitalStage } from '@terra/render/orbit/OrbitalStage';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import type { DescentHandoff } from '@terra/render/descent/types';
import { compileData, createPlanet, setPlanetTime, SIM_VERSION, SimHost, spawnColonyLanding, spawnHqUnit } from '@terra/sim';
import type { WsTransportDeps } from '../net/WsTransport';
import { RTSCamera } from '../app/RTSCamera';
import { stepDeployingStageFrame } from '../app/descentBridge';
import { activeHome, TEST_COLONY_ID } from '../app/online/homeFixture';
import { OnlineSession } from '../app/online/OnlineSession';
import { PodImpactRig } from '../app/online/PodImpactRig';
import { POD_TOUCHDOWN_DESCENT_S, POD_TOUCHDOWN_TOTAL_S, POD_WAIT_END_S, PodTouchdownFx } from '../app/online/PodTouchdownFx';
import { FINAL_POS, FINAL_TARGET } from './constants';
import { GroundFx } from './parts/GroundFx';
import { SkyRig, prepareSceneSky } from './parts/SkyRig';
import { FrameState, type DescentContext } from './parts/FrameState';
import { Trajectory } from './parts/Trajectory';
import { computeSpaceEntrySolar, DescentSolarEvaluator, type SpaceEntrySolar } from './parts/descentSolarSync';

function stubMesh(id: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = id;
  g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
  return g;
}

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

function makeWsHarness(serverSim: SimHost, planetType: 'desert' | 'ocean' | 'temperate' = 'desert') {
  let activeSock: { onmessage: ((ev: { data: unknown }) => void) | null } | null = null;
  const wsDeps: WsTransportDeps = {
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
                    planet: { id: 'pl_dev', type: planetType, name: 'Kharon' },
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
      activeSock = sock;
      queueMicrotask(() => sock.onopen?.());
      return sock;
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random: () => 0.5,
    clientVersion: '0.1.0-test',
  };
  const stepServer = (ticks: number) => {
    const fromTick = serverSim.tick;
    serverSim.step(ticks);
    const toTick = serverSim.tick;
    activeSock?.onmessage?.({ data: encodeWire({ v: 1, t: 'delta', d: { fromTick, toTick, diff: serverSim.diffSince(fromTick) } }) });
  };
  return { wsDeps, stepServer };
}

function makeStubViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03060c);
  scene.fog = new THREE.FogExp2(0x03060c, 0.004);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
  scene.add(sun, sun.target, hemi);
  const domElement = document.createElement('canvas');
  Object.defineProperty(domElement, 'clientWidth', { value: 1280 });
  Object.defineProperty(domElement, 'clientHeight', { value: 720 });
  domElement.height = 720;
  return {
    scene,
    camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
    sun,
    hemi,
    bloom: { enabled: true, strength: 0.4 } as unknown as ColonyViewport['bloom'],
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

function makeMockHandoff(space: SpaceEntrySolar): DescentHandoff {
  return {
    startAt: 9,
    camLocal: new THREE.Vector3(0, 0, 5),
    targetLocal: new THREE.Vector3(),
    upLocal: new THREE.Vector3(0, 1, 0),
    sunLocal: space.entrySunDir.clone(),
    sunColor: space.sunColor.clone(),
    sunIntensity: space.sunIntensity,
    sunDisc: space.spaceLit,
    hemiColor: space.hemiColor.clone(),
    hemiGround: space.hemiGround.clone(),
    hemiIntensity: space.hemiIntensity,
    exposure: 1,
    envIntensity: 0.3,
    bloom: 0.4,
    bayGlow: 1,
    podYawLocal: -0.3,
    carrierScale: 1,
    tel: {} as never,
    telAt: () => ({ phase: 'orbit' }) as never,
    R: 4000,
    centre: new THREE.Vector3(0, -4006, 0),
    fov: 28,
    podH: 3,
    pod: new THREE.Vector3(-40, 560, 30),
    podQuat: new THREE.Quaternion(),
    cam: new THREE.Vector3(-20, 580, 60),
    camTarget: new THREE.Vector3(-40, 560, 30),
    sunDir: space.entrySunDir.clone(),
  };
}

describe('Fresh Orbital Deployment Surface Touchdown Continuity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('plays full 5.0s surface touchdown (retro -> 2s wait -> petal egress) on fresh orbital deploy after sim 6s timer completes', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const root = document.createElement('div');
    const body = document.createElement('div');
    document.body.replaceChildren(body);
    body.appendChild(root);

    const serverSim = new SimHost({ flags: flagsFromList(['W00', 'W01']) });
    const planet = createPlanet({ id: 'pl_dev', type: 'desert', seed: 'fresh-orbit', radius: 16 });
    const res = spawnColonyLanding(planet, { colonyId: 0, colonyIdStr: TEST_COLONY_ID, name: 'Fresh Orbit Colony', q: 3, r: -2 });
    if (!res.ok) throw new Error(res.code);
    serverSim.load(planet);
    const { wsDeps, stepServer } = makeWsHarness(serverSim);

    const session = new OnlineSession(root, 'boot', {
      uiParent: body,
      planetKind: 'dune',
      fromSpaceDescent: true,
      skipDescent: false,
      tryRefresh: false,
      makeMesh: stubMesh,
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
      wsDeps,
    });

    await session.whenBooted;
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    // Server finishes 6s podDescentS while 32.6s orbital + atmospheric descent is still airborne
    stepServer(35);
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    session.setSpacePhase(null);
    expect(session.entities.hasPodTouchedDown()).toBe(false);
    expect(session.entities.isHqDeployed()).toBe(false);
    expect(session.bootPhase).toBe('descent');
    const podRec = session.entities.getRecord(res.podEntityId)!;
    expect(podRec.mesh.visible).toBe(true);
    expect(podRec.mesh.position.y).toBeGreaterThan(20);

    session.entities.update(POD_TOUCHDOWN_DESCENT_S + 0.1, session.terrain);
    expect(session.entities.hasPodTouchedDown()).toBe(true);
    expect(session.entities.isHqDeployed()).toBe(false);
    expect(session.entities.podTouchdown.impactRig.waveGroup.visible).toBe(true);

    session.entities.update(POD_WAIT_END_S - POD_TOUCHDOWN_DESCENT_S + 0.1, session.terrain);
    expect(session.entities.podTouchdown.impactRig.egressGroup.visible).toBe(true);
    expect(session.entities.isHqDeployed()).toBe(false);

    session.entities.update(POD_TOUCHDOWN_TOTAL_S, session.terrain);
    expect(session.entities.isHqDeployed()).toBe(true);
    session.dispose();
  });
});

describe('Lagged Fresh Orbital Deploy (> 6s) & Constant-Decel Touchdown', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves surface touchdown on fresh orbital deploy even when WS welcome lags > 6.0s (42 ticks), and keeps BootOverlay monotonic', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const root = document.createElement('div');
    const body = document.createElement('div');
    document.body.replaceChildren(body);
    body.appendChild(root);

    const serverSim = new SimHost({ flags: flagsFromList(['W00', 'W01']) });
    const planet = createPlanet({ id: 'pl_dev', type: 'desert', seed: 'lagged-fresh', radius: 16 });
    const res = spawnColonyLanding(planet, { colonyId: 0, colonyIdStr: TEST_COLONY_ID, name: 'Lagged Fresh', q: 2, r: -1 });
    if (!res.ok) throw new Error(res.code);
    serverSim.load(planet);
    serverSim.step(42); // 8.4s WS lag (> 6.0s podDescentS) BEFORE client ever sees first view
    const { wsDeps } = makeWsHarness(serverSim);

    const session = new OnlineSession(root, 'boot', {
      uiParent: body, planetKind: 'dune', fromSpaceDescent: true, freshDeployment: true, skipDescent: false, tryRefresh: false,
      makeMesh: stubMesh,
      fetch: async (url) => ({
        ok: true, status: 200,
        async json() {
          return url === '/v1/auth/guest'
            ? { accessToken: 'tok', expiresIn: 900, player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Pilot', isGuest: true } }
            : activeHome({ type: 'desert', radius: 16 });
        },
      }),
      storage: { getItem: () => null, setItem: () => {} },
      wsDeps,
    });
    await session.whenBooted;
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    session.setSpacePhase(null);
    expect(session.entities.hasPodTouchedDown()).toBe(false);
    expect(session.entities.getRecord(res.podEntityId)!.mesh.position.y).toBeGreaterThan(20);
    session.dispose();

    // Verify PodTouchdownFx enters t=0 at ~24.0 m/s (no smoothstep mid-air hover stall)
    const fx = new PodTouchdownFx(new THREE.Scene(), true, 'full');
    const pm = stubMesh('ship.dropPod'); pm.userData.entityId = 1;
    fx.update(0.05, pm, 0, true, 0.1, 'dune');
    expect(21 - fx.peekSurfaceState().podLift).toBeCloseTo(24.0 * 0.05 - 0.5 * (24.0 / 1.75) * 0.0025, 2);
    fx.dispose();
  });
});

describe('HQ-Only Existing Colony & Pre-Terrain Dark Orbital Void Background', () => {
  afterEach(() => vi.restoreAllMocks());

  it('skips surface touchdown cleanly without soft-lock when colony has HQ only and keeps dark pre-terrain boot sky', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const root = document.createElement('div');
    const body = document.createElement('div');
    document.body.replaceChildren(body);
    body.appendChild(root);

    const serverSim = new SimHost({ flags: flagsFromList(['W00', 'W01']) });
    const planet = createPlanet({ id: 'pl_dev', type: 'desert', seed: 'hq-no-pod', radius: 16 });
    spawnHqUnit(planet, { owner: 0, q: 1, r: 1 });
    setPlanetTime(planet, { timeOfDay: 23.0, realHoursPerDay: 0.25, timeScale: 1 }, 0);
    serverSim.load(planet);
    const { wsDeps } = makeWsHarness(serverSim);

    const session = new OnlineSession(root, 'boot', {
      uiParent: body,
      planetKind: 'dune',
      fromSpaceDescent: false,
      skipDescent: false,
      tryRefresh: true,
      makeMesh: stubMesh,
      fetch: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return url === '/v1/auth/refresh'
            ? { accessToken: 'tok', expiresIn: 900, player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Pilot', isGuest: true } }
            : activeHome({ type: 'desert', radius: 16 });
        },
      }),
      storage: { getItem: () => '0123456789abcdef0123456789abcdef', setItem: () => {} },
      wsDeps,
    });

    expect((session.viewport.scene.background as THREE.Color).getHex()).toBe(0x03060c);

    await session.whenBooted;
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    expect(session.bootPhase).toBe('colony');
    expect(session.entities.isHqDeployed()).toBe(true);
    session.dispose();
  });
});

describe('Orbital Night Entry Corridor & SpaceBackdrop Sun Suppression', () => {
  beforeEach(() => {
    setDayNight(true);
    resetDayNightParams('sync');
    resetShadowParams();
  });
  afterEach(() => vi.restoreAllMocks());

  it('retargets orbital deploy entry to nightside umbra before TB=3.6s and suppresses daytime SpaceBackdrop sun disc at night', () => {
    mock2dCanvas();
    const evalr = new DescentSolarEvaluator();
    setDayNightParams({ timeOfDay: 12.0 }, 'sync');
    const daySpace = computeSpaceEntrySolar(evalr.evaluate(PLANET_SPECS.dune, 0), 0.4);
    expect(daySpace.entrySunDir.y).toBeGreaterThan(0.6);
    expect(daySpace.spaceLit).toBeCloseTo(1, 3);

    evalr.reset();
    setDayNightParams({ timeOfDay: 23.0 }, 'sync');
    const nightTarget = evalr.evaluate(PLANET_SPECS.dune, 0);
    const nightSpace = computeSpaceEntrySolar(nightTarget, 0.4);
    expect(nightSpace.entrySunDir.y).toBeLessThan(-0.35);
    expect(nightSpace.spaceLit).toBe(0);
    expect(nightSpace.sunIntensity).toBeLessThan(0.4);

    const vp = makeStubViewport();
    prepareSceneSky(vp.scene, PLANET_SPECS.dune);
    const mockSurface = {
      landingSite: new THREE.Vector3(), heightAt: () => 4.2, isLiquid: () => false,
      halfSize: 100, group: new THREE.Group(), spec: PLANET_SPECS.dune, update: () => {}, dispose: () => {},
    };
    const root = new THREE.Group();
    const ctx: DescentContext = {
      viewport: vp, scene: vp.scene, camera: vp.camera, spec: PLANET_SPECS.dune, surface: mockSurface,
      dens: PLANET_SPECS.dune.orbital.atmosphereDensity, startAt: 9, tScale: 1,
      sunDir: nightSpace.entrySunDir.clone(), traj: new Trajectory(mockSurface), root,
    };
    const sky = new SkyRig(ctx);
    const f = new FrameState();
    f.tn = 9.5;
    f.solar = nightTarget;
    f.camPos.set(0, 520, 40);
    sky.update(f);

    const bdMesh = root.getObjectByName('SpaceBackdrop')?.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(bdMesh.material.uniforms.uSunDisc.value).toBe(0);
    expect((bdMesh.material.uniforms.uSunDir.value as THREE.Vector3).y).toBeLessThan(-0.3);

    const stage = createOrbitalStage(vp, PLANET_SPECS.dune);
    stage.update(0.1, 0.1);
    const handoff = makeMockHandoff(daySpace);
    const qDay = stage.beginDeploy(handoff, { biomeKey: 'desert' }).spinQuat.clone();

    let alignedNight: THREE.Quaternion | null = null;
    const mockDescent = {
      handoff,
      syncHandoffSolar() {
        handoff.sunDir.copy(nightSpace.entrySunDir);
        handoff.sunIntensity = nightSpace.sunIntensity;
        handoff.sunColor.copy(nightSpace.sunColor);
        return true;
      },
      alignGlobe(sq: THREE.Quaternion) { alignedNight = sq.clone(); },
    };
    stepDeployingStageFrame({ dt: 0.5, time: 0.6, online: null, descent: mockDescent as never, stage, dHud: null, currentSpec: PLANET_SPECS.dune });
    expect(alignedNight).not.toBeNull();
    expect(alignedNight!.angleTo(qDay)).toBeGreaterThan(0.4);

    // Advance past TB=3.6s and verify post-TB lighting retargets smoothly without 1-frame sunLight jump and grades uSunDisc -> 0
    for (let i = 0; i < 40; i++) stage.update(0.1, 0.7 + i * 0.1);
    const sunBefore = (stage.scene.children.find((c) => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight).intensity;
    handoff.sunDisc = 0;
    handoff.sunIntensity = nightSpace.sunIntensity;
    expect(stage.retargetDeploy?.(handoff)).toBeNull();
    stage.update(1 / 60, 4.8);
    const sunAfter1Frame = (stage.scene.children.find((c) => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight).intensity;
    expect(Math.abs(sunAfter1Frame - sunBefore)).toBeLessThan(0.05);
    for (let i = 0; i < 55; i++) stage.update(0.1, 5.0 + i * 0.1);
    const stageBd = stage.scene.getObjectByName('SpaceBackdrop')?.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(stageBd.material.uniforms.uSunDisc.value).toBeCloseTo(0, 2);

    sky.dispose();
    stage.dispose();
  });
});

describe('Zero-Snap Camera Cut (FINAL_POS vs RTSCamera), GroundFx Datum & PodImpactRig Origin Guard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('matches FINAL_POS and RTSCamera to 0.000 m / 0.000° at tn=32, uses y=0 for externalGround dust, and prevents setSettled origin flash', () => {
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    const surf = {
      landingSite: new THREE.Vector3(), heightAt: () => 3.5, isLiquid: () => false,
      halfSize: 120, group: new THREE.Group(), spec: PLANET_SPECS.forestRock, update: () => {}, dispose: () => {},
    };
    const tx = 18, ty = 3.5, tz = -12;
    const rts = new RTSCamera(
      cam, document.createElement('div'), surf,
      new THREE.Vector3(tx + FINAL_POS.x, ty + FINAL_POS.y, tz + FINAL_POS.z),
      new THREE.Vector3(tx, ty, tz),
    );
    rts.focus(new THREE.Vector3(tx, ty, tz), true);
    expect(cam.position.distanceTo(new THREE.Vector3(tx + FINAL_POS.x, ty + FINAL_POS.y, tz + FINAL_POS.z))).toBeLessThan(1e-6);

    const descentCam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    descentCam.position.copy(FINAL_POS);
    descentCam.lookAt(FINAL_TARGET);
    expect(cam.quaternion.angleTo(descentCam.quaternion)).toBeLessThan(1e-6);
    rts.dispose();

    const rig = new PodImpactRig(new THREE.Scene());
    rig.setSettled();
    expect(rig.egressGroup.visible).toBe(false);
    rig.setSettled(new THREE.Vector3(14, 2, -9));
    expect(rig.egressGroup.visible).toBe(true);
    expect(rig.root.position.x).toBe(14);
    rig.dispose();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: '',
    }) as unknown as RenderingContext);
    const vp = makeStubViewport();
    const traj = new Trajectory(surf);
    traj.externalGround = true;
    const root = new THREE.Group();
    const gfx = new GroundFx({
      viewport: vp, scene: vp.scene, camera: vp.camera, spec: PLANET_SPECS.dune, surface: surf,
      dens: 0.4, startAt: 9, tScale: 1, sunDir: new THREE.Vector3(0, 1, 0), traj, root,
    });
    const f = new FrameState();
    f.tn = 30.5; f.yRel = 12; f.thr = 0.9; f.podBase.set(0, 12, 0);
    gfx.update(f);
    const pts = root.children[0]?.children[0] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect((pts.material.uniforms.uPos.value as THREE.Vector3).y).toBe(0);
    gfx.setPlanetKind('oceanForest', 42);
    expect((root.children[root.children.length - 1] as THREE.Group).children.length).toBe(3);
    gfx.dispose();
  });
});
