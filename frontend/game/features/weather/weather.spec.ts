import type { SimEventWire } from '@terra/contracts';
import { getWeatherUniforms, setWeather, setWeatherParams, tickWeatherClock, triggerWeatherAction } from '@terra/render/core/weatherConfig';
import { setWindParams } from '@terra/render/core/windConfig';
import { getColonyVisionUniforms, isWorldPointInColonyFov, resetColonyVisionAndLights, updateColonyProjectorsAndVision, updateColonyVisionTexture } from '@terra/render/lighting/ColonyVisionAndLights';
import { LightningStrikeFx, MeteorStrikeFx, patchWeatherParams, readWeatherParams, ScreenWeatherOverlay, TwisterFx } from '@terra/render/weather';
import {
  compileData, createPipeline, createState, DEPOSIT, ENTITY_KIND, ENTITY_STATE, getHqRespawn, hasAliveHq, hexIndex,
  HQ_RESPAWN_TICKS, landing, PREP, setTileDeposit, setTilePrep, setTileTerrain, spawnColonyLanding, step, TERRAIN,
  triggerLightningStrike, triggerMeteorImpact, view,
} from '@terra/sim';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PodTouchdownFx } from '../../app/online/PodTouchdownFx';
import { isGameInputBlocked, resetGameInputBlock } from '../../core/input/gameInputBlock';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import { packEntities } from '../../store/replica/viewCodec';
import { installMockDocument, MockElement } from '../test-dom';
import weatherFeature, { WeatherHazardRenderer } from './index';

const makeSend = (res: CommandResult = { ok: true, appliedAtTick: 88 }) => vi.fn(async () => res);
const runCmd = async (line: string, services: Record<string, unknown> = {}) => {
  const runner = new CommandRunner([weatherFeature], { flags: new Set(['W05']), host: 'local', services: services as unknown as FeatureContext['services'] });
  const r = await runner.run(line);
  return r?.kind === 'text' ? r.text : '';
};

function resetTestWeather(): void {
  installMockDocument();
  setWeather(true, 'sync');
  setWeatherParams({ rainIntensity: 0, stormActive: false, stormDarkness: 0, lightningFlash: 1.0, meteorShadowScale: 1.0, twisterHeight: 18.0 }, 'sync');
  setWindParams({ strength: 0.8 }, 'sync');
  getWeatherUniforms().uWaterElectroIntensity.value = 0;
  getWeatherUniforms().uPuddleElectroIntensity.value = 0;
}

