import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';

interface ProgramLike {
  isReady(): boolean;
}
interface RendererProps {
  properties: { get(m: object): { currentProgram?: ProgramLike } };
}

/**
 * Resolves once every program of `materials` reports `isReady()` (KHR_parallel_shader_compile), or when `isStale()`.
 * Replaces `renderer.compileAsync`, whose poll reads `currentProgram.isReady()` blindly: a material that was disposed or
 * swapped while compiling (the scene changes under `?skip=1`) has no program anymore, which threw an uncaught
 * `TypeError … reading 'isReady'` from three's timer and left the promise pending forever.
 */
export function waitForPrograms(
  r: RendererProps,
  materials: Set<object>,
  isStale: () => boolean,
  delayMs = 10,
): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      for (const m of [...materials]) {
        const program = r.properties.get(m).currentProgram;
        if (!program || program.isReady()) materials.delete(m); // gone or done: nothing left to wait for
      }
      if (materials.size === 0 || isStale()) resolve();
      else setTimeout(poll, delayMs);
    };
    poll();
  });
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((res) => requestAnimationFrame(() => res()));
  }
  return Promise.resolve();
}

function collectRenderables(roots: readonly THREE.Object3D[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
        out.push(o);
      }
    });
  }
  return out;
}

function isolateBatchInScene(scene: THREE.Scene, batch: readonly THREE.Object3D[]): () => void {
  const allSceneRenderables = collectRenderables([scene]);
  const savedVis = new Map<THREE.Object3D, boolean>();
  const savedCull = new Map<THREE.Object3D, boolean>();
  for (const o of allSceneRenderables) {
    savedVis.set(o, o.visible);
    o.visible = false;
  }
  for (const o of batch) {
    let cur: THREE.Object3D | null = o;
    while (cur && cur !== scene) {
      if (!savedVis.has(cur)) savedVis.set(cur, cur.visible);
      cur.visible = true;
      cur = cur.parent;
    }
    savedCull.set(o, o.frustumCulled);
    o.frustumCulled = false;
  }
  return () => {
    for (const [o, c] of savedCull) o.frustumCulled = c;
    for (const [o, v] of savedVis) o.visible = v;
  };
}

function vertexCountOf(obj: THREE.Object3D): number {
  const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  return geo?.attributes?.position?.count ?? 0;
}

function createComposerMatchedTarget(vp: ColonyViewport): THREE.WebGLRenderTarget {
  const compRt = (vp.composer as unknown as { renderTarget1?: THREE.WebGLRenderTarget } | undefined)?.renderTarget1;
  const tex = compRt?.texture;
  const rt = new THREE.WebGLRenderTarget(16, 16, {
    type: tex?.type ?? THREE.UnsignedByteType,
    format: tex?.format ?? THREE.RGBAFormat,
  });
  if (tex?.colorSpace) rt.texture.colorSpace = tex.colorSpace;
  return rt;
}

async function compileMaterialsSliced(
  vp: ColonyViewport,
  roots: readonly THREE.Object3D[],
  rt: THREE.WebGLRenderTarget,
  reflRt: THREE.WebGLRenderTarget | null,
  isStale: () => boolean,
  sliceSize = 8,
): Promise<Set<object>> {
  const r = vp.renderer;
  const scene = vp.scene;
  const camera = vp.camera;
  const seenMats = new Set<THREE.Material>();
  const uniqueReps: THREE.Object3D[] = [];
  for (const obj of collectRenderables(roots)) {
    const raw = (obj as THREE.Mesh).material;
    const mats = Array.isArray(raw) ? raw : raw ? [raw] : [];
    let hasNew = false;
    for (const m of mats) {
      if (!seenMats.has(m)) {
        seenMats.add(m);
        hasNew = true;
      }
    }
    if (hasNew) uniqueReps.push(obj);
  }
  const dome = scene.getObjectByName('planetSkyDome');
  if (dome && !uniqueReps.includes(dome)) uniqueReps.push(dome);

  const compiledAll = new Set<object>();
  for (let offset = 0; offset < uniqueReps.length; offset += sliceSize) {
    if (isStale()) return compiledAll;
    const slice = uniqueReps.slice(offset, offset + sliceSize);
    const prev = r.getRenderTarget();
    const restore = isolateBatchInScene(scene, slice);
    try {
      r.setRenderTarget(rt);
      const c1 = r.compile(scene, camera) as unknown;
      if (c1 instanceof Set) c1.forEach((m) => compiledAll.add(m));
      if (reflRt) {
        r.setRenderTarget(reflRt);
        const c2 = r.compile(scene, camera) as unknown;
        if (c2 instanceof Set) c2.forEach((m) => compiledAll.add(m));
      }
    } catch (e) {
      console.warn('compile', e);
    } finally {
      r.setRenderTarget(prev);
      restore();
    }
    if (offset + sliceSize < uniqueReps.length) await nextFrame();
  }
  return compiledAll;
}

