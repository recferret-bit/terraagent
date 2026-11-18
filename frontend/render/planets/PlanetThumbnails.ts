import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLANET_SPECS, type PlanetKind } from './PlanetSpec';
import { createPlanetGlobe, type PlanetGlobe } from './PlanetGlobe';
import { StageHost } from '../core/StageHost';
import { createPixelArtPass, onPixelArtChange } from '../core/pixelArtPass';

const DEFAULT_RADIUS = 10;
const DEFAULT_SIZE = 280;
const DEFAULT_SPIN_MULT = 6;

export interface PlanetThumbnailsOptions {
  readonly size?: number;
  readonly spinMultiplier?: number;
  readonly syncWithOrbitMenu?: boolean;
}

export interface PlanetThumbnailsHandle {
  setPaused(paused: boolean): void;
  renderOnce(): void;
  dispose(): void;
}

interface ThumbItem {
  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly scene: THREE.Scene;
  readonly globe: PlanetGlobe;
}

function createOffscreenRenderer(size: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  return renderer;
}

function createThumbItems(canvases: readonly HTMLCanvasElement[]): ThumbItem[] {
  const sunDir = new THREE.Vector3(0.62, 0.3, 0.55).normalize();
  const items: ThumbItem[] = [];
  for (const cv of canvases) {
    const kind = cv.dataset.planet as PlanetKind | undefined;
    const spec = kind ? PLANET_SPECS[kind] : undefined;
    const ctx = cv.getContext('2d');
    if (!spec || !ctx) continue;
    cv.dataset.pixelShader = '1'; // rendered with the WebGL pixelArtPass below, never the CSS SVG filter
    const scene = new THREE.Scene();
    const globe = createPlanetGlobe(spec, { radius: DEFAULT_RADIUS, segments: 96 });
    globe.setSunDirection(sunDir);
    scene.add(globe.group);
    items.push({ cv, ctx, scene, globe });
  }
  return items;
}

function drawThumbItem(
  it: ThumbItem,
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  renderPass: RenderPass,
): void {
  const { cv, ctx } = it;
  const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
  const w = Math.round(cv.clientWidth * dpr);
  const h = Math.round(cv.clientHeight * dpr);
  if (w <= 0 || h <= 0) return;
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  renderPass.scene = it.scene;
  composer.render();
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w, h);
  ctx.drawImage(renderer.domElement, (w - s) / 2, (h - s) / 2, s, s);
}

/**
 * Renders the game's real animated `PlanetGlobe` shader into a set of `<canvas data-planet="...">` thumbnails
 * using one shared offscreen WebGL context + pixel-art pass, blitted into each card's 2D canvas.
 * Returns `null` when WebGL or 2D canvas is unavailable so CSS fallbacks stay intact.
 */
export function mountPlanetThumbnails(
  canvases: readonly HTMLCanvasElement[],
  opts: PlanetThumbnailsOptions = {},
): PlanetThumbnailsHandle | null {
  if (!canvases.length) return null;
  if (typeof WebGLRenderingContext === 'undefined' && typeof WebGL2RenderingContext === 'undefined') {
    return null;
  }
  const size = opts.size ?? DEFAULT_SIZE;
  const spinMult = opts.spinMultiplier ?? DEFAULT_SPIN_MULT;

  let renderer: THREE.WebGLRenderer;
  let items: ThumbItem[];
  try {
    items = createThumbItems(canvases);
    if (!items.length) return null;
    renderer = createOffscreenRenderer(size);
  } catch (err) {
    console.warn('planet thumbnails: WebGL unavailable, keeping fallback art', err);
    return null;
  }

  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  camera.position.set(0, 1.0, 45);
  camera.lookAt(0, 0, 0);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(items[0]!.scene, camera);
  composer.addPass(renderPass);
  composer.addPass(new OutputPass());
  const pixelArt = createPixelArtPass(size, size, { preserveAlpha: true });
  composer.addPass(pixelArt);

  let paused = false;
  let disposed = false;

  let thumbAccumDt = 0;
  let thumbDrawnOnce = false;
  const drawAll = (dt: number, t: number) => {
    if (paused || disposed) return;
    thumbAccumDt += dt;
    if (opts.syncWithOrbitMenu && thumbDrawnOnce && thumbAccumDt < 0.12) return;
    const stepDt = thumbDrawnOnce ? thumbAccumDt : dt;
    thumbAccumDt = 0;
    let drawnAny = false;
    for (const it of items) {
      if (!host.isVisible(it.cv)) continue;
      if (opts.syncWithOrbitMenu) {
        it.globe.shared.uTime.value = t;
        it.globe.spin.rotation.y = Math.sin(t * 0.24) * 0.16;
        it.globe.clouds.rotation.y += stepDt * 0.036;
      } else {
        it.globe.update(stepDt * spinMult, t);
      }
      drawThumbItem(it, renderer, composer, renderPass);
      drawnAny = true;
    }
    if (drawnAny) thumbDrawnOnce = true;
  };

  const offPixel = onPixelArtChange((enabled) => {
    if (disposed) return;
    pixelArt.enabled = enabled;
    for (const it of items) drawThumbItem(it, renderer, composer, renderPass);
  });

  const host = new StageHost({
    elements: items.map((it) => it.cv),
    onFrame: drawAll,
  });
  host.start();
  if (host.reduced) requestAnimationFrame(() => host.renderOnce(0.016, 0.016));

  return {
    setPaused(nextPaused: boolean) {
      paused = nextPaused;
      if (!paused && !disposed) {
        for (const it of items) drawThumbItem(it, renderer, composer, renderPass);
      }
    },
    renderOnce() {
      if (!disposed) host.renderOnce(0.016, host.time + 0.016);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offPixel();
      host.dispose();
      for (const it of items) it.globe.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