describe('weather dev console commands — meteor & twister (W05)', () => {
  beforeEach(resetTestWeather);

  it('meteor sends dev.meteor with explicit [q r] or camera/HQ fallback', async () => {
    const sendCommand = makeSend();
    const out = await runCmd('meteor 6 -3', { sendCommand });
    expect(out).toContain('dev.meteor ok (tick 88)');
    expect(sendCommand).toHaveBeenCalledWith('dev.meteor', { q: 6, r: -3, hexCount: 37, colonyIndex: 0 });
    await runCmd('meteor', { sendCommand, rtsCamera: { target: { x: 8, y: 0, z: 0 } } });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.meteor', { q: 4, r: 0, hexCount: 37, colonyIndex: 0 });
  });

  it('twister auto-configures high wind + minor rain when needed and spawns twister on first command', async () => {
    const sendCommand = makeSend();
    const out = await runCmd('twister 3 -2 45', { sendCommand });
    expect(out).toContain('dev.twister ok (tick 88)');
    expect(out).toContain('Auto-configured HIGH wind (135%) + MINOR rain (35%) and spawned Twister at (3, -2)');
    expect(sendCommand).toHaveBeenCalledWith('dev.setwind', { pct: 135 });
    expect(sendCommand).toHaveBeenCalledWith('dev.rain', { level: 'minor', intensity: 0.35 });
    expect(sendCommand).toHaveBeenCalledWith('dev.twister', { q: 3, r: -2, dirDeg: 45, colonyIndex: 0 });

    resetTestWeather();
    const previewOut = await runCmd('twister 1 1', {});
    expect(previewOut).toContain('dev.twister preview');
    expect(previewOut).toContain('Auto-configured HIGH wind (135%) + MINOR rain (35%) and spawned Twister at (1, 1)');
    expect(previewOut).toContain('READY');

    sendCommand.mockClear();
    setWindParams({ strength: 1.5 }, 'sync');
    patchWeatherParams({ rainIntensity: 0.3 });
    const unlockedOut = await runCmd('twister 1 1', { sendCommand });
    expect(unlockedOut).toContain('rising twister at (1, 1)');
    expect(unlockedOut).toContain('READY');
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
});

describe('weather dev console commands — lightning, storm & rain (W05)', () => {
  beforeEach(resetTestWeather);

  it('lightning sends dev.lightning with 4-hex target and optional + rain flag', async () => {
    const sendCommand = makeSend();
    await runCmd('lightning 4 -1', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.lightning', {
      q: 4,
      r: -1,
      hexCount: 4,
      colonyIndex: 0,
    });

    await runCmd('lightning 2 3 + rain', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.lightning', {
      q: 2,
      r: 3,
      hexCount: 4,
      rain: true,
      colonyIndex: 0,
    });
    expect(readWeatherParams().rainIntensity).toBeGreaterThanOrEqual(0.35);
  });

  it('storm and rain commands configure planet weather state', async () => {
    const sendCommand = makeSend();
    await runCmd('storm on', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.storm', {
      active: true,
      rain: 'heavy',
      lightning: true,
      colonyIndex: 0,
    });
    expect(readWeatherParams().stormActive).toBe(true);

    await runCmd('storm off', { sendCommand });
    expect(readWeatherParams().stormActive).toBe(false);

    await runCmd('rain minor', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.rain', {
      level: 'minor',
      intensity: 0.3,
      colonyIndex: 0,
    });
    expect(readWeatherParams().rainIntensity).toBeCloseTo(0.3);

    await runCmd('rain 75', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.rain', {
      level: 'heavy',
      intensity: 0.75,
      colonyIndex: 0,
    });
  });
});

describe('3D weather VFX — ScreenWeatherOverlay & MeteorStrikeFx', () => {
  beforeEach(resetTestWeather);

  it('ScreenWeatherOverlay transitions through shadow-full -> shadow-shrink -> flash-constant -> flash-fade -> idle', () => {
    const parent = new MockElement('div') as unknown as HTMLElement;
    const overlay = new ScreenWeatherOverlay(parent);
    expect(overlay.el?.getAttribute('data-testid')).toBe('weather-screen-overlay');
    expect(overlay.el?.style.pointerEvents).toBe('none');

    overlay.triggerMeteorScreenSequence(() => ({ x: 0.4, y: 0.6 }));
    expect(overlay.getMeteorPhase()).toBe('shadow-full');
    expect(overlay.el?.getAttribute('data-phase')).toBe('shadow-full');

    overlay.update(1.25);
    expect(overlay.getMeteorPhase()).toBe('shadow-shrink');
    expect(overlay.el?.getAttribute('data-phase')).toBe('shadow-shrink');

    overlay.update(0.95);
    expect(overlay.getMeteorPhase()).toBe('flash-constant');
    expect(overlay.el?.getAttribute('data-phase')).toBe('flash-constant');

    overlay.update(0.35);
    expect(overlay.getMeteorPhase()).toBe('flash-fade');

    overlay.update(0.5);
    expect(overlay.getMeteorPhase()).toBe('idle');

    overlay.triggerLightningScreenFlash(1.0);
    expect(overlay.isLightningFlashActive()).toBe(true);
    expect(overlay.el?.getAttribute('data-lightning-flash')).toBe('true');
    overlay.update(0.4);
    expect(overlay.isLightningFlashActive()).toBe(false);
    expect(overlay.el?.getAttribute('data-lightning-flash')).toBe('false');
    overlay.dispose();
  });

  it('MeteorStrikeFx animates descent (0..2.15s) and impact explosion + debris bounce (2.15..4.65s)', () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const meteorFx = new MeteorStrikeFx(scene, { onShake: (a) => shakes.push(a) });
    meteorFx.strikeTile(2, -1, () => 0, [{ q: 2, r: -1 }, { q: 3, r: -1 }]);
    expect(meteorFx.getActiveCount()).toBe(1);
    meteorFx.update(0.5);
    const earlyShake = shakes[shakes.length - 1]!;
    meteorFx.update(1.0);
    const lateDescentShake = shakes[shakes.length - 1]!;
    expect(earlyShake).toBeGreaterThan(0.01);
    expect(lateDescentShake).toBeGreaterThan(earlyShake);
    expect(lateDescentShake).toBeLessThanOrEqual(0.36);
    meteorFx.update(0.75);
    expect(shakes[shakes.length - 1]).toBeGreaterThanOrEqual(1.0);
    expect(meteorFx.getCameraShake()).toBeGreaterThan(0);
    meteorFx.update(3.0);
    expect(meteorFx.getActiveCount()).toBe(0);
    meteorFx.dispose();
  });
});

