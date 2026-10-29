// Landing page: renders the game's real PlanetGlobe (same shaders as the orbit menu) into each planet card.
// One shared WebGL renderer draws every globe, then blits into the card's 2D canvas, so the page uses a single extra GL context.
import * as THREE from 'three';
import { PLANET_SPECS, type PlanetKind } from '../planets/PlanetSpec';
import { createPlanetGlobe, type PlanetGlobe } from '../planets/PlanetGlobe';

const R = 10;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-planet]')];

function start() {
  if (!canvases.length) return;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const size = 360; // render square; blitted down to the card
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  camera.position.set(0, 1.0, 45);
  camera.lookAt(0, 0, 0);
  const sunDir = new THREE.Vector3(0.62, 0.3, 0.55).normalize();

  const items = canvases.map((cv) => {
    const spec = PLANET_SPECS[cv.dataset.planet as PlanetKind];
    const scene = new THREE.Scene();
    const globe: PlanetGlobe = createPlanetGlobe(spec, { radius: R, segments: 96 });
    globe.setSunDirection(sunDir);
    scene.add(globe.group);
    return { cv, ctx: cv.getContext('2d')!, scene, globe, visible: true };
  });

  const io = new IntersectionObserver((es) => es.forEach((e) => { const it = items.find((i) => i.cv === e.target); if (it) it.visible = e.isIntersecting; }));
  items.forEach((i) => io.observe(i.cv));

  const draw = (it: (typeof items)[number]) => {
    const { cv, ctx } = it;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    renderer.render(it.scene, camera);
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w, h) * 1.0; // globe square fits the card height
    ctx.drawImage(renderer.domElement, (w - s) / 2, (h - s) / 2, s, s);
  };

  let last = performance.now(), t = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    for (const it of items) {
      if (!it.visible) continue;
      it.globe.update(dt * 6, t); // faster spin than the in-game menu so the card reads as alive
      draw(it);
    }
    if (!reduced) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try { start(); } catch (e) { console.warn('planet cards: WebGL unavailable, keeping fallback art', e); }
