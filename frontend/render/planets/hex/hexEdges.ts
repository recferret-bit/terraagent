import type * as THREE from 'three';

/**
 * Thin hex edge lines as a shader term (no line geometry: nothing to z-fight, antialiased by `fwidth`, constant on-screen
 * thinness). Injected after the terrain shader's colour block, so the lines darken the terrain colour a little.
 * World xz → tile units (2 m centre spacing, pointy-top) → distance to the nearest cell edge.
 */
const EDGE_FRAG = /* glsl */ `#include <alphatest_fragment>
{
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
  float w = max(0.025, fwidth(em) * 0.75);
  float line = 1.0 - smoothstep(w, w * 2.2, em);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, line * uEdge);
}`;

export function addHexEdges(sh: THREE.WebGLProgramParametersWithUniforms, edge: THREE.IUniform<number>): void {
  sh.uniforms.uEdge = edge;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uEdge;')
    .replace('#include <alphatest_fragment>', EDGE_FRAG);
}