describe('3D weather VFX — TwisterFx, LightningStrikeFx & WeatherHazardRenderer', () => {
  beforeEach(resetTestWeather);

  it('TwisterFx rises, moves, and sucks trees and units that spiral up and fall to their death', () => {
    const scene = new THREE.Scene();
    const twisterFx = new TwisterFx(scene);
    const id = twisterFx.spawnTwister({ q: 0, r: 0, dirDeg: 30, previewVictims: true });
    expect(twisterFx.getActiveCount()).toBe(1);
    expect(twisterFx.getTotalVictimCount()).toBeGreaterThanOrEqual(2);
    twisterFx.update(1.0);
    twisterFx.update(1.4);
    twisterFx.syncTwisters(
      [{ twisterId: id, q: 2, r: 1, dirRad: 0.5, uprootedTrees: [{ q: 2, r: 1 }], suckedUnits: [{ entityId: 77, q: 2, r: 2 }] }],
      () => 0,
      10,
    );
    expect(twisterFx.getTotalVictimCount()).toBeGreaterThanOrEqual(4);
    twisterFx.dispose();
  });

  it('LightningStrikeFx strikes 4 staggered hexes, separates water vs puddle electrocution, and spawns overload arcs', () => {
    const scene = new THREE.Scene();
    const lightningFx = new LightningStrikeFx(scene);
    const strikeSpy = vi.spyOn(lightningFx.lightningSystem, 'strikeAt');
    const arcSpy = vi.spyOn(lightningFx.lightningSystem, 'spawnGridOverloadArc');

    // Strike on land: electrocutes interconnected land puddles only, NOT water
    lightningFx.strikeFourHexes([{ q: 0, r: 0 }], () => 0.25, () => false);
    expect(getWeatherUniforms().uPuddleElectroIntensity.value).toBe(1.0);
    expect(getWeatherUniforms().uWaterElectroIntensity.value).toBe(0);
    expect(strikeSpy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) lightningFx.update(0.05);
    expect(strikeSpy).toHaveBeenCalledTimes(4);
    tickWeatherClock(2000);
    tickWeatherClock(2100);
    expect(getWeatherUniforms().uPuddleElectroIntensity.value).toBeCloseTo(1.0 - 0.1 * 0.95, 5);

    // Strike on water: electrocutes water only, NOT land puddles
    getWeatherUniforms().uPuddleElectroIntensity.value = 0;
    getWeatherUniforms().uWaterElectroIntensity.value = 0;
    lightningFx.strikeFourHexes([{ q: 3, r: 3 }], () => -0.35, () => true);
    expect(getWeatherUniforms().uWaterElectroIntensity.value).toBe(1.0);
    expect(getWeatherUniforms().uPuddleElectroIntensity.value).toBe(0);
    lightningFx.syncOverloadedBuildings([{ entityId: 12, x: 4, y: 0, z: 4 }]);
    expect(lightningFx.getOverloadedCount()).toBe(1);
    lightningFx.update(0.2);
    expect(arcSpy).toHaveBeenCalled();
    lightningFx.syncOverloadedBuildings([]);
    expect(lightningFx.getOverloadedCount()).toBe(0);
    lightningFx.dispose();
  });
});

