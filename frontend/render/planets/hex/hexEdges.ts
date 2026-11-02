import type * as THREE from 'three';
import { ProceduralTextureRegistry } from '../../visuals/ProceduralTextureRegistry';
import { glslFloat, injectAll } from '../../visuals/shaderInject';
import { PREP_BLEND_DURATION_S } from './chunkMesh';
import { TILE_M } from './hexMath';

/** Shader literals built from the TypeScript constants, so picking / `getTilePrepBlend` and the GPU always agree. */
const TILE = glslFloat(TILE_M);
const BLEND_S = glslFloat(PREP_BLEND_DURATION_S);
/** Size (px) of the foundation pad texture bundle; the generator is designed for 128². */
const FOUNDATION_PAD_TEX_SIZE = 128;

const HEX_VERT_COMMON = /* glsl */ `#include <common>
#ifndef USE_COLOR
attribute vec3 color;
#endif
attribute float aPrepTarget;
attribute float aPrepStartTime;
uniform float uTime;
varying vec3 vTileColor;
varying float vPrepTarget;
varying float vPrepBlend;`;

const HEX_VERT_BEGIN = /* glsl */ `vLP = position;
vTileColor = color;
float prepBlend = aPrepTarget * clamp((uTime - aPrepStartTime) / ${BLEND_S}, 0.0, 1.0);
vPrepTarget = aPrepTarget;
vPrepBlend = prepBlend;`;

/** Engineered hex-plate foundation pad evaluator for Prepared ground (samples the `foundationHexPad` bundle). */
const FOUNDATION_PAD_GLSL = /* glsl */ `vec3 evalFoundationPad(vec2 worldXZ, vec2 hexOff, float edgeMeters, out vec3 padBump, out float padRough) {
  vec2 padUv = worldXZ / ${TILE};
  vec3 texCol = texture2D(uPadMap, padUv).rgb;
  vec3 texN = texture2D(uPadNormal, padUv).xyz * 2.0 - 1.0;
  float texR = texture2D(uPadRough, padUv).r;

  float rib0 = abs(hexOff.x);
  float rib1 = abs(dot(hexOff, vec2(0.8660254, 0.5)));
  float rib2 = abs(dot(hexOff, vec2(-0.8660254, 0.5)));
  float minRib = min(rib0, min(rib1, rib2));
  float hexRadius = 0.5 - edgeMeters * 0.5;
  float innerRing = abs(hexRadius - 0.24);
  float seamMask = 1.0 - smoothstep(0.014, 0.032, min(minRib, innerRing));
  float outerSeam = 1.0 - smoothstep(0.04, 0.09, edgeMeters);
  float outerBevel = smoothstep(0.05, 0.09, edgeMeters) * (1.0 - smoothstep(0.11, 0.17, edgeMeters));

  float c0 = length(hexOff - vec2(0.0, 0.38));
  float c1 = length(hexOff - vec2(0.0, -0.38));
  float c2 = length(hexOff - vec2(0.329, 0.19));
  float c3 = length(hexOff - vec2(-0.329, 0.19));
  float c4 = length(hexOff - vec2(0.329, -0.19));
  float c5 = length(hexOff - vec2(-0.329, -0.19));
  float anchorDist = min(min(c0, c1), min(min(c2, c3), min(c4, c5)));
  float anchorHead = 1.0 - smoothstep(0.022, 0.038, anchorDist);
  float anchorCollar = smoothstep(0.024, 0.038, anchorDist) * (1.0 - smoothstep(0.048, 0.068, anchorDist));

  vec3 plateBase = mix(vec3(0.47, 0.51, 0.46), texCol, 0.65);
  vec3 seamCol = vec3(0.16, 0.19, 0.22);
  vec3 bevelCol = vec3(0.62, 0.66, 0.60);
  vec3 anchorAmber = vec3(0.86, 0.58, 0.22);
  vec3 col = mix(plateBase, bevelCol, outerBevel * 0.55);
  col = mix(col, seamCol, max(seamMask * 0.75, outerSeam * 0.85));
  col = mix(col, seamCol * 0.85, anchorCollar * 0.8);
  col = mix(col, anchorAmber, anchorHead * 0.88);

  vec2 bevelGrad = normalize(hexOff + vec2(1e-5)) * (outerBevel - outerSeam) * 0.35;
  padBump = vec3(texN.x * 0.28 + bevelGrad.x, 0.0, texN.y * 0.28 + bevelGrad.y);
  padRough = mix(clamp(texR, 0.38, 0.54), 0.84, max(seamMask, outerSeam));
  padRough = mix(padRough, 0.32, anchorHead);
  return col;
}`;

const HEX_FRAG_COMMON = /* glsl */ `#include <common>
uniform sampler2D uPadMap, uPadNormal, uPadRough;
uniform float uEdge;
varying vec3 vTileColor;
varying float vPrepTarget;
varying float vPrepBlend;
${FOUNDATION_PAD_GLSL}`;

