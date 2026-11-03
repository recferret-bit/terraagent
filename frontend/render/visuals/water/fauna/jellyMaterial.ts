import * as THREE from 'three';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../../../lighting/ColonyVisionAndLights';
import { glslFloat } from '../../shaderInject';
import { getWaterUniforms } from '../waterConfig';
import { FAUNA_WATER_VERT_GLSL, faunaWaterUniforms } from './faunaWater';
import { JELLY_BOB, JELLY_PULSE_S } from './jellyPlacement';

/**
 * Zero-CPU jellyfish motion + look (MeshStandardMaterial + onBeforeCompile, translucent, two-sided). Per instance:
 * `aDrift` (centre xz, loop radius, signed angular speed), `aJelly` (phase, depth, scale, hue); per vertex: `aJel`
 * (part, v, rim weight). The bell contracts and relaxes (rim most), each contraction lifts the jelly a little, the
 * tentacles sway with a lag and trail behind the drift. Faint by day, bioluminescent at night (HDR > 1.1 → bloom,
 * pulsing with the bell). `jellyPlacement.ts` `jellyPathPoint` mirrors the path.
 */

const JELLY_VERT_COMMON = /* glsl */ `#include <common>
${FAUNA_WATER_VERT_GLSL}
uniform float uTime, uFaunaSink;
attribute vec4 aDrift;
attribute vec4 aJelly;
attribute vec3 aJel;
varying vec3 vJelW;
varying vec3 vJelN;
varying vec3 vJel;
varying float vJelDepth;
varying float vJelPulse;
varying float vJelHue;`;

/** In place of beginnormal_vertex: pulse + sway in object space, then translate to the drift point. */
const JELLY_VERT_MOTION = /* glsl */ `
float jPhase = aJelly.x, jScale = aJelly.z;
float jTh = jPhase * 6.2831853 + aDrift.w * uTime;
vec2 jC = aDrift.xy + aDrift.z * vec2(cos(jTh), sin(jTh));
vec2 jVel = aDrift.z * aDrift.w * vec2(-sin(jTh), cos(jTh));
float jPulseA = (jPhase * 2.0 + uTime / (${glslFloat(JELLY_PULSE_S)} * jScale)) * 6.2831853;
float jContract = 0.5 + 0.5 * sin(jPulseA);
vec3 jP = position;
vec3 objectNormal = normal;
if (aJel.x < 0.5) {
  float squeeze = 1.0 - 0.16 * jContract * aJel.z;   // the rim closes most
  jP.xz *= squeeze;
  jP.y *= 1.0 + 0.09 * jContract;
} else {
  float v = (aJel.y - 0.25) / 0.75;                    // 0 at the rim .. 1 at the tip
  float lag = jPulseA - 1.8 - v * 2.2;
  jP.xz *= 1.0 - 0.12 * (0.5 + 0.5 * sin(lag));
  jP.x += sin(uTime * 1.1 + v * 2.6 + jPhase * 7.0) * 0.045 * v * v;
  jP.z += cos(uTime * 0.9 + v * 2.2 + jPhase * 5.0) * 0.045 * v * v;
  jP.xz -= jVel * (v * 0.9) / jScale;                // tentacles trail behind the drift
}
vec3 jellyPos = vec3(jC.x, -aJelly.y - uFaunaSink + ${glslFloat(JELLY_BOB)} * jScale * sin(jPulseA - 1.2), jC.y) + jP * jScale;
jellyPos.xz += faunaRefractShift(jC, -jellyPos.y); // the image wobbles with the waves above
vJelPulse = jContract;
vJelHue = aJelly.w;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`;

const JELLY_VERT_BEGIN = /* glsl */ `vec3 transformed = jellyPos;
vJelW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vJelN = normalize(mat3(modelMatrix) * objectNormal);
vJel = aJel;
vJelDepth = max(0.0, -transformed.y);`;

const JELLY_FRAG_COMMON = /* glsl */ `#include <common>
varying vec3 vJelW;
varying vec3 vJelN;
varying vec3 vJel;
varying float vJelDepth;
varying float vJelPulse;
varying float vJelHue;
uniform vec3 uJelHue0, uJelHue1, uJelHue2, uJelGlowCol, uJelDeep;
uniform float uAbsorption, uJelGlow;
${COLONY_VISION_AND_LIGHTS_GLSL}`;

const JELLY_FRAG_COLOR = /* glsl */ `#include <color_fragment>
vec3 jelCol = vJelHue < 0.5 ? uJelHue0 : (vJelHue < 1.5 ? uJelHue1 : uJelHue2);
float jelMurk = 1.0 - exp(-(vJelDepth + 0.2) * uAbsorption * 2.0); // view path through the water above
float jelRim = pow(max(1.0 - abs(dot(normalize(vJelN), normalize(cameraPosition - vJelW))), 0.0), 2.0);
float jelTent = step(0.5, vJel.x);
diffuseColor.rgb = mix(jelCol * mix(0.95, 1.2, vJel.z), uJelDeep, jelMurk * 0.5);
diffuseColor.a = mix(0.55 + 0.4 * jelRim, 0.75, jelTent) * (1.0 - jelMurk * 0.3);`;

const JELLY_FRAG_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
{ vec3 taProj = evalColonyProjectorLight(vJelW, vJelN);
  totalEmissiveRadiance += diffuseColor.rgb * taProj * 0.5;
  float night = clamp(uNightFactor, 0.0, 1.0);
  float glowMask = max(vJel.z * vJel.z, jelTent * 0.8) * (0.55 + 0.45 * vJelPulse);
  totalEmissiveRadiance += uJelGlowCol * glowMask * uJelGlow * mix(0.04, 1.0, night) * (1.0 - jelMurk * 0.4); }`;

/** Violet, rose and cyan bells; one night-glow colour. */
export const JELLY_HUES: readonly [number, number, number] = [0xc4a2ff, 0xff9fcf, 0x9fe6ff];
const JELLY_GLOW = 0x7fe9ff;

/** `time` = the water's `uTime`, `deepColor` = the water's deep colour, `sink` = the shared wave sink. */
export function createJellyMaterial(time: THREE.IUniform, deepColor: THREE.IUniform, sink: THREE.IUniform): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.25, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  m.name = 'waterJellies';
  const c = (hex: number) => ({ value: new THREE.Color(hex) });
  const local: Record<string, THREE.IUniform> = {
    uTime: time, uFaunaSink: sink, uJelDeep: deepColor, uAbsorption: getWaterUniforms().uAbsorption,
    uJelGlow: { value: 4.5 }, uJelGlowCol: c(JELLY_GLOW),
    uJelHue0: c(JELLY_HUES[0]), uJelHue1: c(JELLY_HUES[1]), uJelHue2: c(JELLY_HUES[2]),
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms(), faunaWaterUniforms(), local);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', JELLY_VERT_COMMON)
      .replace('#include <beginnormal_vertex>', JELLY_VERT_MOTION)
      .replace('#include <begin_vertex>', JELLY_VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', JELLY_FRAG_COMMON)
      .replace('#include <color_fragment>', JELLY_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', JELLY_FRAG_EMISSIVE)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyColonyFovShroud(vJelW, gl_FragColor.rgb);');
  };
  m.customProgramCacheKey = () => 'terra-water-jellies-1';
  return m;
}
