import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { PlanetSpec } from '../planets/PlanetSpec';
import { createPixelArtPass, onPixelArtChange, setPixelArtSize } from './pixelArtPass';
import { recordViewportPlanetBase } from './dayNightConfig';
import { tickWeatherClock } from './weatherConfig';
import { tickWindClock } from './windConfig';
import { updateViewFocus } from './viewFocus';
import { createViewFocusRing } from './viewFocusRing';
import { isFocusRingOn, perfTelemetry } from './perfConfig';
import { createRenderScaleController } from './renderScale';
import { tickWaterClock } from '../visuals/water/waterConfig';
import { createWaterReflectionPass } from '../visuals/water/reflection/WaterReflectionPass';
import { excludeFromReflection } from '../visuals/water/reflection/reflectionRegistry';
import { createRainAndStormPass } from '../weather/RainAndStormPass';
import {
  fitShadowToView, followShadowTarget, installShadowShaderPatch, isShadowOn,
  registerShadowViewport, stepSunOrbit, syncViewportShadow,
} from './shadowConfig';

export interface ColonyViewport {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  pixelArt: ShaderPass;
  /** Default diorama scene/camera (28° telephoto). Systems may swap via setView(). */
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  secondaryShadowLight?: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Shared PMREM RoomEnvironment — assign to any scene.environment you create. */
  environment: THREE.Texture;
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  /** Re-tint sky/fog/sun/exposure from a planet spec (surface-level look). */
  applySky(spec: PlanetSpec): void;
  /** Keep the shadow frustum centred (1m-quantised) on a ground target. */
  followShadow(target: THREE.Vector3): void;
  /** Lock the internal render buffer to a preset W×H (at DPR 1), or pass null for native container size. */
  setResolution(size: { width: number; height: number } | null, maxPixelRatio?: number): void;
  resize(): void;
  render(): void;
  dispose(): void;
}

function createSunAndHemi(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight(0x9ccfff, 0x4a5a3a, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  sun.position.set(35, 55, 25);
  sun.castShadow = isShadowOn();
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 175;
  const d = 38;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 1.3;
  sun.shadow.intensity = 1.05;
  scene.add(sun, sun.target);

  const secondaryShadowLight = new THREE.DirectionalLight(0x9cc4ff, 1.35);
  secondaryShadowLight.name = 'secondaryShadowLight';
  secondaryShadowLight.position.set(-32, 44, -38);
  secondaryShadowLight.castShadow = isShadowOn();
  secondaryShadowLight.shadow.mapSize.set(1024, 1024);
  secondaryShadowLight.shadow.camera.near = 8;
  secondaryShadowLight.shadow.camera.far = 138;
  Object.assign(secondaryShadowLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  secondaryShadowLight.shadow.camera.updateProjectionMatrix();
  secondaryShadowLight.shadow.bias = -0.00005;
  secondaryShadowLight.shadow.normalBias = 0.006;
  secondaryShadowLight.shadow.radius = 1.25;
  secondaryShadowLight.shadow.intensity = 0.72;
  scene.add(secondaryShadowLight, secondaryShadowLight.target);
  return { sun, secondaryShadowLight, hemi };
}

function applySkyToScene(scene: THREE.Scene, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, renderer: THREE.WebGLRenderer, spec: PlanetSpec) {
  const k = spec.sky;
  (scene.background as THREE.Color).set(k.fogColor);
  (scene.fog as THREE.FogExp2).color.set(k.fogColor);
  (scene.fog as THREE.FogExp2).density = k.fogDensity;
  sun.color.set(k.sunColor);
  sun.intensity = k.sunIntensity;
  hemi.color.set(k.ambientSky ?? k.skyColor);
  hemi.groundColor.set(k.ambientGround ?? k.hemiGround);
  hemi.intensity = k.hemiIntensity;
  renderer.toneMappingExposure = k.exposure;
}

function createColonyRenderer(container: HTMLElement, width: number, height: number, maxDpr: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(maxDpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = isShadowOn();
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.dataset.pixelShader = '1';
  container.appendChild(renderer.domElement);
  return renderer;
}

/** The default diorama scene (sky-blue background + exp fog) and its 28° telephoto camera. */
function createDefaultView(aspect: number) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9dcef);
  scene.fog = new THREE.FogExp2(0xb9dcef, 0.007);
  const camera = new THREE.PerspectiveCamera(28, aspect, 1, 600);
  camera.position.set(42, 46, 42);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

/** Render → selective bloom (threshold 1.1) → output → pixel-art post chain. */
function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.45, 0.35, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const pixelArt = createPixelArtPass(width, height);
  composer.addPass(pixelArt);
  const offPixel = onPixelArtChange((enabled) => { pixelArt.enabled = enabled; composer.render(); });
  return { composer, renderPass, bloom, pixelArt, offPixel };
}

/** Shared PMREM RoomEnvironment (pillar 4 IBL), assigned to the default scene. */
function createEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.75;
  return { pmrem, environment };
}

