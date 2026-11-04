import type * as THREE from 'three';
import { glslFloat, injectAll } from '../../visuals/shaderInject';
import { TILE_M } from './hexMath';

/** Shader literal built from the TypeScript constant, so picking and the GPU always agree on the tile size. */
const TILE = glslFloat(TILE_M);

const HEX_VERT_COMMON = /* glsl */ `#include <common>
attribute float aHexFlat;
attribute float aHexShore;
varying float vHexFlat;
varying vec2 vFlatPos;
varying float vHexShore;`;

const HEX_VERT_BEGIN = /* glsl */ `vLP = position;
vHexFlat = aHexFlat;
vFlatPos = aHexFlat * (position.xz / ${TILE});
vHexShore = aHexShore;`;

/**
 * Class tint of one hex cell from the per-tile tint texture (`tileTint.ts`): axial `(q, r)` -> texel, alpha 0 outside
 * the planet. Looked up per cell (not interpolated per vertex) so a rock or slope tint stays inside its own hexagon.
 */
const TILE_TINT_GLSL = /* glsl */ `vec4 hexTileTint(vec2 axial) {
  if (max(max(abs(axial.x), abs(axial.y)), abs(axial.x + axial.y)) > uTileTintR + 0.5) return vec4(0.0);
  float n = 2.0 * uTileTintR + 1.0;
  return texture2D(uTileTint, (axial + uTileTintR + 0.5) / n);
}
vec4 hexTerraformMask(vec2 axial) {
  if (max(max(abs(axial.x), abs(axial.y)), abs(axial.x + axial.y)) > uTileTintR + 0.5) return vec4(0.0);
  float n = 2.0 * uTileTintR + 1.0;
  return texture2D(uTerraformMap, (axial + uTileTintR + 0.5) / n);
}`;

const HEX_FRAG_COMMON = /* glsl */ `#include <common>
// Flat hex land is levelled to 0 m = water level and dry basins sit below it: only real water tiles (vHexShore = 1,
// dry shore tiles <= 0.95) get the terrain shader's water-level bands. The dry beach next to water is drawn below.
#define TA_WATER_GATE smoothstep(0.96, 1.0, vHexShore)
#define TA_HEX_TERRAFORM 1
uniform float uEdge;
uniform sampler2D uTileTint;
uniform float uTileTintR;
varying float vHexFlat;
varying vec2 vFlatPos;
varying float vHexShore;
${TILE_TINT_GLSL}`;

/**
 * Tint of the fragment's own cell, blended with the neighbour across the nearest edge over the last ~0.45 m (50/50 at
 * the edge itself, so the tint is continuous across cells and a class boundary reads as a soft seam, not a painted hex).
 */
const HEX_TINT_GLSL = /* glsl */ `  vec2 ownAx = vec2(rc.x, rc.z);
  float d0 = o.x, d1 = dot(o, vec2(0.5, 0.8660254)), d2 = dot(o, vec2(-0.5, 0.8660254));
  vec2 nbStep = abs(d0) >= max(abs(d1), abs(d2)) ? vec2(sign(d0), 0.0)
    : (abs(d1) >= abs(d2) ? vec2(0.0, sign(d1)) : vec2(-sign(d2), sign(d2)));
  vec4 ownTint = hexTileTint(ownAx);
  vec4 nbTint = hexTileTint(ownAx + nbStep);
  float nbW = 0.5 * (1.0 - smoothstep(0.0, 0.45, em)) * nbTint.a;
  vec3 tileLinear = pow(max(mix(ownTint.rgb, nbTint.rgb, nbW), vec3(0.0)), vec3(2.2));
  float baseLum = max(0.08, dot(uLow, vec3(0.3333)));
  float detail = clamp(dot(diffuseColor.rgb, vec3(0.3333)) / baseLum, 0.52, 1.42);
  float isDune = step(uKind, 0.5);
  float tileMix = mix(0.72, 0.18, isDune);
  diffuseColor.rgb = mix(diffuseColor.rgb, tileLinear * detail, tileMix);`;

