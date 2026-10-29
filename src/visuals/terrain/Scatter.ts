import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2, mulberry32 } from './noise';

export interface Place { x: number; y: number; z: number; rot: number; s: number; r: number }

/** Jittered-grid scatter; `prob(x,z,r)` returns acceptance probability (0 = reject). */
export function scatterGrid(rng: () => number, extent: number, cell: number, prob: (x: number, z: number, r: number) => number): Place[] {
  const out: Place[] = [];
  const n = Math.floor((extent * 2) / cell);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -extent + (i + 0.5 + (rng() - 0.5) * 0.95) * cell, z = -extent + (j + 0.5 + (rng() - 0.5) * 0.95) * cell;
    const r = rng(), rot = rng() * Math.PI * 2, s = rng();
    const p = prob(x, z, r);
    if (p > 0 && rng() < p) out.push({ x, y: 0, z, rot, s, r: rng() });
  }
  return out;
}

type G = THREE.BufferGeometry;
function paint(g: G, color: THREE.Color, jitter = 0, topBoost = 0, seed = 1): G {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const p = out.getAttribute('position'), n = p.count;
  const col = new Float32Array(n * 3);
  const rng = mulberry32(seed);
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const hgt = Math.max(1e-3, box.max.y - box.min.y);
  const tmp = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    const k = 1 + (rng() - 0.5) * 2 * jitter; // per-face shade
    for (let v = 0; v < 3; v++) {
      const y = (p.getY(t + v) - box.min.y) / hgt;
      tmp.copy(color).multiplyScalar(k * (1 + topBoost * (y - 0.5)));
      col[(t + v) * 3] = tmp.r; col[(t + v) * 3 + 1] = tmp.g; col[(t + v) * 3 + 2] = tmp.b;
    }
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function xf(g: G, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): G {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
  return g;
}
function blob(radius: number, detail: number, noise: Noise2, amp: number, seedOff: number): G {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + amp * noise.n(v.x * 1.7 + seedOff, v.y * 1.7 + v.z * 1.3);
    p.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  g.computeVertexNormals();
  return g;
}
const C = (h: number | THREE.Color) => (h instanceof THREE.Color ? h.clone() : new THREE.Color(h));
const done = (parts: G[]) => { const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!; m.computeVertexNormals(); return m; };

export function makeBroadleafGeo(leafA: THREE.Color, leafB: THREE.Color, seed: number): G {
  const nz = new Noise2(seed);
  const trunk = xf(new THREE.CylinderGeometry(0.11, 0.2, 1.7, 6, 1), [0, 0.85, 0]);
  const parts: G[] = [paint(trunk, C(0x5a3d26), 0.1, 0, 1)];
  const blobs: [number, number, number, number, THREE.Color][] = [
    [0, 2.4, 0, 1.25, leafA], [0.65, 2.0, 0.3, 0.8, leafB], [-0.55, 2.15, -0.35, 0.85, leafA], [0.1, 3.05, -0.1, 0.8, leafB], [-0.2, 2.0, 0.6, 0.7, leafB],
  ];
  blobs.forEach(([x, y, z, r, c], i) => parts.push(paint(xf(blob(r, 0, nz, 0.25, i * 3.1), [x, y, z], [1, 0.88, 1]), c, 0.07, 0.55, 10 + i)));
  return done(parts);
}

export function makePalmGeo(leaf: THREE.Color): G {
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 1.4, 0.1), new THREE.Vector3(0.55, 2.8, 0.1), new THREE.Vector3(0.5, 4.2, 0.0)]);
  const trunk = new THREE.TubeGeometry(curve, 8, 0.13, 5, false);
  const parts: G[] = [paint(trunk, C(0x8a6a46), 0.12, 0.2, 3)];
  const top = curve.getPoint(1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const leafG = new THREE.PlaneGeometry(0.55, 2.4, 1, 5);
    const lp = leafG.getAttribute('position');
    for (let k = 0; k < lp.count; k++) {
      const t = Math.min(1, Math.max(0, (lp.getY(k) + 1.2) / 2.4)); // 0..1 along frond
      const w = Math.sin(t * Math.PI * 0.95 + 0.1);
      lp.setXYZ(k, lp.getX(k) * (0.35 + w), t * 2.2, -Math.pow(t, 1.8) * 1.3 + Math.abs(lp.getX(k)) * 0.3);
    }
    leafG.rotateX(-0.45); leafG.rotateY(a);
    xf(leafG, [top.x, top.y, top.z]);
    parts.push(paint(leafG, leaf, 0.12, 0.5, 20 + i));
  }
  parts.push(paint(xf(new THREE.IcosahedronGeometry(0.2, 0), [top.x, top.y - 0.1, top.z]), C(0x6b4a2a), 0.1, 0, 5));
  return done(parts);
}

