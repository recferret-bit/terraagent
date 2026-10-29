import * as THREE from 'three';
import type { PlanetSpec } from '../../planets/PlanetSpec';
import type { HeightField } from './heightfields';
import { NOISE_GLSL } from './glsl';

export interface TerrainResult {
  mesh: THREE.Mesh;
  heightAt(x: number, z: number): number;
  heightTex: THREE.DataTexture;
  span: number; // full world size of the grid
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

const KIND_INDEX = { dune: 0, oceanForest: 1, forestRock: 2 } as const;

/** Single high-res displaced grid. heightAt() interpolates the SAME triangles the GPU renders. */
export function createTerrain(spec: PlanetSpec, field: HeightField, half: number, N: number): TerrainResult {
  const span = half * 4;
  const step = span / N;
  const V = N + 1;
  const hs = new Float32Array(V * V);
  const pos = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -span / 2 + i * step, z = -span / 2 + j * step;
    const h = field.height(x, z);
    const k = j * V + i;
    hs[k] = h; pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
  }
  const nor = new Float32Array(V * V * 3);
  const H = (i: number, j: number) => hs[Math.min(N, Math.max(0, j)) * V + Math.min(N, Math.max(0, i))];
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const dx = (H(i - 1, j) - H(i + 1, j)) / (2 * step), dz = (H(i, j - 1) - H(i, j + 1)) / (2 * step);
    const l = Math.hypot(dx, 1, dz), k = (j * V + i) * 3;
    nor[k] = dx / l; nor[k + 1] = 1 / l; nor[k + 2] = dz / l;
  }
  const idx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * V + i, c = a + 1, b = a + V, d = b + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = c;
    idx[q++] = c; idx[q++] = b; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), span);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-span / 2, -10, -span / 2), new THREE.Vector3(span / 2, 30, span / 2));

  // half-float height texture for liquids (depth-based colouring)
  const hd = new Uint16Array(V * V);
  for (let k = 0; k < hd.length; k++) hd[k] = THREE.DataUtils.toHalfFloat(hs[k]);
  const heightTex = new THREE.DataTexture(hd, V, V, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter; heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  const heightAt = (x: number, z: number) => {
    const fx = Math.min(Math.max((x + span / 2) / step, 0), N - 1e-6);
    const fz = Math.min(Math.max((z + span / 2) / step, 0), N - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h00 = hs[j * V + i], h10 = hs[j * V + i + 1], h01 = hs[(j + 1) * V + i], h11 = hs[(j + 1) * V + i + 1];
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };

  const p = spec.palette;
  const c = (n: number) => new THREE.Color(n);
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uKind: { value: KIND_INDEX[spec.kind] },
    uLevel: { value: field.liquid?.level ?? -99 },
    uExt: { value: half * 2 },
    uLow: { value: c(p.groundLow) }, uHigh: { value: c(p.groundHigh) },
    uRock: { value: c(p.rock) }, uRockDark: { value: c(p.rockDark) },
    uAccent: { value: c(p.accent) },
    uWind: { value: new THREE.Vector2(field.wind[0], field.wind[1]) },
  };

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLP; varying vec3 vLN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLP = position; vLN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uKind, uLevel, uExt;
uniform vec3 uLow, uHigh, uRock, uRockDark, uAccent; uniform vec2 uWind;
varying vec3 vLP; varying vec3 vLN;
vec3 gBump; vec3 gEmis; float gRough;
${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vLP.xz; float y = vLP.y;
  vec3 N = normalize(vLN);
  float sl = 1.0 - N.y;
  float n1 = vnoise(p*0.35), n2 = fbm3(p*1.7), nL = fbm3(p*0.045);
  float fine = vnoise(p*7.0);
  vec3 col; gEmis = vec3(0.0); gRough = 0.92; gBump = vec3(0.0);
  float strat = smoothstep(0.35,0.65, vnoise(vec2(dot(p,vec2(0.05,0.03)), y*1.7)+n1*1.2));
  vec3 rockCol = mix(uRock, uRockDark, strat*0.5 + 0.2*n2) * 0.85;
  float rockMask = smoothstep(0.30, 0.50, sl);
  if (uKind < 0.5) {
    // ---- dune: wind-carved sand, rippled
    float ht = smoothstep(-0.5, 4.5, y);
    col = mix(uLow*0.8, uHigh*1.05, clamp(ht*0.9 + 0.3*nL + 0.12*n1 - 0.1, 0.0, 1.0));
    float ph = dot(p,uWind)*2.7 + 2.4*vnoise(p*0.25) + 1.6*nL;
    float flatF = 1.0 - smoothstep(0.12,0.45,sl);
    gBump += -vec3(uWind.x,0.0,uWind.y)*cos(ph)*0.24*flatF;
    col *= 1.0 + 0.06*sin(ph)*flatF;
    col = mix(col, uAccent, smoothstep(0.55,0.8,vnoise(p*0.09+3.0))*0.18);
    float crest = smoothstep(0.1,0.3,sl)*(1.0-rockMask);
    col = mix(col, uLow*0.85, crest*0.3);
    col = mix(col, rockCol, smoothstep(0.52,0.75,sl));
    gRough = 0.95;
  } else if (uKind < 1.5) {
    // ---- ocean forest: sand, grass, wet shore
    float above = y - uLevel;
    float sand = 1.0 - smoothstep(0.35, 1.15 + 0.5*n1, above);
    float hgt = smoothstep(0.5, 6.5, y);
    vec3 grass = mix(uLow, uHigh, clamp(hgt + 0.4*(n2-0.5) + 0.2*(nL-0.5), 0.0, 1.0));
    grass = mix(grass, grass*vec3(0.8,0.95,0.7), smoothstep(0.5,0.7,fbm3(p*0.16))*0.7);
    col = mix(grass, uAccent, sand);
    float wet = 1.0 - smoothstep(0.0, 0.55, above);
    col = mix(col, col*vec3(0.55,0.58,0.55), wet);
    float under = 1.0 - smoothstep(-2.6, 0.0, above);
    col = mix(col, uAccent*vec3(0.62,0.66,0.62), under*0.8*step(above,0.0));
    col = mix(col, rockCol, rockMask*smoothstep(0.0,0.5,above));
    gRough = mix(0.95, 0.55, wet);
  } else {
    // ---- forest rock: moss, meadow, cliffs
    float hgt = smoothstep(0.0, 8.0, y);
    col = mix(uLow, uHigh, clamp(hgt*0.6 + 0.5*(n2-0.4), 0.0, 1.0));
    float meadow = smoothstep(0.52,0.62, fbm3(p*0.055+7.0));
    col = mix(col, mix(uHigh, uAccent, 0.2), meadow*(1.0-rockMask));
    col = mix(col, uLow*0.7, (1.0-meadow)*smoothstep(0.45,0.7,n1)*0.5);
    float dirt = smoothstep(0.2,0.32,sl)*(1.0-rockMask);
    col = mix(col, vec3(0.30,0.24,0.17), dirt*0.6);
    col = mix(col, rockCol, rockMask);
    float above = y - uLevel; col = mix(col, vec3(0.22,0.2,0.15), (1.0-smoothstep(0.0,0.6,above))*0.8);
  }
  col *= 0.9 + 0.2*n2;
  col = mix(vec3(dot(col, vec3(0.3,0.59,0.11))), col, 1.3) * 0.92;
  // micro bump
  vec2 e = vec2(0.06,0.0);
  float b0 = vnoise(p*2.4)*0.6 + vnoise(p*6.1)*0.3;
  float bx = vnoise((p+e.xy)*2.4)*0.6 + vnoise((p+e.xy)*6.1)*0.3;
  float bz = vnoise((p+e.yx)*2.4)*0.6 + vnoise((p+e.yx)*6.1)*0.3;
  gBump += -vec3(bx-b0, 0.0, bz-b0)/0.06*0.07;
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix*vec4(gBump,0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmis;`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
#ifdef USE_FOG
  { float eg = smoothstep(0.55, 0.98, max(abs(vLP.x),abs(vLP.z))/uExt); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, eg); }
#endif`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return { mesh, heightAt, heightTex, span, uniforms, dispose() { geo.dispose(); mat.dispose(); heightTex.dispose(); } };
}