/**
 * Planar water reflections for whatever scene / camera the render pass shows (`setView` swaps them). Overlays and light
 * effects stay out of the mirror by the pass's material rule (`reflectionOverlays.ts`); the view-focus debug ring
 * (`viewFocusRing.ts`, a direct scene child once shown) is excluded explicitly, as its quad line is opaque.
 */
function createViewportReflections(renderer: THREE.WebGLRenderer, renderPass: RenderPass) {
  const pass = createWaterReflectionPass();
  let offRing: (() => void) | null = null;
  return {
    render() {
      const scene = renderPass.scene as THREE.Scene;
      if (!offRing && isFocusRingOn()) {
        const ring = scene.children.find((c) => c.name === 'viewFocusRing');
        if (ring) offRing = excludeFromReflection(ring);
      }
      pass.render(renderer, scene, renderPass.camera);
    },
    dispose() { offRing?.(); pass.dispose(); },
  };
}

export interface ViewportSizeState {
  rw: number;
  rh: number;
  dpr: number;
  pixelDpr: number;
  aspect: number;
}

// F8 → PERF → RENDER SCALE: AUTO / fixed ratio, capped at `maxDpr` (display ≤ 2 or the LOW quality cap).
export function sizeColonyViewport(
  renderer: THREE.WebGLRenderer, composer: EffectComposer, bloom: UnrealBloomPass, pixelArt: ShaderPass,
  renderPass: RenderPass, camera: THREE.PerspectiveCamera,
  cssW: number, cssH: number, customRes: { width: number; height: number } | null, dpr: number,
  prev: ViewportSizeState,
) {
  const rw = customRes ? customRes.width : cssW;
  const rh = customRes ? customRes.height : cssH;
  const pixelDpr = customRes ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const aspect = cssW / Math.max(1, cssH);

  const sizeChanged = rw !== prev.rw || rh !== prev.rh;

  // Skip renderer.setSize / composer.setSize when buffer dimensions and DPR are unchanged: WebGL clears the canvas
  // whenever canvas.width/height are reassigned, so redundant ResizeObserver fires would blank a painted frame.
  if (sizeChanged || dpr !== prev.dpr) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(rw, rh, false);
    composer.setPixelRatio(dpr);
    composer.setSize(rw, rh);
    bloom.resolution.set(rw * dpr, rh * dpr);
    Object.assign(perfTelemetry, { dpr, canvasW: renderer.domElement.width, canvasH: renderer.domElement.height });
    prev.rw = rw;
    prev.rh = rh;
    prev.dpr = dpr;
  }
  // Keep pixel-art grid resolution tied to display DPR (not dynamic renderScale) so AUTO scale steps never change pixel size.
  if (sizeChanged || pixelDpr !== prev.pixelDpr) {
    setPixelArtSize(pixelArt, rw * pixelDpr, rh * pixelDpr);
    prev.pixelDpr = pixelDpr;
  }
  if (aspect !== prev.aspect) {
    for (const p of renderPass.camera ? [renderPass.camera as THREE.PerspectiveCamera] : []) {
      p.aspect = aspect;
      p.updateProjectionMatrix();
    }
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    prev.aspect = aspect;
  }
}

