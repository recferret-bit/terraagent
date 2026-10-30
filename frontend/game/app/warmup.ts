import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';

/** Temporarily make every object visible and un-culled so all of its shaders get compiled; returns the undo. */
function revealAll(scene: THREE.Scene) {
  const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  return () => { hidden.forEach((o) => (o.visible = false)); culled.forEach((o) => (o.frustumCulled = true)); };
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
  let pending: Promise<unknown>;
  try { r.setRenderTarget(rt); pending = r.compileAsync(scene, camera); } finally { r.setRenderTarget(prev); restore(); }
  try { await pending; } catch (e) { console.warn('compileAsync', e); }
  await new Promise((res) => requestAnimationFrame(res));
  if (isStale()) { rt.dispose(); return; }
  restore = revealAll(scene);
  try { r.setRenderTarget(rt); r.render(scene, camera); } finally { r.setRenderTarget(prev); restore(); rt.dispose(); }
}
