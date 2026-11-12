// Renders the game's real PlanetGlobe (same shaders as the orbit menu) into each planet card.
// One shared WebGL renderer + pixel-art composer draws every globe, then blits into the card's 2D canvas, so the page uses a single extra GL context.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createPlanetGlobe } from '@terra/render/planets/PlanetGlobe';
import { StageHost } from '@terra/render/core/StageHost';
import { createPixelArtPass, onPixelArtChange } from '@terra/render/core/pixelArtPass';

// Card height is 140 CSS px; rendering a 280px square with pixelSize = 3.5 produces 80 virtual pixels -> 1.75 CSS px
// per cell, matching the Hero / Section 02 / Game pixel density.
const R = 10, SIZE = 280;

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  return renderer;
}

function start(canvases: HTMLCanvasElement[]) {
  const renderer = createRenderer();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  camera.position.set(0, 1.0, 45);
  camera.lookAt(0, 0, 0);
  const sunDir = new THREE.Vector3(0.62, 0.3, 0.55).normalize();

  const items = canvases.map((cv) => {
    cv.dataset.pixelShader = '1'; // rendered with the WebGL pixelArtPass below, never the CSS SVG filter
    const scene = new THREE.Scene();
    const globe = createPlanetGlobe(PLANET_SPECS[cv.dataset.planet as PlanetKind], { radius: R, segments: 96 });
    globe.setSunDirection(sunDir);
    scene.add(globe.group);
    return { cv, ctx: cv.getContext('2d')!, scene, globe };
  });

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(items[0].scene, camera);
  composer.addPass(renderPass);
  composer.addPass(new OutputPass());
  const pixelArt = createPixelArtPass(SIZE, SIZE, { preserveAlpha: true });
  composer.addPass(pixelArt);

  const draw = (it: (typeof items)[number]) => {
    const { cv, ctx } = it, dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    renderPass.scene = it.scene;
    composer.render();
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w, h); // globe square fits the card height
    ctx.drawImage(renderer.domElement, (w - s) / 2, (h - s) / 2, s, s);
  };

  onPixelArtChange((enabled) => {
    pixelArt.enabled = enabled;
    for (const it of items) draw(it);
  });

  const host: StageHost = new StageHost({
    elements: canvases,
    onFrame: (dt, t) => {
      for (const it of items) {
        if (!host.isVisible(it.cv)) continue;
        it.globe.update(dt * 6, t); // faster spin than the in-game menu so the card reads as alive
        draw(it);
      }
    },
  });
  host.start();
  if (host.reduced) requestAnimationFrame(() => host.renderOnce(0.016, 0.016));
}

export function initPlanetCards() {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-planet]')];
  if (!canvases.length) return;
  try { start(canvases); } catch (e) { console.warn('planet cards: WebGL unavailable, keeping fallback art', e); }
}
