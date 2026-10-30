// Renders the game's real PlanetGlobe (same shaders as the orbit menu) into each planet card.
// One shared WebGL renderer draws every globe, then blits into the card's 2D canvas, so the page uses a single extra GL context.
import * as THREE from 'three';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createPlanetGlobe } from '@terra/render/planets/PlanetGlobe';
import { StageHost } from '@terra/render/core/StageHost';

const R = 10, SIZE = 360; // render square; blitted down to the card

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
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
    const scene = new THREE.Scene();
    const globe = createPlanetGlobe(PLANET_SPECS[cv.dataset.planet as PlanetKind], { radius: R, segments: 96 });
    globe.setSunDirection(sunDir);
    scene.add(globe.group);
    return { cv, ctx: cv.getContext('2d')!, scene, globe };
  });

  const draw = (it: (typeof items)[number]) => {
    const { cv, ctx } = it, dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    renderer.render(it.scene, camera);
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w, h); // globe square fits the card height
    ctx.drawImage(renderer.domElement, (w - s) / 2, (h - s) / 2, s, s);
  };

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