function paintColonyFrame(
  vp: ColonyViewport, renderPass: RenderPass, composer: EffectComposer,
  focusRing: ReturnType<typeof createViewFocusRing>,
  renderScale: ReturnType<typeof createRenderScaleController>,
  rainPass: ReturnType<typeof createRainAndStormPass>,
  reflections: ReturnType<typeof createViewportReflections>,
  focusGroundY: number, customRes: { width: number; height: number } | null,
) {
  // Resize before rendering so an AUTO DPR step never clears a just-painted frame to black.
  if (renderScale.frame(performance.now()) && !customRes) vp.resize();
  stepSunOrbit(vp);
  tickWindClock();
  tickWeatherClock();
  tickWaterClock();
  // Effects restrict themselves to the visible ground (+ margin); the shadow boxes fit to it.
  const focus = updateViewFocus(renderPass.camera, focusGroundY);
  fitShadowToView(vp, focus);
  focusRing.update(renderPass.scene, focus, focusGroundY, isFocusRingOn());
  rainPass.update(undefined, renderPass.scene as THREE.Scene, renderPass.camera, { sun: vp.sun, hemi: vp.hemi, renderer: vp.renderer });
  reflections.render();
  composer.render();
}

/** Pillar 4 bootstrap: 28° FOV, ACES, PMREM RoomEnvironment, warm sun + cool hemi, bloom threshold 1.1. */
export function createColonyViewport(container: HTMLElement): ColonyViewport {
  installShadowShaderPatch();
  const w = () => container.clientWidth || window.innerWidth;
  const h = () => container.clientHeight || window.innerHeight;
  const { scene, camera } = createDefaultView(w() / h());

  let customRes: { width: number; height: number } | null = null;
  let focusGroundY = 0;
  let maxDpr = Math.min(window.devicePixelRatio, 2);
  const sizeState: ViewportSizeState = { rw: -1, rh: -1, dpr: -1, pixelDpr: -1, aspect: -1 };

  const renderer = createColonyRenderer(container, w(), h(), maxDpr);
  const { pmrem, environment } = createEnvironment(renderer, scene);
  const { sun, secondaryShadowLight, hemi } = createSunAndHemi(scene);
  const { composer, renderPass, bloom, pixelArt, offPixel } = createComposer(renderer, scene, camera, w(), h());
  const rainPass = createRainAndStormPass(scene, camera);

  const vp: ColonyViewport = {
    renderer, composer, bloom, pixelArt, scene, camera, sun, secondaryShadowLight, hemi, environment,
    setView(s, c) {
      renderPass.scene = s;
      renderPass.camera = c;
      if (!s.environment) s.environment = environment;
      c.aspect = w() / h();
      c.updateProjectionMatrix();
    },
    applySky(spec) {
      applySkyToScene(scene, sun, hemi, renderer, spec);
      recordViewportPlanetBase(vp, spec);
      syncViewportShadow(vp, spec.sky.sunColor);
    },
    followShadow(t) {
      focusGroundY = Math.min(0, t.y);
      followShadowTarget(vp, t);
    },
    setResolution(size, maxPixelRatio) {
      customRes = size;
      if (maxPixelRatio !== undefined) maxDpr = maxPixelRatio;
      vp.resize();
    },
    resize() {
      const cw = w(), ch = h();
      const dpr = customRes ? 1 : renderScale.resolve(maxDpr);
      sizeColonyViewport(renderer, composer, bloom, pixelArt, renderPass, camera, cw, ch, customRes, dpr, sizeState);
    },
    render() { paintColonyFrame(vp, renderPass, composer, focusRing, renderScale, rainPass, reflections, focusGroundY, customRes); },
    dispose() {
      renderScale.dispose();
      focusRing.dispose();
      rainPass.dispose();
      reflections.dispose();
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      offShadow(); offPixel();
      sun.dispose(); secondaryShadowLight.dispose(); // their shadow-map render targets
      composer.dispose(); pmrem.dispose(); renderer.dispose();
      renderer.domElement.remove();
    },
  };
  const renderScale = createRenderScaleController(() => vp.resize());
  const focusRing = createViewFocusRing();
  const reflections = createViewportReflections(renderer, renderPass);
  const offShadow = registerShadowViewport(vp);
  const onResize = () => vp.resize();
  window.addEventListener('resize', onResize);
  const resizeObserver = new ResizeObserver(() => vp.resize());
  resizeObserver.observe(container);
  vp.resize(); // applies a fixed render scale from the first frame
  return vp;
}