/**
 * Uploads VBOs, instanced attributes, and textures for `roots` in small frame-sliced batches into a tiny `16×16`
 * offscreen target while keeping `shadowMap.autoUpdate = false` on high-poly meshes (warming shadow depth programs and
 * FBOs once on small `< 12k`-vert shadow casters so 400k-tri globes/terrains never trigger a 500ms shadow-map draw).
 */
async function uploadRenderablesSliced(
  vp: ColonyViewport,
  roots: readonly THREE.Object3D[],
  rt: THREE.WebGLRenderTarget,
  isStale: () => boolean,
  batchSize = 6,
): Promise<void> {
  const r = vp.renderer;
  const scene = vp.scene;
  const camera = vp.camera;
  const renderables = collectRenderables(roots);
  if (renderables.length === 0) return;

  let warmedStandardShadow = false;
  const warmedCustomDepth = new Set<string>();

  for (let offset = 0; offset < renderables.length; offset += batchSize) {
    if (isStale()) return;
    const batch = renderables.slice(offset, offset + batchSize);
    let allowShadowPass = false;
    for (const o of batch) {
      if (!o.castShadow || vertexCountOf(o) > 12000) continue;
      const cdm = o.customDepthMaterial;
      if (cdm) {
        const key = typeof cdm.customProgramCacheKey === 'function' ? cdm.customProgramCacheKey() : cdm.uuid;
        if (!warmedCustomDepth.has(key)) {
          warmedCustomDepth.add(key);
          allowShadowPass = true;
        }
      } else if (!warmedStandardShadow) {
        warmedStandardShadow = true;
        allowShadowPass = true;
      }
    }
    const drawBatch = allowShadowPass ? batch.filter((o) => !o.castShadow || vertexCountOf(o) <= 12000) : batch;
    const restore = isolateBatchInScene(scene, drawBatch.length > 0 ? drawBatch : batch);
    const prevTarget = r.getRenderTarget();
    const sm = r.shadowMap;
    const prevAuto = sm?.autoUpdate ?? true;
    const prevNeeds = sm?.needsUpdate ?? false;
    if (sm) {
      sm.autoUpdate = allowShadowPass && drawBatch.length > 0;
      sm.needsUpdate = allowShadowPass && drawBatch.length > 0;
    }
    try {
      r.setRenderTarget(rt);
      r.render(scene, camera);
    } catch {
      /* headless / mock renderer fallback */
    } finally {
      if (sm) {
        sm.autoUpdate = prevAuto;
        sm.needsUpdate = prevNeeds;
      }
      r.setRenderTarget(prevTarget);
      restore();
    }
    if (offset + batchSize < renderables.length) {
      await nextFrame();
    }
  }
}

/**
 * Compiles all shader programs under `roots` in frame-sliced batches (`KHR_parallel_shader_compile`) against both
 * `vp.composer`'s render target format and `WaterReflectionPass`'s HalfFloat target, then uploads VBOs/textures in micro-slices.
 */
export async function warmupSubtrees(
  vp: ColonyViewport,
  roots: readonly THREE.Object3D[],
  isStale: () => boolean,
  batchSize = 6,
): Promise<void> {
  const r = vp.renderer as THREE.WebGLRenderer & Partial<RendererProps>;
  if (typeof r.compile !== 'function' || typeof r.setRenderTarget !== 'function') return;
  const rt = createComposerMatchedTarget(vp);
  const reflRt = rt.texture.type !== THREE.HalfFloatType
    ? new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType })
    : null;
  try {
    const materials = await compileMaterialsSliced(vp, roots, rt, reflRt, isStale, 8);
    if (r.properties && materials.size > 0 && !isStale()) {
      await waitForPrograms(r as unknown as RendererProps, materials, isStale);
    }
    await nextFrame();
    if (!isStale()) {
      await uploadRenderablesSliced(vp, roots, rt, isStale, batchSize);
    }
  } finally {
    rt.dispose();
    reflRt?.dispose();
  }
}

/**
 * Compile every program the descent will ever use against an off-screen target matching `EffectComposer` + `WaterReflectionPass`,
 * then upload geometries and textures in frame-sliced batches so neither orbit nor mid-descent suffers a freeze.
 */
export async function warmupScene(vp: ColonyViewport, isStale: () => boolean): Promise<void> {
  await warmupSubtrees(vp, [vp.scene], isStale, 6);
}
