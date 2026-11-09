import * as THREE from 'three';
import { perfTelemetry } from '../../../core/perfConfig';
import { getReflectionResScale, getReflectionStrength } from '../waterConfig';
import { cropProjection, updateMirrorCamera, type PixelRect } from './mirrorCamera';
import { addBoxToUvBounds, emptyUvBounds, pixelRectToUv, resetUvBounds, uvBoundsToPixelRect } from './reflectionRect';
import { hideOverlayMaterials, showMaterials } from './reflectionOverlays';
import { reflectionExclusions, reflectiveWaters } from './reflectionRegistry';
import { createReflectionTarget, selectReflectionTarget, type ReflectionTarget } from './reflectionTargets';
import { getReflectionUniforms } from './reflectionUniforms';

/**
 * Planar water reflections, CPU side: once per frame, before the main composer render, the scene is drawn from the
 * camera mirrored about the water plane into one small HalfFloat render target, which the water shader samples
 * (`reflectionUniforms.ts`). The pass is skipped outright (`uReflOn = 0`, nothing drawn) when the strength is 0, no
 * registered water (`reflectionRegistry.ts`) is shown in the scene, none of its parts is in the camera frustum, or the
 * camera is below the water. Otherwise only the screen rect of the visible water (+ room for the distortion) is drawn:
 * the target's viewport + scissor are that rect and the mirror projection is cropped to it, so three also frustum-culls
 * everything outside it. Shadow maps are not re-rendered (the frame-old ones are reused) and the water itself, its
 * fauna, `excludeFromReflection` objects and every overlay material (`reflectionOverlays.ts`) are hidden meanwhile.
 * The texture is linear HDR (render targets skip tone mapping and the output colour space).
 */
export type ReflectionRenderer = Pick<
  THREE.WebGLRenderer, 'getDrawingBufferSize' | 'getRenderTarget' | 'setRenderTarget' | 'render' | 'autoClear' | 'shadowMap'
>;

export interface WaterReflectionPassOptions {
  /** Reflection strength this frame (default `getReflectionStrength`, F8 → WATER). */
  strength?: () => number;
  /** Target size × the drawing buffer (default `getReflectionResScale`). */
  resScale?: () => number;
  /** Clock for the CPU time telemetry (default `performance.now`). */
  now?: () => number;
}

export interface WaterReflectionPass {
  /** Draws this frame's mirror image of `scene` seen by `camera` (or skips it); true when it drew. */
  render(renderer: ReflectionRenderer, scene: THREE.Scene, camera: THREE.Camera): boolean;
  /** The render target while it exists (null before the first draw and while the strength is 0). */
  readonly target: THREE.WebGLRenderTarget | null;
  dispose(): void;
}

const MS_EMA = 0.1;

function createTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    depthBuffer: true, stencilBuffer: false, samples: 0,
  });
  rt.texture.name = 'waterReflection';
  return rt;
}

/** Writes the pass's `perfTelemetry` fields in place (called every frame: no object literal). */
function setTelemetry(on: boolean, ms: number, w: number, h: number, rect: number): void {
  perfTelemetry.reflectOn = on;
  perfTelemetry.reflectMs = ms;
  perfTelemetry.reflectW = w;
  perfTelemetry.reflectH = h;
  perfTelemetry.reflectRect = rect;
}

/** What the mirror render hid (shown again right after it). */
interface MirrorHidden { readonly objects: THREE.Object3D[]; readonly materials: THREE.Material[] }

/**
 * Hides the shown water objects and the explicit exclusions, then every overlay material still shown in `scene`
 * (`reflectionOverlays.ts`: transparent + no depth write; the hidden subtrees above are not walked).
 */
function hideForMirror(t: ReflectionTarget, scene: THREE.Scene, h: MirrorHidden): void {
  for (const o of t.hide) if (o.visible) { o.visible = false; h.objects.push(o); }
  for (const o of reflectionExclusions()) if (o.visible) { o.visible = false; h.objects.push(o); }
  hideOverlayMaterials(scene, h.materials);
}

function showAfterMirror(h: MirrorHidden): void {
  for (const o of h.objects) o.visible = true;
  h.objects.length = 0;
  showMaterials(h.materials);
}

/**
 * Renders `scene` through `mirror` into `rt` with frame-old shadow maps and `t`'s water, the exclusions and the
 * overlays hidden; restores every renderer state and visibility it changes, also when the render throws. The
 * renderer's own viewport / scissor are never touched: `setRenderTarget(rt)` applies the rect stored on `rt`, and
 * `setRenderTarget(prev)` re-applies the previous target's (or the canvas') own.
 */