describe('WeatherHazardRenderer event deduplication & blob sync', () => {
  beforeEach(resetTestWeather);

  it('WeatherHazardRenderer bridges F8 actions, deduplicates sim events, and syncs blobs.weather', () => {
    const scene = new THREE.Scene();
    const sendCommand = makeSend();
    const renderListeners: Array<(e: readonly SimEventWire[]) => void> = [];
    const serverListeners: Array<(e: readonly SimEventWire[]) => void> = [];
    const ctx: FeatureContext = {
      flags: new Set(['W05']),
      host: 'local',
      services: {
        sendCommand,
        scene3d: { scene, tileToWorld: (q: number, r: number) => ({ x: q * 2, y: 0, z: r * 2 }), biomeKey: () => 'forestRock' },
        store: {
          onRenderEvents: (fn: (e: readonly SimEventWire[]) => void) => { renderListeners.push(fn); return () => {}; },
          onServerEvents: (fn: (e: readonly SimEventWire[]) => void) => { serverListeners.push(fn); return () => {}; },
        },
      } as unknown as FeatureContext['services'],
    };
    const renderer = new WeatherHazardRenderer(ctx);

    triggerWeatherAction('twister-ready');
    expect(sendCommand).toHaveBeenCalledWith('dev.setwind', { pct: 150 });
    triggerWeatherAction('meteor', { q: 5, r: -2 });
    expect(renderer.meteorFx?.getActiveCount()).toBe(1);

    const impactEv: SimEventWire = { atTick: 12, colonyIds: [0], kind: 'meteorImpact', severity: 'warn', data: { q: 5, r: -2 } };
    renderListeners.forEach((fn) => fn([impactEv]));
    serverListeners.forEach((fn) => fn([impactEv]));
    expect(renderer.meteorFx?.getActiveCount()).toBe(1);

    const lightningEv: SimEventWire = {
      atTick: 15, colonyIds: [0], kind: 'lightningStrike', severity: 'warn',
      data: { q: -3, r: 4, tiles: [{ q: -3, r: 4 }, { q: -2, r: 4 }, { q: -3, r: 5 }, { q: -4, r: 5 }] },
    };
    renderListeners.forEach((fn) => fn([lightningEv]));
    serverListeners.forEach((fn) => fn([lightningEv]));
    expect(renderer.lightningFx?.getTotalStrikesTriggered()).toBe(1);

    const entities = packEntities([{ id: 10, kind: 3, owner: 0, tier: 1, q: 1, r: 1, x: 1, y: 1, rot: 0, hp: 50, hpMax: 100, state: 1, progress: 1 }]);
    renderer.update(
      {
        sim: {
          serverTick: 20, predicting: true,
          view: {
            tick: 20, planet: { id: 'p1', type: 'temperate', radius: 16 }, entities, count: 1, colonies: [],
            blobs: { weather: { rainIntensity: 0.4, stormActive: true, overloadUntilByEntity: { '10': 50 }, activeTwisters: [{ twisterId: 3, q: 2, r: 2, dirRad: 1.0 }] } },
          },
        },
      },
      0.1,
    );
    expect(readWeatherParams().stormActive).toBe(true);
    expect(renderer.lightningFx?.getOverloadedCount()).toBe(1);
    expect(renderer.twisterFx?.getActiveCount()).toBe(1);
    renderer.dispose();
  });
});

