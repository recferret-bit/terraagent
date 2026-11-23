// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeWire, encodeWire, flagsFromList } from '@terra/contracts';
import {
  applyDayNightAtmosphere,
  getDayNightParams,
  recordViewportPlanetBase,
  resetDayNightParams,
  setDayNight,
  setDayNightParams,
} from '@terra/render/core/dayNightConfig';
import { resetShadowParams, syncViewportShadow } from '@terra/render/core/shadowConfig';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { compileData, createPlanet, setPlanetTime, SIM_VERSION, SimHost, spawnColonyLanding } from '@terra/sim';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import type { WsTransportDeps } from '../net/WsTransport';
import { BootOverlay } from '../app/online/BootOverlay';
import { activeHome, TEST_COLONY_ID } from '../app/online/homeFixture';
import { OnlineSession } from '../app/online/OnlineSession';
import { POD_TOUCHDOWN_START_ALT_M } from '../app/online/PodTouchdownFx';
import { DescentHud } from '../ui/hud';
import { PLANET_ATMOSPHERES } from './atmosphereSpec';
import { DescentSolarEvaluator } from './parts/descentSolarSync';
import { Telemetry } from './timeline';

function makeMockViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.004);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const secondaryShadowLight = new THREE.DirectionalLight(0x9cc4ff, 1.35);
  secondaryShadowLight.name = 'secondaryShadowLight';
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
  scene.add(sun, sun.target, secondaryShadowLight, secondaryShadowLight.target, hemi);
  const domElement = document.createElement('canvas');
  return {
    scene,
    camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
    sun,
    secondaryShadowLight,
    hemi,
    bloom: { enabled: true, strength: 0.4 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    composer: { render: () => {} } as unknown as ColonyViewport['composer'],
    renderer: {
      domElement,
      toneMappingExposure: 1,
      shadowMap: { enabled: true },
      setPixelRatio: () => {},
    } as unknown as THREE.WebGLRenderer,
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

function makeNightWsDeps(serverSim: SimHost): WsTransportDeps {
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

describe('Pod Landing Telemetry: kinematics, thermal curve, pressure & spectrometer', () => {
  beforeEach(() => {
    setDayNight(true);
    resetDayNightParams('sync');
    resetShadowParams();
  });

  it('never starts at -40 °C or flatlines hull temperature, and accelerates speed during gravity freefall', () => {
    const tel = new Telemetry(PLANET_SPECS.forestRock.orbital.atmosphereDensity, 'Granite Hollow', 35, 1, 'forestRock');
    const t0 = tel.at(0);
    expect(t0.hullTempC).toBeCloseTo(18, 0);
    expect(t0.thermalState).toBe('BAY STANDBY');

    const samples = [0, 2, 4, 6.5, 8.2, 10.5, 13, 19, 23.5, 26.5, 28.9, 31.8, 34.8].map((s) => tel.at(s).hullTempC);
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeGreaterThan(15);
    }
    // Never sits flat over any 1.5s window across the entire flight 0..34s
    for (let t = 0; t <= 32.5; t += 1.5) {
      const w = [tel.at(t).hullTempC, tel.at(t + 0.5).hullTempC, tel.at(t + 1.0).hullTempC, tel.at(t + 1.5).hullTempC];
      expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(2.5);
    }
    expect(tel.at(8.8).hullTempC).toBeLessThan(-95);
    expect(tel.at(13.5).hullTempC).toBeGreaterThan(80);
    expect(tel.at(19.2).hullTempC).toBeGreaterThan(1650);
    expect(tel.at(24.5).hullTempC).toBeLessThan(450);
    expect(tel.at(32.0).hullTempC).toBeGreaterThan(tel.at(28.8).hullTempC);

    const spdOrbit0 = tel.at(0).speedKmh;
    const spdOrbitDocked = tel.at(3.6).speedKmh;
    const spdPostDeorbit = tel.at(5.5).speedKmh;
    const spdEntryInterface = tel.at(13.6).speedKmh;
    expect(spdOrbitDocked).toBeGreaterThanOrEqual(spdOrbit0);
    expect(tel.at(2.0).verticalSpeedMs).toBeLessThan(3.0);
    expect(spdPostDeorbit).toBeLessThan(spdOrbit0);
    expect(spdEntryInterface).toBeGreaterThan(spdOrbit0 + 500);
    // 21 m retro handoff at tn = 32 matches 2 * 21 m / 1.75 s = 24.0 m/s = 86.4 km/h
    expect(tel.at(32).speedKmh).toBeCloseTo(86.4, 1);
    expect(tel.at(32).verticalSpeedMs).toBeCloseTo(24.0, 1);
    expect(tel.at(33).speedKmh).toBeCloseTo(43.2, 1);
    expect(tel.at(33).verticalSpeedMs).toBeCloseTo(12.0, 1);
    expect(tel.at(34).speedKmh).toBe(0);

    // Exosphere ambient temp varies continuously across 412 km -> 150 km instead of flatlining at -145 °C
    expect(Math.abs((tel.at(0).ambientTempC ?? 0) - (tel.at(11).ambientTempC ?? 0))).toBeGreaterThan(15);

    expect(tel.at(32).altitudeKm * 1000).toBeCloseTo(POD_TOUCHDOWN_START_ALT_M, 2);
    expect(tel.at(34).altitudeKm).toBe(0);
  });

  it('computes planet-specific pressure, Max-Q, RF blackout, G-load & 100% chemical composition', () => {
    for (const kind of ['dune', 'oceanForest', 'forestRock'] as const) {
      const spec = PLANET_SPECS[kind];
      const prof = PLANET_ATMOSPHERES[kind];
      const sumPct = prof.gases.reduce((acc, g) => acc + g.pct, 0);
      expect(sumPct).toBeCloseTo(100, 5);

      const tel = new Telemetry(spec.orbital.atmosphereDensity, spec.name, 35, 1, kind);
      const orbit = tel.at(2);
      expect(orbit.staticPressureKpa).toBe(0);
      expect(orbit.atmoStatus).toBe('VACUUM TRACE');
      expect(orbit.gForce).toBeLessThan(0.05);

      const plasma = tel.at(18.6);
      expect(plasma.isMaxQ).toBe(true);
      expect(plasma.dynamicPressureKpa).toBeGreaterThan(20);
      expect(plasma.commsState).toBe('BLACKOUT');
      expect(plasma.commsSignalPct).toBe(0);
      expect(plasma.gForce).toBeGreaterThan(5.0);
      expect(plasma.atmoStatus).toBe('ANALYSIS LOCKED');

      const landed = tel.at(34.8);
      expect(landed.staticPressureKpa).toBeCloseTo(prof.surfacePressureKpa, 1);
      expect(landed.dynamicPressureKpa).toBe(0);
      expect(landed.gForce).toBeCloseTo(prof.surfaceGravityG, 2);
      expect((landed.peakG ?? 0)).toBeGreaterThan(6.0);
    }
  });
});

describe('Pod Landing Day/Night Evaluator Parity', () => {
  beforeEach(() => {
    setDayNight(true);
    resetDayNightParams('sync');
    resetShadowParams();
  });

  it('matches landed colony sky, fog, sun, moon, and terminator across NIGHT, DAWN, DAY, DUSK, and daynight=0', () => {
    const evaluator = new DescentSolarEvaluator();
    const spec = PLANET_SPECS.dune;
    const vp = makeMockViewport();
    recordViewportPlanetBase(vp, spec);

    for (const hour of [0.5, 6.0, 12.0, 18.0, 22.75]) {
      setDayNightParams({ timeOfDay: hour }, 'sync');
      syncViewportShadow(vp, spec.sky.sunColor);
      const colonySolar = applyDayNightAtmosphere(vp);
      const target = evaluator.evaluate(spec);

      expect(target.nightFactor).toBeCloseTo(1 - colonySolar.daylight, 5);
      expect(target.skyHorizon.getHexString()).toBe((vp.scene.background as THREE.Color).getHexString());
      expect(target.sunColor.getHexString()).toBe(vp.sun.color.getHexString());
      expect(target.hemiSky.getHexString()).toBe(vp.hemi.color.getHexString());
      expect(target.hemiGround.getHexString()).toBe(vp.hemi.groundColor.getHexString());

      const tel = new Telemetry(spec.orbital.atmosphereDensity, spec.name, 35, 1, 'dune').at(30);
      expect(tel.localSolarClock).toBe(colonySolar.clockText);
      expect(tel.localDayPeriod).toBe(colonySolar.period);
    }

    setDayNightParams({ timeOfDay: 23 }, 'sync');
    expect(evaluator.evaluate(spec).astroSunDir.y).toBeLessThan(-0.3);
    expect(new Telemetry(spec.orbital.atmosphereDensity, spec.name, 35, 1, 'dune').at(34.5).ambientTempC).toBeCloseTo(-9, 0);

    setDayNightParams({ timeOfDay: 12 }, 'sync');
    expect(evaluator.evaluate(spec).astroSunDir.y).toBeGreaterThan(0.6);
    expect(new Telemetry(spec.orbital.atmosphereDensity, spec.name, 35, 1, 'dune').at(34.5).ambientTempC).toBeCloseTo(43, 0);

    setDayNight(false);
    expect(evaluator.evaluate(spec).nightFactor).toBe(0);
    setDayNight(true);
  });
});

describe('OnlineSession Space-Phase Day/Night Sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs authoritative night planetTime from server while OnlineSession is still in space descent phase', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const root = document.createElement('div');
    const body = document.createElement('div');
    document.body.replaceChildren(body);
    body.appendChild(root);

    setDayNight(true);
    setDayNightParams({ timeOfDay: 11.0 }, 'sync');

    const serverSim = new SimHost({ flags: flagsFromList(['W00', 'W01']) });
    const planet = createPlanet({ id: 'pl_dev', type: 'desert', seed: 'night-sync', radius: 16 });
    spawnColonyLanding(planet, { colonyId: 0, colonyIdStr: TEST_COLONY_ID, name: 'Night Colony', q: 0, r: 0 });
    setPlanetTime(planet, { timeOfDay: 22.5, realHoursPerDay: 0.25, timeScale: 1 }, 0);
    serverSim.load(planet);

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
      wsDeps: makeNightWsDeps(serverSim),
    });

    await session.whenBooted;
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    expect(session.entities.podTouchdown.isSpacePhaseActive()).toBe(true);
    expect(getDayNightParams().timeOfDay).toBeCloseTo(22.5, 1);
    session.dispose();
  });
});