export function makePineGeo(a: THREE.Color, b: THREE.Color): G {
  const parts: G[] = [paint(xf(new THREE.CylinderGeometry(0.1, 0.2, 1.6, 6, 1), [0, 0.8, 0]), C(0x4a3424), 0.1, 0, 2)];
  const tiers: [number, number, number][] = [[1.7, 1.6, 1.2], [1.4, 1.5, 2.3], [1.1, 1.4, 3.3], [0.75, 1.3, 4.2], [0.4, 1.1, 5.0]];
  tiers.forEach(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) { const s = 1 + 0.12 * Math.sin(k * 7.3 + i * 2.1); p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s); }
    parts.push(paint(xf(g, [0, y + h / 2 - 0.2, 0]), i % 2 ? a : b, 0.08, 0.35, 30 + i));
  });
  return done(parts);
}

/** Low-poly faceted boulder. Flat bottom, noisy faceted top. */
export function makeBoulderGeo(seed: number, tint = new THREE.Color(1, 1, 1)): G {
  const nz = new Noise2(seed);
  const g = blob(1, 1, nz, 0.38, seed * 1.7);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.35) p.setY(i, -0.35 + (p.getY(i) + 0.35) * 0.15);
  g.computeVertexNormals();
  return paint(g, tint, 0.1, 0.3, seed);
}

/** Tall rock spire / obsidian shard: tapered hexagonal prism with kinks. */
export function makeSpireGeo(seed: number, tint = new THREE.Color(1, 1, 1)): G {
  const nz = new Noise2(seed);
  const g = new THREE.CylinderGeometry(0.1, 0.85, 1, 6, 5);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + 0.25 * nz.n(p.getX(i) * 3 + 5, y * 3 + p.getZ(i) * 3);
    p.setXYZ(i, p.getX(i) * k + y * y * 0.25 * nz.n(seed, 1), y, p.getZ(i) * k + y * y * 0.2 * nz.n(seed, 2));
  }
  g.computeVertexNormals();
  return paint(g, tint, 0.12, 0.45, seed);
}

export function createFoliageMaterial(timeU: THREE.IUniform, sway: number, doubleSided = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: true, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU; sh.uniforms.uSway = { value: sway };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
#else
  vec3 ip = vec3(0.0);
#endif
  float swk = max(position.y, 0.0) * 0.03 * uSway;
  transformed.x += sin(uTime*1.5 + ip.x*0.7 + ip.z*0.5) * swk;
  transformed.z += cos(uTime*1.25 + ip.z*0.6 + ip.x*0.3) * swk * 0.7;`);
  };
  return m;
}

/** Rock material: world-space grain + ground-up darkening, faceted, works with instanceColor. */
export function createRockMaterial(opts: { rough?: number; metal?: number; flat?: boolean }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0, flatShading: opts.flat ?? true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vRW = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;
#else
  vRW = (modelMatrix * vec4(position,1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW;\nfloat rH(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y);} \nfloat rN(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rH(i),rH(i+vec2(1,0)),f.x),mix(rH(i+vec2(0,1)),rH(i+vec2(1,1)),f.x),f.y);}')
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float g = rN(vRW.xz*3.1 + vRW.y*1.7)*0.6 + rN(vRW.xz*9.0 - vRW.y*4.0)*0.4;
  float st = rN(vec2(vRW.x*0.4+vRW.z*0.3, vRW.y*2.2));
  diffuseColor.rgb *= 0.78 + 0.4*g;
  diffuseColor.rgb *= 0.85 + 0.3*st;
  diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(-0.2, 1.4, vRW.y)); }`);
  };
  return m;
}

export interface InstOpts {
  sx?: [number, number]; sy?: [number, number]; sink?: number; tilt?: number;
  tint?: (r: number, c: THREE.Color) => void; scaleMul?: (p: Place) => number;
}
export function buildInstanced(geo: G, mat: THREE.Material, places: Place[], opt: InstOpts): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, places.length));
  im.count = places.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3(), c = new THREE.Color();
  const sx = opt.sx ?? [0.8, 1.3], sy = opt.sy ?? sx;
  places.forEach((p, i) => {
    const k = opt.scaleMul ? opt.scaleMul(p) : 1;
    const a = (sx[0] + (sx[1] - sx[0]) * p.s) * k;
    const b = (sy[0] + (sy[1] - sy[0]) * ((p.s * 7.13 + p.r * 0.5) % 1)) * k;
    e.set((p.r - 0.5) * (opt.tilt ?? 0), p.rot, (((p.s * 13.7) % 1) - 0.5) * (opt.tilt ?? 0));
    q.setFromEuler(e); s.set(a, b, a); t.set(p.x, p.y - (opt.sink ?? 0) * b, p.z);
    m.compose(t, q, s); im.setMatrixAt(i, m);
    c.setRGB(1, 1, 1); opt.tint?.(p.r, c); im.setColorAt(i, c);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true;
  return im;
}
