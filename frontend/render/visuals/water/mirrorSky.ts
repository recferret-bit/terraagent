import * as THREE from 'three';

/**
 * Sky key for the water mirror (`glsl/mirror.ts`, `waterMirrorObject`). The mirror pass draws the whole scene, so its
 * "sky" is the planet sky dome (`planetSkyDome`, `planets/applyPlanetLook.ts`): every dome texel away from the sun is
 * `mix(uHorizon, uTop, k)`, a point on one straight RGB segment, whatever the ray direction. Where no dome is drawn
 * the sky is the flat `scene.background`. The water shader treats texels near that segment (or the background) as sky
 * and gives them no cover, so only reflected OBJECTS lie over the water.
 *
 * The colours animate with day/night, so they are captured on every water draw (`captureMirrorSky`, called from the
 * water material's `onBeforeRender`). Shared by every water material.
 */
const uniforms = {
  /** Sky segment ends (linear): the dome's horizon and top colours (both = the background without a dome). */
  uReflSkyLo: { value: new THREE.Color() },
  uReflSkyHi: { value: new THREE.Color() },
  /** The flat background colour (or the horizon colour when the background is not a Color). */
  uReflBg: { value: new THREE.Color() },
  /** 1 = the colours above are valid; 0 = nothing to key on (every mirror texel counts as an object). */
  uReflSkyKey: { value: 0 },
};

export const SKY_DOME_NAME = 'planetSkyDome';

type DomeUniforms = { uTop?: THREE.IUniform<THREE.Color>; uHorizon?: THREE.IUniform<THREE.Color> };

export function getMirrorSkyUniforms(): typeof uniforms {
  return uniforms;
}

/** Writes the sky key from a dome's colours and/or a background (either may be missing). */
export function setMirrorSky(dome: DomeUniforms | null, background: unknown): void {
  const bg = (background as THREE.Color | null)?.isColor ? (background as THREE.Color) : null;
  const top = dome?.uTop?.value, hor = dome?.uHorizon?.value;
  if (top && hor) {
    uniforms.uReflSkyLo.value.copy(hor);
    uniforms.uReflSkyHi.value.copy(top);
    uniforms.uReflBg.value.copy(bg ?? hor);
    uniforms.uReflSkyKey.value = 1;
  } else if (bg) {
    uniforms.uReflSkyLo.value.copy(bg);
    uniforms.uReflSkyHi.value.copy(bg);
    uniforms.uReflBg.value.copy(bg);
    uniforms.uReflSkyKey.value = 1;
  } else uniforms.uReflSkyKey.value = 0;
}

/** The dome per scene; a miss is retried once per frame (not once per water bucket), a removed dome is looked up again. */
const domes = new WeakMap<THREE.Object3D, { mesh: THREE.Object3D | null; frame: number }>();

function domeOf(scene: THREE.Object3D, frame: number): DomeUniforms | null {
  let hit = domes.get(scene);
  if (!hit) domes.set(scene, (hit = { mesh: null, frame: Number.NaN }));
  if (hit.mesh ? !hit.mesh.parent : hit.frame !== frame) { // in place: a scene without a dome retries every frame
    hit.mesh = scene.getObjectByName(SKY_DOME_NAME) ?? null;
    hit.frame = frame;
  }
  const mat = (hit.mesh as THREE.Mesh | null)?.material as THREE.ShaderMaterial | undefined;
  return (mat?.uniforms as DomeUniforms | undefined) ?? null;
}

/** Captures the sky key of the scene being drawn (`frame` = `renderer.info.render.frame`). */
export function captureMirrorSky(scene: THREE.Scene, frame: number): void {
  setMirrorSky(domeOf(scene, frame), scene.background);
}
