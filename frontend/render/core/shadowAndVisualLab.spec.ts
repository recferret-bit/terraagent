// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh, tickArchetypeMesh } from '../kitbash';
import { buildInstanced, createFoliageMaterial, makePineGeo } from '../visuals/terrain/Scatter';
import { getPixelArtParams, resetPixelArtParams } from './pixelArtPass';
import {
  computeSolarState, DEFAULT_DAY_NIGHT_PARAMS, getDayNightParams, isDayNightOn,
  recordViewportPlanetBase, resetDayNightParams, setDayNight, setDayNightParams,
} from './dayNightConfig';
import {
  getColonyVisionUniforms, isWorldPointInColonyFov, resetColonyVisionAndLights,
  updateColonyProjectorsAndVision, updateColonyVisionTexture,
} from '../lighting/ColonyVisionAndLights';
import { attachEntityProjectorRig, updateEntityProjectorRig } from '../lighting/EntityProjectorRig';
import {
  computeSunOffset, DEFAULT_SHADOW_PARAMS, followShadowTarget, getShadowParams,
  installShadowShaderPatch, isShadowOn, resetShadowParams, setShadow, setShadowParams,
  syncViewportShadow,
} from './shadowConfig';
import type { ColonyViewport } from './createColonyViewport';
import { disposeCrt, getCrtParams, initCrt, resetCrtParams } from '../ui/crt';
import { selectVisualTab, togglePixelDialog } from '../ui/pixelDialog';
import { CRT_SLIDERS, DAY_NIGHT_SLIDERS, PIXEL_SLIDERS, SHADOW_SLIDERS } from '../ui/visualLabSpecs';

function makeMockViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x9ccfff, 0x4a5a3a, 0.85);
  scene.add(hemi);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uTop: { value: new THREE.Color(0x1a2736) },
      uHorizon: { value: new THREE.Color(0x3b4d63) },
      uSunCol: { value: new THREE.Color(0xfff1d6) },
    },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 4, 4), domeMat);
  dome.name = 'planetSkyDome';
  scene.add(dome);

  return {
    renderer: { shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap } } as unknown as THREE.WebGLRenderer,
    composer: { render: () => {} } as unknown as ColonyViewport['composer'],
    bloom: { strength: 0.4, radius: 0.35, threshold: 1.1 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    scene,
    camera: new THREE.PerspectiveCamera(28, 1, 1, 600),
    sun,
    hemi,
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

describe('Dynamic shadows & sun position (shadowConfig & dayNightConfig)', () => {
  beforeEach(() => {
    resetDayNightParams('sync');
    setDayNight(true);
    resetShadowParams();
    setShadow(true);
  });

  it('patches Three.js shadow chunks with contact-hardening smooth cubic-bilinear soft shadows and indirect light attenuation', () => {
    installShadowShaderPatch();
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toContain('taSampleShadowSoft');
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toContain('taTexelCompare');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('taDirShadow');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('taSelfLit');
    expect(THREE.ShaderChunk.lights_fragment_end).toContain('taAmbOcc');
    expect(THREE.ShaderChunk.lights_fragment_end).toContain('mix( 1.0, 0.36, clamp(');
  });

  it('moves sun offset and sky-dome uSun when sunAzimuth and sunElevation change', () => {
    const vp = makeMockViewport();
    setShadowParams({ sunAzimuth: 0, sunElevation: 45 });
    const off0 = computeSunOffset();
    expect(off0.x).toBeGreaterThan(40);
    expect(Math.abs(off0.z)).toBeLessThan(1e-4);

    setShadowParams({ sunAzimuth: 90, sunElevation: 30 });
    followShadowTarget(vp, new THREE.Vector3(20, 2, -10));
    const dome = vp.scene.getObjectByName('planetSkyDome') as THREE.Mesh;
    const uSun = (dome.material as THREE.ShaderMaterial).uniforms.uSun!.value as THREE.Vector3;
    expect(uSun.z).toBeGreaterThan(45);
    expect(vp.sun.position.z - vp.sun.target.position.z).toBeCloseTo(uSun.z, 3);
    expect(vp.sun.position.y - vp.sun.target.position.y).toBeCloseTo(uSun.y, 3);
  });

  it('updates shadow camera frustum projection matrix, mapSize, biases, and intensities', () => {
    const vp = makeMockViewport();
    setShadowParams({
      mapSize: 4096,
      frustumSize: 54,
      shadowIntensity: 1.35,
      shadowSoftness: 2.4,
      normalBias: 0.04,
      shadowBias: -0.0008,
      bloomStrength: 0.75,
    });
    syncViewportShadow(vp, 0xffe2b8);
    expect(vp.sun.shadow.mapSize.x).toBe(4096);
    expect(vp.sun.shadow.camera.left).toBe(-54);
    expect(vp.sun.shadow.camera.right).toBe(54);
    // Orthographic projectionMatrix element [0] is 2 / (right - left) = 2 / 108
    expect(vp.sun.shadow.camera.projectionMatrix.elements[0]).toBeCloseTo(2 / 108, 5);
    expect(vp.sun.shadow.intensity).toBeCloseTo(1.35, 5);
    expect(vp.sun.shadow.radius).toBeCloseTo(2.4, 5);
    expect(vp.sun.shadow.normalBias).toBeCloseTo(0.04, 5);
    expect(vp.sun.shadow.bias).toBeCloseTo(-0.0008, 5);
    expect(vp.bloom.strength).toBeCloseTo(0.75, 5);
  });
});

describe('Day/night cycle sun color and shadow modulation (dayNightConfig)', () => {
  beforeEach(() => {
    resetDayNightParams('sync');
    setDayNight(true);
    resetShadowParams();
    setShadow(true);
  });

  it('changes sun color, sky dome, and shadow intensity/softness dynamically across dawn, noon, dusk, and night', () => {
    const vp = makeMockViewport();
    setShadowParams({ shadowIntensity: 1.2, shadowSoftness: 1.0 });

    // Dawn (06:15): warm amber/coral sun, low elevation, softer & lighter shadows
    setDayNightParams({ timeOfDay: 6.25, sunWarmth: 1.2 });
    syncViewportShadow(vp, 0xfff5e4);
    const dawnState = computeSolarState(getDayNightParams());
    expect(dawnState.period).toBe('DAWN');
    expect(vp.sun.color.r).toBeGreaterThan(vp.sun.color.b * 1.45);
    const dawnShadowIntensity = vp.sun.shadow.intensity;
    const dawnShadowRadius = vp.sun.shadow.radius;
    const dawnSunPos = vp.sun.position.clone();

    // Noon (12:00): high elevation, bright daylight sun, crisp full-strength shadows
    setDayNightParams({ timeOfDay: 12.0, noonTempK: 5800 });
    syncViewportShadow(vp, 0xfff5e4);
    const noonState = computeSolarState(getDayNightParams());
    expect(noonState.period).toBe('DAY');
    expect(noonState.sunElevation).toBeGreaterThan(dawnState.sunElevation + 20);
    expect(vp.sun.color.b).toBeGreaterThan(dawnState.sunColor.b);
    expect(vp.sun.shadow.intensity).toBeGreaterThan(dawnShadowIntensity);
    expect(vp.sun.shadow.radius).toBeLessThan(dawnShadowRadius);
    expect(vp.sun.position.distanceTo(dawnSunPos)).toBeGreaterThan(15);

    // Dusk (17:45): warm crimson/amber sunset
    setDayNightParams({ timeOfDay: 17.75, sunWarmth: 1.3 });
    syncViewportShadow(vp, 0xfff5e4);
    const duskState = computeSolarState(getDayNightParams());
    expect(duskState.period).toBe('DUSK');
    expect(vp.sun.color.r).toBeGreaterThan(vp.sun.color.b * 1.5);

    // Night (00:00): cool orbital blue moonlight, true dark night illumination, attenuated night shadow intensity & wider penumbra
    setDayNightParams({ timeOfDay: 0.0, nightBrightness: 0.12 });
    syncViewportShadow(vp, 0xfff5e4);
    const nightState = computeSolarState(getDayNightParams());
    expect(nightState.period).toBe('NIGHT');
    expect(vp.sun.color.b).toBeGreaterThan(vp.sun.color.r);
    expect(nightState.sunIntensityMult).toBeLessThan(0.05);
    expect(nightState.hemiIntensity).toBeLessThan(0.05);
    expect(nightState.envIntensity).toBeLessThan(0.03);
    expect(vp.sun.shadow.intensity).toBeLessThan(1.2);
    expect(vp.sun.shadow.radius).toBeGreaterThan(1.2);
  });
});

describe('Entity projector lights and restricted Field of View', () => {
  it('attaches 3D projector rigs to robots and buildings and restricts Field of View outside units and user base', () => {
    const hero = createArchetypeMesh('robot.hero', 'dune');
    const hub = createArchetypeMesh('building.commandHub', 'dune');
    const heroRig = attachEntityProjectorRig(hero, 'robot.hero');
    const hubRig = attachEntityProjectorRig(hub, 'building.commandHub');
    expect(heroRig).not.toBeNull();
    expect(hubRig).not.toBeNull();
    expect(hero.getObjectByName('entity-projector-rig')).not.toBeNull();
    expect(hub.getObjectByName('entity-projector-rig')).not.toBeNull();

    updateEntityProjectorRig(hero, 1.0, 1.0);
    expect(heroRig!.beamMat.opacity).toBeGreaterThan(0.25);
    expect(heroRig!.poolMat.opacity).toBeGreaterThan(0.20);

    updateEntityProjectorRig(hub, 1.0, 0.0);
    const waitingOpacity = hubRig!.beamMat.opacity;
    updateEntityProjectorRig(hub, 1.0, 1.0);
    expect(hubRig!.beamMat.opacity).toBeGreaterThan(waitingOpacity * 2.5);

    // Restrict Field of View to user base and owned units
    updateColonyVisionTexture({
      radius: 16,
      colonyIndex: 0,
      baseCenters: [{ x: 0, z: 0, innerRadius: 18, outerRadius: 24 }],
    });
    updateColonyProjectorsAndVision({
      projectors: [
        { x: 35, y: 1.5, z: 0, range: 15, dirX: 1, dirY: -0.3, dirZ: 0, cosAngle: 0.74, r: 0.6, g: 0.9, b: 1.0, intensity: 2.0 },
      ],
      visionSources: [
        { x: 35, z: 0, innerRadius: 12, outerRadius: 18 },
      ],
      fovEnabled: true,
      fovDim: 0.85,
      nightFactor: 1.0,
    });

    const u = getColonyVisionUniforms();
    expect(u.uFovEnabled.value).toBe(1.0);
    expect(u.uProjectorCount.value).toBe(1);
    expect(u.uVisionSourceCount.value).toBe(1);

    // Inside user base (0, 0) and near owned unit (35, 0) are in FoV; distant point (85, 85) is outside FoV
    expect(isWorldPointInColonyFov(0, 0)).toBe(true);
    expect(isWorldPointInColonyFov(40, 0)).toBe(true);
    expect(isWorldPointInColonyFov(85, 85)).toBe(false);

    resetColonyVisionAndLights();
    expect(isWorldPointInColonyFov(85, 85)).toBe(true);
    (hero.material as THREE.Material).dispose();
    (hub.material as THREE.Material).dispose();
  });
});

describe('Day/night manual sun override and viewport guards', () => {

  it('preserves manual sun angles across automatic sync/step ticks, avoids extra composer.render on frame ticks, and skips descent/non-planet viewports', () => {
    const vp = makeMockViewport();
    let renderCalls = 0;
    vp.composer.render = () => { renderCalls++; };
    setShadowParams({ sunAzimuth: 90, sunElevation: 45 });
    const manualOff = computeSunOffset().clone();

    renderCalls = 0;
    setDayNightParams({ timeOfDay: 14.0 }, 'sync');
    setDayNightParams({ timeOfDay: 15.0 }, 'step');
    expect(renderCalls).toBe(0);
    expect(computeSunOffset().distanceTo(manualOff)).toBeLessThan(1e-4);

    setDayNightParams({ timeOfDay: 6.25 }, 'user');
    expect(computeSunOffset().distanceTo(manualOff)).toBeGreaterThan(5);

    const darkVp = makeMockViewport();
    const dome = darkVp.scene.getObjectByName('planetSkyDome')!;
    darkVp.scene.remove(dome);
    darkVp.scene.background = new THREE.Color(0x0b0d11);
    darkVp.sun.color.setHex(0xfff1d6);
    setDayNightParams({ timeOfDay: 0.0 }, 'user');
    syncViewportShadow(darkVp, 0xfff1d6);
    expect((darkVp.scene.background as THREE.Color).getHex()).toBe(0x0b0d11);
    expect(darkVp.sun.color.r).toBeGreaterThan(darkVp.sun.color.b);
    expect(darkVp.sun.intensity).toBeCloseTo(DEFAULT_SHADOW_PARAMS.sunIntensity, 3);

    const descRoot = new THREE.Group();
    descRoot.name = 'descent:root';
    vp.scene.add(descRoot);
    vp.sun.color.setHex(0x123456);
    syncViewportShadow(vp, 0xfff5e4);
    expect(vp.sun.color.getHex()).toBe(0x123456);
    vp.scene.remove(descRoot);

    const base = recordViewportPlanetBase(vp, {
      sky: {
        skyColor: 0xc27b4b,
        horizonColor: 0xe6ac7c,
        fogColor: 0xe9c394,
        fogDensity: 0.0019,
        sunColor: 0xffe4be,
        sunIntensity: 3.1,
        hemiGround: 0x3b2416,
        ambientSky: 0x93a6cf,
        ambientGround: 0xc99062,
      },
    } as never);
    expect(base.hemiSky).toBe(0x93a6cf);
    expect(base.hemiGround).toBe(0xc99062);
    expect(base.skyHorizon).toBe(0xe9c394);
  });
});

describe('Colony depth shader and uniform live-tuning', () => {
  it('attaches GPU-animated customDepthMaterial to bots and buildings and live-tunes colony uniforms', () => {
    const hero = createArchetypeMesh('robot.hero', 'dune');
    expect(hero.castShadow).toBe(true);
    expect(hero.receiveShadow).toBe(true);
    expect(hero.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);

    const depthSh = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.depth.vertexShader,
      fragmentShader: THREE.ShaderLib.depth.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (hero.customDepthMaterial as THREE.MeshDepthMaterial).onBeforeCompile(depthSh, null as unknown as THREE.WebGLRenderer);
    expect(depthSh.vertexShader).toContain('bipedBodyTransform');
    expect(depthSh.fragmentShader).toContain('uBuildStage');

    tickArchetypeMesh(hero, 3.5, 0.8, 0.4);
    expect((depthSh.uniforms.uTime as THREE.IUniform).value).toBe(3.5);
    expect((depthSh.uniforms.uWalkWeight as THREE.IUniform).value).toBe(0.8);
    expect((depthSh.uniforms.uWorkWeight as THREE.IUniform).value).toBe(0.4);

    setShadowParams({ weatheringIntensity: 0.5, rimStrength: 0.62 });
    expect(hero.userData.uniforms.uRimStrength.value).toBeCloseTo(0.62, 5);
    (hero.material as THREE.Material).dispose();
  });
});

describe('Instanced props & scatter shadow depth (Scatter)', () => {
  it('computes world boundingSphere and customDepthMaterial on instanced props so off-origin trees cast shadows', () => {
    const timeU = { value: 1.2 };
    const mat = createFoliageMaterial(timeU, 0.7);
    const geo = makePineGeo(new THREE.Color(0x2f6a3c), new THREE.Color(0x3f7a43));
    const im = buildInstanced(geo, mat, [
      { x: 85, y: 2, z: -60, rot: 0, s: 0.5, r: 0.3 },
      { x: 92, y: 2, z: -55, rot: 1, s: 0.7, r: 0.6 },
    ], {});
    expect(im.castShadow).toBe(true);
    expect(im.receiveShadow).toBe(true);
    expect(im.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(im.boundingSphere).not.toBeNull();
    expect(im.boundingSphere!.center.x).toBeGreaterThan(70);
    im.dispose();
    geo.dispose();
    mat.dispose();
  });

  it('gives boulder and spire geometries deep base skirts below y=0 and 1:1 shadow depth so sloped props never float or self-shadow', async () => {
    const { makeBoulderGeo, makeSpireGeo, createRockMaterial } = await import('../visuals/terrain/Scatter');
    const boulder = makeBoulderGeo(11);
    boulder.computeBoundingBox();
    expect(boulder.boundingBox!.min.y).toBeLessThan(-0.45);
    expect(boulder.boundingBox!.max.y).toBeGreaterThan(1.0);

    const spire = makeSpireGeo(43);
    spire.computeBoundingBox();
    expect(spire.boundingBox!.min.y).toBeLessThan(-0.22);
    expect(spire.boundingBox!.max.y).toBeGreaterThan(1.05);

    const rockMat = createRockMaterial({ rough: 0.28, metal: 0.25 });
    expect(rockMat.userData.depthMaterial).toBeUndefined();
    expect(rockMat.shadowSide).toBe(THREE.DoubleSide);
    expect(rockMat.userData.receiveShadow).toBe(false);
    boulder.dispose();
    spire.dispose();
    rockMat.dispose();
  });
});

describe('Bottom-left switches bar and F8 tabbed visual settings dialog', () => {
  beforeEach(() => {
    disposeCrt();
    document.body.innerHTML = '<div id="app"><canvas></canvas></div>';
    resetCrtParams();
    resetPixelArtParams();
    resetDayNightParams('sync');
    setDayNight(true);
    resetShadowParams();
    setShadow(true);
  });

  it('mounts CRT, PIXEL, SHADOW switches and F8 button in #fx-bar and renders all 4 tabs (CRT, PIXEL, SHADOW, DAY/NIGHT)', () => {
    const host = document.getElementById('app')!;
    initCrt([host]);

    const bar = document.getElementById('fx-bar')!;
    expect(bar).not.toBeNull();
    const ids = [...bar.children].map((el) => el.id);
    expect(ids).toEqual(['crt-switch', 'pixel-switch', 'shadow-switch', 'pixel-tune']);

    const shadowBtn = document.getElementById('shadow-switch')!;
    expect(shadowBtn.getAttribute('role')).toBe('switch');
    expect(shadowBtn.getAttribute('aria-checked')).toBe('true');
    shadowBtn.click();
    expect(isShadowOn()).toBe(false);
    expect(shadowBtn.getAttribute('aria-checked')).toBe('false');

    const dlg = document.getElementById('pixel-dlg')!;
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).not.toContain('GAMEBOY');
    expect(dlg.textContent).not.toContain('FULL RGB');

    const tabs = [...dlg.querySelectorAll<HTMLElement>('.pd-tab')].map((t) => t.dataset.tab);
    expect(tabs).toEqual(['crt', 'pixel', 'shadow', 'daynight']);

    // Switch through all 4 tabs and verify every parameter slider is rendered and interactive
    selectVisualTab('crt');
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(CRT_SLIDERS.length);
    const scanInp = dlg.querySelector<HTMLInputElement>('input[data-key="scanlineIntensity"]')!;
    scanInp.value = '0.42';
    scanInp.dispatchEvent(new Event('input'));
    expect(getCrtParams().scanlineIntensity).toBeCloseTo(0.42, 3);

    selectVisualTab('pixel');
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(PIXEL_SLIDERS.length);
    const pxInp = dlg.querySelector<HTMLInputElement>('input[data-key="pixelSize"]')!;
    pxInp.value = '6';
    pxInp.dispatchEvent(new Event('input'));
    expect(getPixelArtParams().pixelSize).toBe(6);

    selectVisualTab('shadow');
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(SHADOW_SLIDERS.length);
    expect(dlg.querySelector('#pd-sun-pad')).not.toBeNull();
    expect(dlg.querySelector('#pd-sun-xyz')?.textContent).toContain('X ');
    const duskBtn = dlg.querySelector<HTMLButtonElement>('[data-sun-preset="218,22"]')!;
    duskBtn.click();
    expect(getShadowParams().sunAzimuth).toBe(218);
    expect(getShadowParams().sunElevation).toBe(22);

    const azInp = dlg.querySelector<HTMLInputElement>('input[data-key="sunAzimuth"]')!;
    azInp.value = '210';
    azInp.dispatchEvent(new Event('input'));
    expect(getShadowParams().sunAzimuth).toBe(210);
    expect(isShadowOn()).toBe(true);

    selectVisualTab('daynight');
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(DAY_NIGHT_SLIDERS.length);
    expect(dlg.querySelector('#pd-cycle-clock')).not.toBeNull();
    expect(dlg.querySelector('#pd-sun-swatch')).not.toBeNull();

    const nightPreset = dlg.querySelector<HTMLButtonElement>('[data-time-preset="0"]')!;
    nightPreset.click();
    expect(getDayNightParams().timeOfDay).toBe(0);
    expect(dlg.querySelector('#pd-cycle-clock')?.textContent).toContain('NIGHT');

    const dayLenInp = dlg.querySelector<HTMLInputElement>('input[data-key="dayLengthHours"]')!;
    dayLenInp.value = '1.5';
    dayLenInp.dispatchEvent(new Event('input'));
    expect(getDayNightParams().dayLengthHours).toBeCloseTo(1.5, 3);

    const scaleInp = dlg.querySelector<HTMLInputElement>('input[data-key="timeScale"]')!;
    scaleInp.value = '4';
    scaleInp.dispatchEvent(new Event('input'));
    expect(getDayNightParams().timeScale).toBeCloseTo(4, 3);
    expect(isDayNightOn()).toBe(true);

    togglePixelDialog(false);
    expect(dlg.classList.contains('open')).toBe(false);
    disposeCrt();
    expect(getShadowParams().sunAzimuth).toBe(210);
    resetShadowParams();
    expect(getShadowParams().sunAzimuth).toBe(DEFAULT_SHADOW_PARAMS.sunAzimuth);
    resetDayNightParams('sync');
    expect(getDayNightParams().timeOfDay).toBe(DEFAULT_DAY_NIGHT_PARAMS.timeOfDay);
  });
});