describe('DescentHud & BootOverlay DOM indicators', () => {
  it('renders reworked DescentHud gauges, phase stepper, meters switchover, RF blackout, solar sync & spectrometer', () => {
    setDayNight(true);
    setDayNightParams({ timeOfDay: 21.5 }, 'sync');
    const host = document.createElement('div');
    const hud = new DescentHud(host);
    const tel = new Telemetry(PLANET_SPECS.oceanForest.orbital.atmosphereDensity, 'Thalassa Verde', 35, 1, 'oceanForest');

    hud.update(tel.at(1.0));
    expect(host.querySelector('#d-alt-u')?.textContent).toBe('km');
    expect(host.querySelector('#d-atmo-status')?.textContent).toBe('VACUUM TRACE');
    expect(host.querySelector('#d-solar-period')?.textContent).toBe('NIGHT');
    expect(host.querySelector('#d-sys-clamps .d-sys-v')?.textContent).toBe('LOCKED');
    expect(host.querySelector('#d-sys-hatch .d-sys-v')?.textContent).toBe('SEALED');
    expect(host.querySelector('#d-guidance')?.textContent).toBe('ORBITAL NAV');
    expect(host.querySelector('#d-beacon')?.textContent).toBe('BCN STANDBY');
    expect(host.querySelector('#d-ralt')?.textContent).toBe('RALT MASKED');
    expect(host.querySelector('#d-ppo2')?.textContent).toBe('ppO₂ ---');

    hud.update(tel.at(18.8));
    expect(host.querySelector('#d-comms')?.textContent).toBe('RF BLACKOUT');
    expect(host.querySelector<HTMLElement>('#d-maxq')?.dataset.on).toBe('true');
    expect(host.querySelector<HTMLElement>('#d-g-block')?.dataset.band).toBe('crit');
    expect(host.querySelector<HTMLElement>('#d-temp-block')?.dataset.band).toBe('crit');
    expect(host.querySelector('#d-trend')?.textContent).toBe('▲');
    expect(host.querySelector('#d-sys-shield .d-sys-v')?.textContent).toBe('ABLATE');
    expect(host.querySelector('#d-guidance')?.textContent).toBe('PLASMA INERTIAL');
    expect(host.querySelector('#d-beacon')?.textContent).toBe('BCN BLACKOUT');
    expect(host.querySelector('#d-ralt')?.textContent).toBe('RALT MASKED');

    hud.update(tel.at(26.0));
    expect(host.querySelector('#d-sys-shield .d-sys-v')?.textContent).toBe('JETT');
    expect(host.querySelector('#d-sys-chute .d-sys-v')?.textContent).toBe('CANOPY');
    expect(host.querySelector('#d-sys-gear .d-sys-v')?.textContent).toBe('EXTEND');
    expect(host.querySelector('#d-guidance')?.textContent).toBe('RADAR ALT LOCK');
    expect(host.querySelector('#d-beacon')?.textContent).toBe('BCN ACQUIRED');
    expect(host.querySelector<HTMLElement>('#d-ralt')?.dataset.locked).toBe('true');

    hud.update(tel.at(32.5));
    expect(host.querySelector('#d-alt-u')?.textContent).toBe('m');
    expect(host.querySelector('#d-phase')?.textContent).toBe('RETRO-BURN');
    expect(host.querySelector('#d-atmo-sum')?.textContent).toContain('BREATHABLE');
    expect(host.querySelector('#d-sys-chute .d-sys-v')?.textContent).toBe('CUT');
    expect(host.querySelector('#d-sys-retro .d-sys-v')?.textContent).toBe('FIRING');
    expect(host.querySelector('#d-sys-gear .d-sys-v')?.textContent).toBe('LOCKED');
    expect(host.querySelector('#d-beacon')?.textContent).toBe('BCN LOCKED');
    expect(host.querySelector('#d-ralt')?.textContent).toContain('RALT 11.8 m');
    expect(host.querySelector<HTMLElement>('#d-ppo2')?.dataset.band).toBe('norm');
    expect(host.querySelector('#d-rho')?.textContent).toBe('ρ 1.478 kg/m³');

    hud.update(tel.at(34.2));
    expect(host.querySelector('#d-sys-hatch .d-sys-v')?.textContent).toBe('EQUALIZE');
    hud.update(tel.at(34.7));
    expect(host.querySelector('#d-sys-hatch .d-sys-v')?.textContent).toBe('UNLATCH');
    hud.dispose();
  });

  it('populates extended BootOverlay descent telemetry, keeps steps/labels synced, and clamps out-of-bounds progress', () => {
    setDayNight(true);
    setDayNightParams({ timeOfDay: 6.25 }, 'sync');
    const host = document.createElement('div');
    const bo = new BootOverlay(host);
    const steps = () =>
      Array.from(host.querySelectorAll<HTMLElement>('.ta-descent-phase__step')).map((s) => s.dataset.step);

    bo.showDescent({ progress: -0.4, q: 3, r: -5, landed: false, planetType: 'desert' });
    expect(bo.descentEl.hidden).toBe(false);
    expect(host.querySelector('[data-testid="descent-progress"]')?.textContent).toBe('0%');
    expect(host.querySelector('[data-testid="descent-solar"]')?.textContent).toContain('DAWN');
    expect(host.querySelector('[data-testid="descent-phase-label"]')?.textContent).toBe('ATMOSPHERIC ENTRY');
    expect(steps()).toEqual(['active', 'upcoming', 'upcoming', 'upcoming']);

    // p = 0.40 -> tn = 22.0 (19 km plasma reentry): must STILL be ATMOSPHERIC ENTRY + step 0 (ENTRY)
    bo.updateDescent({ progress: 0.4, q: 3, r: -5, planetType: 'desert' });
    expect(host.querySelector('[data-testid="descent-phase-label"]')?.textContent).toBe('ATMOSPHERIC ENTRY');
    expect(steps()).toEqual(['active', 'upcoming', 'upcoming', 'upcoming']);

    // p = 0.55 -> tn = 25.0 (canopy descent): CANOPY DESCENT + step 1 (CHUTE)
    bo.updateDescent({ progress: 0.55, q: 3, r: -5, planetType: 'desert' });
    expect(host.querySelector('[data-testid="descent-phase-label"]')?.textContent).toBe('CANOPY DESCENT');
    expect(steps()).toEqual(['done', 'active', 'upcoming', 'upcoming']);

    // p = 0.85 -> tn = 31.0 (36 m terminal retro approach): RETRO-BURN + step 2 (RETRO), NOT TOUCHDOWN
    bo.updateDescent({ progress: 0.85, q: 3, r: -5, planetType: 'desert' });
    expect(host.querySelector('[data-testid="descent-phase-label"]')?.textContent).toBe('RETRO-BURN');
    expect(steps()).toEqual(['done', 'done', 'active', 'upcoming']);

    bo.updateDescent({ progress: 1.5, q: 3, r: -5, planetType: 'desert' });
    expect(host.querySelector('[data-testid="descent-progress"]')?.textContent).toBe('100%');
    expect(host.querySelector('[data-testid="descent-phase-label"]')?.textContent).toBe('TOUCHDOWN');
    expect(steps()).toEqual(['done', 'done', 'done', 'active']);
    expect(host.querySelector('[data-testid="descent-altitude"]')?.textContent).toBe('0.0 m');
    expect(host.querySelector('[data-testid="descent-pressure"]')?.textContent).toBe('68.4 kPa');
    expect(host.querySelector('[data-testid="descent-atmo"]')?.textContent).toContain('CO₂');
    bo.dispose();
  });
});