const HEX_PAD_BLEND_GLSL = /* glsl */ `  float prepFootprint = smoothstep(0.36, 0.54, vPrepTarget);
  float prepProgress = clamp(vPrepBlend / max(vPrepTarget, 0.0001), 0.0, 1.0);
  float prepBlend = prepFootprint * prepProgress;
  if (prepBlend > 0.001) {
    vec3 padBump;
    float padRough;
    vec3 padCol = evalFoundationPad(vLP.xz, o, em, padBump, padRough);
    float radial = clamp(length(o) * 1.85, 0.0, 1.0);
    float waveMask = smoothstep(radial - 0.18, radial + 0.06, prepProgress);
    float activeBlend = prepFootprint * mix(prepProgress, waveMask, 0.45);
    float scanRing = prepFootprint * smoothstep(0.01, 0.12, prepProgress) * (1.0 - smoothstep(0.88, 0.995, prepProgress))
      * exp(-abs(radial - prepProgress) * 14.0);
    vec3 frontierGlow = vec3(0.96, 0.62, 0.20) * scanRing * 2.4;
    diffuseColor.rgb = mix(diffuseColor.rgb, padCol, activeBlend) + frontierGlow * 0.35;
    gRough = mix(gRough, padRough, activeBlend);
    gBump = mix(gBump, padBump, activeBlend);
    gEmis += frontierGlow;
  }`;

/**
 * Per-tile terrain class colour tint (`vTileColor`), 0.4 s Wild -> Prepared foundation hex-plate pad blend,
 * and thin hex edge lines as a shader term (no line geometry: nothing to z-fight, antialiased by `fwidth`).
 */
const EDGE_FRAG = /* glsl */ `#include <alphatest_fragment>
{
  float baseLum = max(0.08, dot(uLow, vec3(0.3333)));
  float detail = clamp(dot(diffuseColor.rgb, vec3(0.3333)) / baseLum, 0.52, 1.42);
  vec3 tileLinear = pow(max(vTileColor, vec3(0.0)), vec3(2.2));
  float isDune = step(uKind, 0.5);
  float depTint = clamp(abs(vTileColor.b - vTileColor.r * 0.42) * 2.8, 0.0, 1.0);
  float tileMix = mix(0.72, mix(0.18, 0.68, depTint), isDune);
  diffuseColor.rgb = mix(diffuseColor.rgb, tileLinear * detail, tileMix);
  vec2 tp = vLP.xz / ${TILE};                          // tile units
  float hr = tp.y * 1.1547005;                     // 2/sqrt(3)
  vec2 ax = vec2(tp.x - hr * 0.5, hr);             // fractional axial (q, r)
  vec3 cube = vec3(ax.x, -ax.x - ax.y, ax.y);
  vec3 rc = floor(cube + 0.5);
  vec3 df = abs(rc - cube);
  if (df.x > df.y && df.x > df.z) rc.x = -rc.y - rc.z; else if (df.y > df.z) rc.y = -rc.x - rc.z; else rc.z = -rc.x - rc.y;
  vec2 cen = vec2(rc.x + rc.z * 0.5, rc.z * 0.8660254); // centre, tile units
  vec2 o = tp - cen;
  float e = 0.5 - max(max(abs(o.x), abs(dot(o, vec2(0.5, 0.8660254)))), abs(dot(o, vec2(-0.5, 0.8660254))));
  float em = e * 2.0;                              // metres to the edge
${HEX_PAD_BLEND_GLSL}
  float w = max(0.025, fwidth(em) * 0.75);
  float line = 1.0 - smoothstep(w, w * 2.2, em);
  float duneSlopeFade = mix(1.0, mix(1.0 - smoothstep(0.008, 0.04, 1.0 - normalize(vLN).y) * 0.72, 1.0, prepFootprint), isDune);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, line * uEdge * duneSlopeFade);
}`;

/** Uniforms of the Prepared pad (only the hex terrain draws it, so only its material pays for the textures). */
export function foundationPadUniforms(): Record<string, THREE.IUniform> {
  const pad = ProceduralTextureRegistry.get('foundationHexPad', FOUNDATION_PAD_TEX_SIZE);
  return {
    uPadMap: { value: pad.map ?? null },
    uPadNormal: { value: pad.normalMap ?? null },
    uPadRough: { value: pad.roughnessMap ?? null },
  };
}

export function addHexEdges(sh: THREE.WebGLProgramParametersWithUniforms, edge: THREE.IUniform<number>): void {
  sh.uniforms.uEdge = edge;
  sh.vertexShader = injectAll(sh.vertexShader, [
    ['#include <common>', HEX_VERT_COMMON],
    ['vLP = position;', HEX_VERT_BEGIN],
  ], 'hex terrain vertex');
  sh.fragmentShader = injectAll(sh.fragmentShader, [
    ['#include <common>', HEX_FRAG_COMMON],
    ['#include <alphatest_fragment>', EDGE_FRAG],
  ], 'hex terrain fragment');
}