describe('F8 weather & wind user edit sync and first-click twister', () => {
  beforeEach(resetTestWeather);

  it('syncs F8 rain/wind user edits to sim commands, protects local edits during update, and auto-configures twister on first click', () => {
    const scene = new THREE.Scene();
    const sendCommand = makeSend();
    const renderer = new WeatherHazardRenderer({
      flags: new Set(['W05']), host: 'local',
      services: { sendCommand, scene3d: { scene, tileToWorld: (q: number, r: number) => ({ x: q * 2, y: 0, z: r * 2 }), biomeKey: () => 'forestRock' } } as unknown as FeatureContext['services'],
    });
    setWeatherParams({ rainIntensity: 0.42 }, 'user');
    expect(sendCommand).toHaveBeenCalledWith('dev.rain', { level: 'minor', intensity: 0.42 });
    setWindParams({ strength: 1.35 }, 'user');
    expect(sendCommand).toHaveBeenCalledWith('dev.setwind', { pct: 135 });

    renderer.update({ sim: { serverTick: 25, predicting: false, view: { tick: 25, planet: { id: 'p1', type: 'temperate', radius: 16 }, entities: packEntities([]), count: 0, colonies: [], blobs: { weather: { rainIntensity: 0, stormActive: false } } } } }, 0.016);
    expect(readWeatherParams().rainIntensity).toBeCloseTo(0.42);

    resetTestWeather();
    sendCommand.mockClear();
    triggerWeatherAction('twister', { q: 2, r: -1 });
    expect(sendCommand).toHaveBeenCalledWith('dev.setwind', { pct: 135 });
    expect(sendCommand).toHaveBeenCalledWith('dev.rain', { level: 'minor', intensity: 0.35 });
    expect(sendCommand).toHaveBeenCalledWith('dev.twister', { q: 2, r: -1, colonyIndex: 0 });
    expect(renderer.twisterFx?.getActiveCount()).toBe(1);
    renderer.dispose();
  });

  it('melted meteor crater illuminates the nearest area without affecting user Fog of War and cools down over time', () => {
    resetColonyVisionAndLights();
    const meteorFx = new MeteorStrikeFx(new THREE.Scene());
    const site = meteorFx.spawnPersistentCrater(12, -8, { q: 4, r: -2 });
    const visionUniforms = getColonyVisionUniforms();
    expect(site.heatGlow).toBeCloseTo(1.0, 2);
    expect(site.pointLight.visible).toBe(true);
    expect(site.pointLight.intensity).toBeGreaterThan(3.0);
    expect(visionUniforms.uProjectorCount.value).toBeGreaterThanOrEqual(1);
    expect(visionUniforms.uVisionSourceCount.value).toBe(0);

    meteorFx.update(18.0);
    expect(site.heatGlow).toBeLessThan(0.65);
    expect(site.heatGlow).toBeGreaterThan(0.15);
    expect(site.decalMat.uniforms.uHeatGlow!.value).toBeCloseTo(site.heatGlow, 4);
    expect(site.boulderMat.uniforms.uHeatGlow!.value).toBeCloseTo(site.heatGlow, 4);

    meteorFx.update(25.0);
    expect(site.heatGlow).toBe(0);
    expect(site.pointLight.visible).toBe(false);
    expect(visionUniforms.uProjectorCount.value).toBe(0);
    expect(meteorFx.getCraterCount()).toBe(1);

    updateColonyVisionTexture({ radius: 16, colonyIndex: 0 });
    updateColonyProjectorsAndVision({ projectors: [], visionSources: [{ x: 0, z: 0, innerRadius: 8, outerRadius: 12 }], fovEnabled: true });
    const hiddenSite = meteorFx.spawnPersistentCrater(80, -80, { q: 25, r: -25 });
    meteorFx.update(0.1);
    expect(visionUniforms.uVisionSourceCount.value).toBe(1);
    expect(isWorldPointInColonyFov(80, -80)).toBe(false);
    expect(hiddenSite.pointLight.visible).toBe(false);
    expect(hiddenSite.embers[0]?.mesh.visible).toBe(false);
    expect(visionUniforms.uProjectorCount.value).toBe(0);
    meteorFx.dispose();
    resetColonyVisionAndLights();
  });
});

