import type * as THREE from 'three';

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
float prepBlend = aPrepTarget * clamp((uTime - aPrepStartTime) / 0.4, 0.0, 1.0);
vPrepTarget = aPrepTarget;
vPrepBlend = prepBlend;`;

const HEX_FRAG_COMMON = /* glsl */ `#include <common>
uniform float uEdge;
varying vec3 vTileColor;
varying float vPrepTarget;
varying float vPrepBlend;`;

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
  float detail = clamp(dot(diffuseColor.rgb, vec3(0.3333)) / baseLum, 0.65, 1.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, vTileColor * detail, 0.72);
  vec2 tp = vLP.xz / 2.0;                          // tile units
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
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, line * uEdge);
}`;

export function addHexEdges(sh: THREE.WebGLProgramParametersWithUniforms, edge: THREE.IUniform<number>): void {
  sh.uniforms.uEdge = edge;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', HEX_VERT_COMMON)
    .replace('vLP = position;', HEX_VERT_BEGIN);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', HEX_FRAG_COMMON)
    .replace('#include <alphatest_fragment>', EDGE_FRAG);
}
