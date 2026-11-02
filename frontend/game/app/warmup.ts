import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';

/** Temporarily make every object visible and un-culled so all of its shaders get compiled; returns the undo. */
function revealAll(scene: THREE.Scene) {
  const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  return () => { hidden.forEach((o) => (o.visible = false)); culled.forEach((o) => (o.frustumCulled = true)); };
}

interface ProgramLike { isReady(): boolean }
interface RendererProps { properties: { get(m: object): { currentProgram?: ProgramLike } } }

/**
 * Resolves once every program of `materials` reports `isReady()` (KHR_parallel_shader_compile), or when `isStale()`.
 * Replaces `renderer.compileAsync`, whose poll reads `currentProgram.isReady()` blindly: a material that was disposed or
 * swapped while compiling (the scene changes under `?skip=1`) has no program anymore, which threw an uncaught
 * `TypeError … reading 'isReady'` from three's timer and left the promise pending forever.
 */
export function waitForPrograms(r: RendererProps, materials: Set<object>, isStale: () => boolean, delayMs = 10): Promise<void> {
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

/**
 * Compile every program the descent will ever use (objects that only appear mid-dive are force-shown) against an
 * off-screen target — the same tone-mapping/colour-space variant the composer uses — then draw once so geometry and
 * textures are uploaded. Removes every mid-descent shader-compile hitch, not just the first-frame one.
 * `isStale` lets the caller abandon the upload pass when the session was discarded meanwhile.
 */
export async function warmupScene(vp: ColonyViewport, isStale: () => boolean) {
  const r = vp.renderer, scene = vp.scene, camera = vp.camera;
  const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
  const prev = r.getRenderTarget();
  let restore = revealAll(scene);
  let materials = new Set<object>();
  try { r.setRenderTarget(rt); materials = r.compile(scene, camera) as unknown as Set<object>; } catch (e) { console.warn('compile', e); } finally { r.setRenderTarget(prev); restore(); }
  await waitForPrograms(r as unknown as RendererProps, materials, isStale);
  await new Promise((res) => requestAnimationFrame(res));
  if (isStale()) { rt.dispose(); return; }
  restore = revealAll(scene);
  try { r.setRenderTarget(rt); r.render(scene, camera); } finally { r.setRenderTarget(prev); restore(); rt.dispose(); }
}