describe('4-hex lightning aftermath & meteor descent-to-impact sync', () => {
  beforeEach(resetTestWeather);

  it('triggerLightningStrike carves 4-hex impassable holes, wipes trees/deposits, and creates a persistent 4-hex aftermath site', () => {
    const state = createState({ planetId: 'p_lightning', planetType: 'temperate', seed: 'lightning-wipe', radius: 8 });
    const hx = hexIndex(state.grid.radius);
    const i0 = hx.indexOf(2, 1), i1 = hx.indexOf(3, 1), i2 = hx.indexOf(2, 2), i3 = hx.indexOf(1, 2);
    setTileTerrain(state, i0, TERRAIN.forest, 0);
    setTileTerrain(state, i1, TERRAIN.forest, 0);
    setTileDeposit(state, i1, DEPOSIT.metals, 8000, 0, 2);
    setTileTerrain(state, i2, TERRAIN.flat, 0);
    setTileDeposit(state, i2, DEPOSIT.minerals, 6500, 0, 1);
    setTileTerrain(state, i3, TERRAIN.forest, 0);

    expect(triggerLightningStrike(state, { q: 2, r: 1, hexCount: 4, colonyIndex: 0 }).ok).toBe(true);
    for (const idx of [i0, i1, i2, i3]) {
      expect(state.grid.layers.terrain[idx]).toBe(TERRAIN.hole);
      expect(state.grid.layers.deposit?.[idx]).toBe(DEPOSIT.none);
      expect(state.grid.layers.richness?.[idx]).toBe(0);
    }
    const scene = new THREE.Scene();
    const uiParent = new MockElement('div') as unknown as HTMLElement;
    const renderer = new WeatherHazardRenderer({
      flags: new Set(['W05']), host: 'local',
      services: { scene3d: { scene, tileToWorld: () => ({ x: 0, z: 0 }) } as never, uiParent } as unknown as FeatureContext['services'],
    });
    const v = view(state);
    renderer.update({ sim: { serverTick: v.tick, predicting: false, view: { ...v, entities: packEntities(v.entities), count: v.entities.length } } }, 0.1);
    expect(renderer.lightningFx?.getAftermathCount()).toBe(1);
    renderer.dispose();
  });

  it('delays HQ respawn modal and crater spawn until the meteor finishes its 2.15s sky descent and impacts', () => {
    resetGameInputBlock();
    const flags = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05']);
    const data = compileData(flags);
    const pipeline = createPipeline({ flags, data, systems: [landing], handlers: [] });
    const state = createState({ planetId: 'p_sync', planetType: 'temperate', seed: 'sync-seed', radius: 10 });
    expect(spawnColonyLanding(state, { colonyId: 0, q: 0, r: 0, data }).ok).toBe(true);
    for (let t = 0; t < 35; t++) step(state, [], 1, pipeline);
    const scene = new THREE.Scene();
    const uiParent = new MockElement('div') as unknown as HTMLElement;
    const renderer = new WeatherHazardRenderer({
      flags, host: 'local',
      services: { scene3d: { scene, tileToWorld: () => ({ x: 0, z: 0 }) } as never, uiParent } as unknown as FeatureContext['services'],
    });
    const v0 = view(state);
    renderer.update({ sim: { serverTick: v0.tick, predicting: false, view: { ...v0, entities: packEntities(v0.entities), count: v0.entities.length } } }, 0.016);
    expect(triggerMeteorImpact(state, { q: 0, r: 0, colonyIndex: 0 }).ok).toBe(true);
    const vDead = view(state);
    renderer.update({ sim: { serverTick: vDead.tick, predicting: false, view: { ...vDead, entities: packEntities(vDead.entities), count: vDead.entities.length } } }, 0.5);
    expect(renderer.meteorFx?.hasDescendingStrike()).toBe(true);
    expect(renderer.meteorFx?.getCraterCount()).toBe(0);
    expect(renderer.hqRespawnModal.isOpen()).toBe(false);
    renderer.update({ sim: { serverTick: vDead.tick, predicting: false, view: { ...vDead, entities: packEntities(vDead.entities), count: vDead.entities.length } } }, 1.8);
    expect(renderer.meteorFx?.hasDescendingStrike()).toBe(false);
    expect(renderer.meteorFx?.getCraterCount()).toBe(1);
    expect(renderer.hqRespawnModal.isOpen()).toBe(true);
    renderer.dispose();
  });
});