function drawMirror(
  renderer: ReflectionRenderer, scene: THREE.Scene, mirror: THREE.Camera, rt: THREE.WebGLRenderTarget,
  t: ReflectionTarget, hidden: MirrorHidden,
): void {
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const sm = renderer.shadowMap;
  const prevAuto = sm.autoUpdate, prevNeeds = sm.needsUpdate;
  sm.autoUpdate = false;
  sm.needsUpdate = false; // a pending one-shot update belongs to the main render
  renderer.autoClear = true; // clears colour + depth, within the scissor rect only
  try {
    hideForMirror(t, scene, hidden);
    renderer.setRenderTarget(rt);
    renderer.render(scene, mirror);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    sm.autoUpdate = prevAuto;
    sm.needsUpdate = prevNeeds;
    showAfterMirror(hidden);
  }
}

export function createWaterReflectionPass(opts: WaterReflectionPassOptions = {}): WaterReflectionPass {
  const strengthOf = opts.strength ?? getReflectionStrength;
  const scaleOf = opts.resScale ?? getReflectionResScale;
  const now = opts.now ?? (() => performance.now());
  const u = getReflectionUniforms();
  const mirror = new THREE.PerspectiveCamera();
  mirror.name = 'waterReflectionMirror';
  const texMatrix = new THREE.Matrix4();
  const sel = createReflectionTarget();
  const bounds = emptyUvBounds();
  const rect: PixelRect = { x: 0, y: 0, w: 0, h: 0 };
  const hidden: MirrorHidden = { objects: [], materials: [] };
  const buf = new THREE.Vector2();
  let rt: THREE.WebGLRenderTarget | null = null;
  let emaMs = 0;

  const skip = (): false => {
    u.uReflOn.value = 0;
    setTelemetry(false, 0, 0, 0, 0);
    return false;
  };
  const release = () => {
    rt?.dispose();
    rt = null;
    u.uReflTex.value = null;
  };
  /** The target at drawing-buffer size × the res scale (created / resized lazily). */
  const ensureTarget = (renderer: ReflectionRenderer): THREE.WebGLRenderTarget => {
    renderer.getDrawingBufferSize(buf);
    const s = scaleOf();
    const w = Math.max(1, Math.round(buf.x * s)), h = Math.max(1, Math.round(buf.y * s));
    if (!rt) { rt = createTarget(w, h); u.uReflTex.value = rt.texture; }
    else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    return rt;
  };
  /** The scissor rect of the selected water parts in the target, or null when it misses the target. */
  const waterRect = (w: number, h: number): PixelRect | null => {
    resetUvBounds(bounds);
    for (let i = 0; i < sel.boxCount; i++) addBoxToUvBounds(bounds, sel.boxes[i]!, texMatrix);
    return uvBoundsToPixelRect(bounds, w, h, rect);
  };
  const publish = (target: THREE.WebGLRenderTarget, r: PixelRect, strength: number, ms: number) => {
    u.uReflMatrix.value.copy(texMatrix);
    pixelRectToUv(r, target.width, target.height, u.uReflRect.value);
    u.uReflOn.value = strength;
    emaMs = perfTelemetry.reflectOn ? emaMs + (ms - emaMs) * MS_EMA : ms;
    setTelemetry(true, emaMs, target.width, target.height, (r.w * r.h) / (target.width * target.height));
  };

  return {
    get target() { return rt; },
    render(renderer, scene, camera) {
      const strength = strengthOf();
      if (!(strength > 0)) { release(); return skip(); }
      if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return skip();
      camera.updateMatrixWorld(); // controls may have moved it since the last render
      if (!selectReflectionTarget(reflectiveWaters(), scene, camera, sel)) return skip();
      if (!updateMirrorCamera(camera as THREE.PerspectiveCamera, mirror, sel.level, texMatrix)) return skip();
      const target = ensureTarget(renderer);
      const r = waterRect(target.width, target.height);
      if (!r) return skip();
      cropProjection(mirror, r, target.width, target.height);
      target.viewport.set(r.x, r.y, r.w, r.h);
      target.scissor.set(r.x, r.y, r.w, r.h);
      target.scissorTest = true; // read by setRenderTarget: the clear stays inside the rect too
      const t0 = now();
      drawMirror(renderer, scene, mirror, target, sel, hidden);
      publish(target, r, strength, now() - t0);
      return true;
    },
    dispose() {
      release();
      skip();
    },
  };
}