const HEX_SHORE_BEACH_GLSL = /* glsl */ `  float shoreZone = (1.0 - isDune) * smoothstep(0.18, 0.62, vHexShore);
  if (shoreZone > 0.001) {
    vec2 sp = vLP.xz;
    float sandNoise = fbm3(sp * 2.2);
    float pebble = smoothstep(0.72, 0.92, tHash(floor(sp * 9.0)));
    float ripple = sin(dot(sp, vec2(0.8, 0.6)) * 14.0 + sandNoise * 5.0);
    vec3 drySand = vec3(0.86, 0.76, 0.54) * (0.94 + 0.12 * sandNoise + 0.03 * ripple);
    drySand = mix(drySand, vec3(0.93, 0.85, 0.66), pebble * 0.35);
    vec3 wetSand = vec3(0.62, 0.52, 0.35) * (0.95 + 0.08 * sandNoise);
    // One continuous strip along the water, its inland edge broken by noise. Not a per-cell ring: banding each shore
    // cell's own edges left a green hexagon in the middle of every beach cell, outlined by sand.
    float coast = smoothstep(0.42, 0.7, vHexShore + (sandNoise - 0.5) * 0.3 + (vnoise(sp * 0.7) - 0.5) * 0.12);
    float underwater = 1.0 - smoothstep(-0.08, 0.02, vLP.y);
    float wetMask = clamp(max(underwater, (1.0 - smoothstep(0.0, 0.09, vLP.y)) * smoothstep(0.55, 0.85, vHexShore)), 0.0, 1.0);
    float beachMask = clamp(shoreZone * max(coast, underwater * 0.95), 0.0, 1.0);
    vec3 sandCol = mix(drySand, wetSand, wetMask);
    diffuseColor.rgb = mix(diffuseColor.rgb, sandCol, beachMask * 0.92);
    gRough = mix(gRough, mix(0.85, 0.38, wetMask), beachMask);
    gBump = mix(gBump, vec3(-0.8, 0.0, -0.6) * cos(dot(sp, vec2(0.8, 0.6)) * 14.0 + sandNoise * 5.0) * 0.08 * (1.0 - wetMask * 0.6), beachMask);
  }`;

const HEX_TERRAFORM_GLSL = /* glsl */ `  vec4 ownTf = hexTerraformMask(ownAx);
  vec4 nbTf = hexTerraformMask(ownAx + nbStep);
  float tfNbW = 0.5 * (1.0 - smoothstep(0.0, 0.45, em)) * nbTf.a;
  float hexSeam = (1.0 - smoothstep(0.0, 0.16, em)) * 0.46;
  float tfMask = max(0.0, mix(ownTf.r, nbTf.r, tfNbW) - hexSeam * ownTf.r * nbTf.r);
  float irrMask = max(0.0, mix(ownTf.g, nbTf.g, tfNbW) - hexSeam * ownTf.g * nbTf.g);
  evalTerraformSurface(diffuseColor.rgb, gRough, gEmis, vLP.xz, tfMask, irrMask, uTime);`;

/**
 * Per-cell terrain class tint (`uTileTint`), terraforming state (`uTerraformMap`), shore beach, and thin hex edge lines
 * as a shader term (no line geometry: nothing to z-fight, antialiased by `fwidth`). Hexagons are drawn strictly on
 * level, buildable flat tiles (`hexFlatMask` = 0 or 1, never faded); Prepared ground looks like that flat ground.
 */
const EDGE_FRAG = /* glsl */ `#include <alphatest_fragment>
{
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
${HEX_TINT_GLSL}
${HEX_SHORE_BEACH_GLSL}
${HEX_TERRAFORM_GLSL}
  float w = max(0.025, fwidth(em) * 0.75);
  float line = 1.0 - smoothstep(w, w * 2.2, em);
  float hexFlatMask = step(0.1, vHexFlat) * step(length(cen - vFlatPos / max(vHexFlat, 1e-4)), 0.72);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, line * uEdge * hexFlatMask);
}`;

/** Hex terms on top of the terrain shader; `uTileTint` / `uTileTintR` come with the terrain uniforms (`tileTint.ts`). */
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