describe('HQ Explorer destruction, 30s countdown modal & replacement pod landing', () => {
  beforeEach(resetTestWeather);

  it('destroying HQ Explorer triggers unskippable 30s countdown and lands replacement pod on closest terraformed ground', () => {
    resetGameInputBlock();
    const flags = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05']);
    const data = compileData(flags);
    const pipeline = createPipeline({ flags, data, systems: [landing], handlers: [] });
    const state = createState({ planetId: 'p_respawn', planetType: 'temperate', seed: 'respawn-seed', radius: 12 });
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) { setTileTerrain(state, i, TERRAIN.forest, 0); setTilePrep(state, i, PREP.wild, 0); }
    expect(spawnColonyLanding(state, { colonyId: 0, q: 0, r: 0, data }).ok).toBe(true);
    for (let t = 0; t < 35; t++) step(state, [], 1, pipeline);
    expect(hasAliveHq(state, 0)).toBe(true);

    // Leave only (0, 0) and a surviving terraformed tile at (5, 0) outside the 37-hex (radius-3) meteor crater
    for (let i = 0; i < state.grid.count; i++) { setTileTerrain(state, i, TERRAIN.forest, state.meta.tick); setTilePrep(state, i, PREP.wild, state.meta.tick); }
    const survivingIdx = hx.indexOf(5, 0);
    setTileTerrain(state, survivingIdx, TERRAIN.flat, state.meta.tick);
    setTilePrep(state, survivingIdx, PREP.prepared, state.meta.tick);

    const uiParent = new MockElement('div') as unknown as HTMLElement;
    const focused: Array<{ q: number; r: number }> = [];
    const renderer = new WeatherHazardRenderer({
      flags, host: 'local',
      services: { uiParent, focusTile: (q: number, r: number) => focused.push({ q, r }) } as unknown as FeatureContext['services'],
    });

    const v0 = view(state);
    renderer.update({ sim: { serverTick: v0.tick, predicting: false, view: { ...v0, entities: packEntities(v0.entities), count: v0.entities.length } } }, 0.016);
    expect(renderer.hqRespawnModal.isOpen()).toBe(false);

    expect(triggerMeteorImpact(state, { q: 0, r: 0, colonyIndex: 0 }).ok).toBe(true);
    expect(hasAliveHq(state, 0)).toBe(false);
    expect(getHqRespawn(state, 0)).toMatchObject({ q: 5, r: 0 });

    const vDead = view(state);
    renderer.update({ sim: { serverTick: vDead.tick, predicting: false, view: { ...vDead, entities: packEntities(vDead.entities), count: vDead.entities.length } } }, 0.1);
    expect(renderer.hqRespawnModal.isOpen()).toBe(true);
    expect(isGameInputBlocked()).toBe(true);
    expect(renderer.hqRespawnModal.getTargetTile()).toEqual({ q: 5, r: 0 });

    for (let t = 0; t < HQ_RESPAWN_TICKS; t++) step(state, [], 1, pipeline);
    const vPod = view(state);
    const descendingPod = vPod.entities.find((e) => e.kind === ENTITY_KIND.pod && e.owner === 0 && e.state === ENTITY_STATE.descending);
    expect(descendingPod).toMatchObject({ q: 5, r: 0 });

    const tdFx = new PodTouchdownFx(new THREE.Scene(), false, 'skip');
    expect(tdFx.computeState(false, 1, 1).state).toBe('done');
    expect(tdFx.computeState(true, 0, descendingPod!.id).state).toBe('retro');
    tdFx.dispose();

    renderer.update({ sim: { serverTick: vPod.tick, predicting: false, view: { ...vPod, entities: packEntities(vPod.entities), count: vPod.entities.length } } }, 0.1);
    expect(renderer.hqRespawnModal.isOpen()).toBe(false);
    expect(isGameInputBlocked()).toBe(false);
    expect(focused).toContainEqual({ q: 5, r: 0 });

    for (let t = HQ_RESPAWN_TICKS; t < 300; t++) step(state, [], 1, pipeline);
    expect(hasAliveHq(state, 0)).toBe(true);
    expect(view(state).entities.find((e) => e.kind === ENTITY_KIND.hq && e.owner === 0 && e.hp > 0)).toMatchObject({ q: 5, r: 0 });
    renderer.dispose();
  });
});
