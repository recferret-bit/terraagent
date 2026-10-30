import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { PlanetSpec } from '../planets/PlanetSpec';
import { createPixelArtPass, onPixelArtChange, setPixelArtSize } from './pixelArtPass';

export interface ColonyViewport {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  pixelArt: ShaderPass;
  /** Default diorama scene/camera (28° telephoto). Systems may swap via setView(). */
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
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
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 160;
  const d = 35;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  return { sun, hemi };
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

/** Pillar 4 bootstrap: 28° FOV, ACES, PMREM RoomEnvironment, warm sun + cool hemi, bloom threshold 1.1. */
export function createColonyViewport(container: HTMLElement): ColonyViewport {
  const w = () => container.clientWidth || window.innerWidth;
  const h = () => container.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9dcef);
  scene.fog = new THREE.FogExp2(0xb9dcef, 0.007);

  const camera = new THREE.PerspectiveCamera(28, w() / h(), 1, 600);
  camera.position.set(42, 46, 42);
  camera.lookAt(0, 0, 0);

  let customRes: { width: number; height: number } | null = null;
  let maxDpr = Math.min(window.devicePixelRatio, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setSize(w(), h(), false);
  renderer.setPixelRatio(maxDpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.dataset.pixelShader = '1';
  container.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.75;

  const { sun, hemi } = createSunAndHemi(scene);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(w(), h()), 0.45, 0.35, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const pixelArt = createPixelArtPass(w(), h());
  composer.addPass(pixelArt);
  const offPixel = onPixelArtChange((enabled) => { pixelArt.enabled = enabled; composer.render(); });

  const sunOffset = new THREE.Vector3(35, 55, 25);

  const vp: ColonyViewport = {
    renderer, composer, bloom, pixelArt, scene, camera, sun, hemi, environment,
    setView(s, c) {
      renderPass.scene = s;
      renderPass.camera = c;
      if (!s.environment) s.environment = environment;
      c.aspect = w() / h();
      c.updateProjectionMatrix();
    },
    applySky(spec) { applySkyToScene(scene, sun, hemi, renderer, spec); },
    followShadow(t) {
      const x = Math.round(t.x), z = Math.round(t.z);
      sun.target.position.set(x, t.y, z);
      sun.position.set(x + sunOffset.x, t.y + sunOffset.y, z + sunOffset.z);
    },
    setResolution(size, maxPixelRatio) {
      customRes = size;
      if (maxPixelRatio !== undefined) maxDpr = maxPixelRatio;
      vp.resize();
    },
    resize() {
      const cw = w(), ch = h();
      const rw = customRes ? customRes.width : cw;
      const rh = customRes ? customRes.height : ch;
      const dpr = customRes ? 1 : maxDpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(rw, rh, false);
      composer.setPixelRatio(dpr);
      composer.setSize(rw, rh);
      bloom.resolution.set(rw * dpr, rh * dpr);
      setPixelArtSize(pixelArt, rw * dpr, rh * dpr);
      for (const p of renderPass.camera ? [renderPass.camera as THREE.PerspectiveCamera] : []) {
        p.aspect = cw / ch;
        p.updateProjectionMatrix();
      }
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    },
    render() { composer.render(); },
    dispose() {
      window.removeEventListener('resize', onResize);
      offPixel();
      composer.dispose(); pmrem.dispose(); renderer.dispose();
      renderer.domElement.remove();
    },
  };
  const onResize = () => vp.resize();
  window.addEventListener('resize', onResize);
  return vp;
}
