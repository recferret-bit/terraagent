// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh, tickArchetypeMesh } from '../kitbash';
import { buildInstanced, createFoliageMaterial, makePineGeo } from '../visuals/terrain/Scatter';
import { getPixelArtParams, resetPixelArtParams } from './pixelArtPass';
import {
  computeSunOffset, DEFAULT_SHADOW_PARAMS, followShadowTarget, getShadowParams,
  installShadowShaderPatch, isShadowOn, resetShadowParams, setShadow, setShadowParams,
  syncViewportShadow,
} from './shadowConfig';
import type { ColonyViewport } from './createColonyViewport';
import { disposeCrt, getCrtParams, initCrt, resetCrtParams } from '../ui/crt';
import { selectVisualTab, togglePixelDialog } from '../ui/pixelDialog';
import { CRT_SLIDERS, PIXEL_SLIDERS, SHADOW_SLIDERS } from '../ui/visualLabSpecs';

function makeMockViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x9ccfff, 0x4a5a3a, 0.85);
  scene.add(hemi);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) } },
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

describe('Dynamic shadows & sun position (shadowConfig)', () => {
  beforeEach(() => {
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
    resetShadowParams();
    setShadow(true);
  });

  it('mounts CRT, PIXEL, SHADOW switches and F8 button in #fx-bar with matching PIXEL/F8 size and no RGB/GAMEBOY modes', () => {
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
    expect(tabs).toEqual(['crt', 'pixel', 'shadow']);

    // Switch through all 3 tabs and verify every parameter slider is rendered and interactive
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

    togglePixelDialog(false);
    expect(dlg.classList.contains('open')).toBe(false);
    disposeCrt();
    expect(getShadowParams().sunAzimuth).toBe(210);
    resetShadowParams();
    expect(getShadowParams().sunAzimuth).toBe(DEFAULT_SHADOW_PARAMS.sunAzimuth);
  });
});
