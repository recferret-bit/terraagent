import * as THREE from 'three';
import { GLSL_NOISE } from './glslNoise';
import { mulberry32 } from './SpaceBackdrop';

/**
 * World-space depth layers for the orbital menu so camera/mouse motion produces real 3D parallax:
 *   far stars (z≈-620) → mid stars (-320) → near stars (-150) → nebula planes (-650/-430/-270) →
 *   distant gas giant + ice dwarf (-230/-340) → asteroid drift (z -40..30) → foreground dust motes (z +28..48).
 * The stage's camera sits at z≈CAM and looks down -Z, so every layer is a slab perpendicular to the view.
 */
export interface ParallaxLayers {
  readonly group: THREE.Group;
  setNebulaTint(a: THREE.Color): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

const STAR_VERT = /* glsl */ `
attribute float aSize; attribute float aSeed; attribute vec3 aCol;
uniform float uTime, uScale; varying vec3 vCol; varying float vTw;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale;
  vTw = 0.75 + 0.25 * sin(uTime * (0.8 + aSeed * 2.2) + aSeed * 40.0);
  vCol = aCol;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vCol; varying float vTw; uniform float uBright;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
  float core = exp(-d * d * 7.0); float halo = exp(-d * 3.2) * 0.25;
  float a = (core + halo) * step(d, 1.0);
  gl_FragColor = vec4(vCol * uBright * vTw * a, a);
}`;

const NEB_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uA, uB; uniform float uTime, uI, uSeed; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(3.2, 2.0) + vec2(uSeed, uSeed * 0.7);
  vec2 w = vec2(fbm2(p * 1.1 + uTime * 0.004), fbm2(p * 1.1 + 7.0 - uTime * 0.003));
  float n = fbm2(p * 1.6 + (w - 0.5) * 1.8);
  float m = smoothstep(0.42, 0.85, n);
  float lane = smoothstep(0.35, 0.8, fbm2(p * 3.2 + 11.0 + w));
  vec3 col = mix(uA, uB, smoothstep(0.3, 0.8, fbm2(p * 0.8 + 3.0))) * m * (0.45 + 0.8 * lane);
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
  gl_FragColor = vec4(col * uI * edge, 1.0);
}`;

const GIANT_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uA, uB, uSunDir; uniform float uSeed, uTime;
varying vec3 vObj; varying vec3 vWN;
void main(){
  vec3 P = normalize(vObj);
  float band = sin(P.y * 22.0 + fbm3lo(P * 3.0 + uSeed) * 4.0 + uTime * 0.02) * 0.5 + 0.5;
  vec3 alb = mix(uA, uB, band * 0.8 + fbm3lo(P * 9.0) * 0.2);
  float d = clamp(dot(normalize(vWN), normalize(uSunDir)), 0.0, 1.0);
  float term = smoothstep(0.0, 0.3, d);
  gl_FragColor = vec4(alb * (0.02 + 0.9 * term), 1.0);
}`;
const OBJ_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vWN;
void main(){ vObj = position; vWN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const RING_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uCol; varying vec3 vObj;
void main(){
  float r = length(vObj.xy);
  float t = smoothstep(1.35, 1.4, r) * (1.0 - smoothstep(2.15, 2.2, r));
  float bands = 0.55 + 0.45 * sin(r * 70.0 + fbm2(vec2(r * 14.0, 0.0)) * 6.0);
  float gap = 1.0 - smoothstep(0.0, 0.02, abs(r - 1.8));
  gl_FragColor = vec4(uCol * bands * (1.0 - 0.8 * gap) * 0.75, t * 0.85 * bands);
}`;

export function createParallaxLayers(opts: { seed: number; camDist: number; sunDir: THREE.Vector3; aspect: () => number }): ParallaxLayers {
  const rnd = mulberry32(opts.seed);
  const group = new THREE.Group(); group.name = 'ParallaxLayers';
  const disposables: { dispose(): void }[] = [];
  const mats: THREE.ShaderMaterial[] = [];
  const halfTan = Math.tan(THREE.MathUtils.degToRad(14));
  const slab = (depthBehind: number) => { const dist = opts.camDist + depthBehind; return { w: halfTan * dist * 2.9, h: halfTan * dist * 1.25 }; };

  // ---- star layers
  const starLayer = (depth: number, count: number, size: number, bright: number, tint: THREE.Color, order: number) => {
    const { w, h } = slab(depth);
    const pos = new Float32Array(count * 3), sz = new Float32Array(count), sd = new Float32Array(count), col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() * 2 - 1) * w; pos[i * 3 + 1] = (rnd() * 2 - 1) * h; pos[i * 3 + 2] = -depth + (rnd() - 0.5) * depth * 0.08;
      sz[i] = size * (0.5 + Math.pow(rnd(), 3) * 2.2); sd[i] = rnd();
      c.setHSL(rnd() < 0.2 ? 0.07 : rnd() < 0.4 ? 0.6 : 0.58, 0.35 * rnd(), 0.78 + rnd() * 0.2).lerp(tint, 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: Math.min(window.devicePixelRatio, 2) }, uBright: { value: bright } },
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = order; group.add(p);
    disposables.push(g, m); mats.push(m);
    return p;
  };
  const white = new THREE.Color(0xffffff);
  starLayer(640, 2600, 2.2, 0.9, white, -80);
  starLayer(330, 900, 3.4, 1.4, new THREE.Color(0xbfd4ff), -79);
  starLayer(150, 160, 6.5, 2.6, new THREE.Color(0xffe2bf), -78);

  // ---- nebula planes (additive, tinted from the planet's atmosphere)
  const nebMats: THREE.ShaderMaterial[] = [];
  const nebula = (depth: number, a: number, b: number, i: number, seed: number, order: number) => {
    const { w, h } = slab(depth);
    const g = new THREE.PlaneGeometry(w * 2.1, h * 2.4);
    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NEB_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uTime: { value: 0 }, uI: { value: i }, uSeed: { value: seed } },
    });
    const mesh = new THREE.Mesh(g, m); mesh.position.set(0, 0, -depth); mesh.renderOrder = order; mesh.frustumCulled = false; group.add(mesh);
    disposables.push(g, m); mats.push(m); nebMats.push(m);
    return mesh;
  };
  nebula(650, 0x203a8a, 0x7a2a7a, 0.34, 3.1, -70);
  nebula(430, 0x1a5a7a, 0x2a2a8a, 0.2, 9.4, -69);
  nebula(270, 0x3a2a6a, 0x16527a, 0.12, 15.7, -68);

  // ---- distant planets (gas giant with rings + small ice dwarf), lit from the same sun
  const sunDirW = opts.sunDir.clone().normalize();
  const giantMat = new THREE.ShaderMaterial({ vertexShader: OBJ_VERT, fragmentShader: GIANT_FRAG, uniforms: { uA: { value: new THREE.Color(0xc9a67a) }, uB: { value: new THREE.Color(0x7a4f3a) }, uSunDir: { value: sunDirW }, uSeed: { value: 3.7 }, uTime: { value: 0 } } });
  const giantGeo = new THREE.SphereGeometry(1, 64, 40);
  const giant = new THREE.Group(); giant.position.set(-150, 2, -260); giant.rotation.set(0.35, 0, -0.45);
  const gBody = new THREE.Mesh(giantGeo, giantMat); gBody.scale.setScalar(21); gBody.renderOrder = -60;
  const ringMat = new THREE.ShaderMaterial({ vertexShader: OBJ_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uCol: { value: new THREE.Color(0xd9c4a0) } } });
  const ringGeo = new THREE.RingGeometry(1.35, 2.2, 96, 1);
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.scale.setScalar(21); ring.rotation.x = -Math.PI / 2; ring.renderOrder = -59;
  giant.add(gBody, ring); group.add(giant);
  const dwarfMat = new THREE.ShaderMaterial({ vertexShader: OBJ_VERT, fragmentShader: GIANT_FRAG, uniforms: { uA: { value: new THREE.Color(0x9fc4d8) }, uB: { value: new THREE.Color(0xe8f2f8) }, uSunDir: { value: sunDirW }, uSeed: { value: 8.1 }, uTime: { value: 0 } } });
  const dwarf = new THREE.Mesh(giantGeo, dwarfMat); dwarf.scale.setScalar(7.5); dwarf.position.set(150, -34, -340); dwarf.renderOrder = -61; group.add(dwarf);
  disposables.push(giantMat, giantGeo, ringMat, ringGeo, dwarfMat);

  // ---- asteroid drift (mid-depth, lit by the stage's lights)
  const N = 42;
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  { const p = rockGeo.attributes.position; const v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + 0.28 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7); p.setXYZ(i, v.x * n, v.y * n, v.z * n); } rockGeo.computeVertexNormals(); }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6a66, roughness: 0.95, metalness: 0.05 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, N);
  // Asteroids drift forever: they travel just past the widest possible view edge, shrink to nothing at both ends
  // (so there is never a visible pop), then respawn on the far side with new height/size/speed.
  const spawn = (r: { x: number; y: number; z: number; s: number; vx: number; lim: number; s0: number; rx: number; ry: number; ax: number; ay: number }, first: boolean) => {
    r.z = -40 + rnd() * 75;
    r.lim = halfTan * (opts.camDist - r.z) * 2.6 * 1.3;           // beyond a 2.6:1 ultrawide view + camera parallax
    r.x = first ? (rnd() * 2 - 1) * r.lim : -r.lim;
    r.y = (rnd() * 2 - 1) * halfTan * (opts.camDist - r.z) * 0.95;
    r.s0 = 0.04 + Math.pow(rnd(), 2.4) * 0.2; r.vx = 0.15 + rnd() * 0.5;
    r.rx = rnd() * 6; r.ry = rnd() * 6; r.ax = rnd() - 0.5; r.ay = rnd() - 0.5;
  };
  const rd = Array.from({ length: N }, () => { const r = { x: 0, y: 0, z: 0, s: 1, vx: 0, lim: 1, s0: 0.1, rx: 0, ry: 0, ax: 0, ay: 0 }; spawn(r, true); return r; });
  rocks.frustumCulled = false; group.add(rocks);
  disposables.push(rockGeo, rockMat);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();

  // ---- foreground motes: huge soft out-of-focus specks very near the camera (strongest parallax)
  {
    const count = 34;
    const pos = new Float32Array(count * 3), sz = new Float32Array(count), sd = new Float32Array(count), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const z = 26 + rnd() * 22; const { w, h } = slab(-z);
      pos.set([(rnd() * 2 - 1) * w * 0.7, (rnd() * 2 - 1) * h * 0.9, z], i * 3); sz[i] = 10 + rnd() * 26; sd[i] = rnd(); col.set([0.6, 0.7, 0.9], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uScale: { value: Math.min(window.devicePixelRatio, 2) }, uBright: { value: 0.05 } } });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 20; group.add(p);
    disposables.push(g, m); mats.push(m);
  }

  const tint = new THREE.Color();
  return {
    group,
    setNebulaTint(a) {
      for (const m of nebMats) { (m.uniforms.uA.value as THREE.Color).copy(a); }
      tint.copy(a);
    },
    update(dt, time) {
      for (const m of mats) if (m.uniforms.uTime) m.uniforms.uTime.value = time;
      giantMat.uniforms.uTime.value = time; dwarfMat.uniforms.uTime.value = time;
      gBody.rotation.y = time * 0.01; dwarf.rotation.y = time * 0.02;
      for (let i = 0; i < N; i++) {
        const r = rd[i]; r.x += r.vx * dt; if (r.x > r.lim) spawn(r, false);
        r.s = r.s0 * THREE.MathUtils.smoothstep(r.lim - Math.abs(r.x), 0, r.lim * 0.14);
        e.set(r.rx + time * r.ax * 0.6, r.ry + time * r.ay * 0.6, 0); q.setFromEuler(e);
        m4.compose(pv.set(r.x, r.y, r.z), q, sv.setScalar(r.s)); rocks.setMatrixAt(i, m4);
      }
      rocks.instanceMatrix.needsUpdate = true;
    },
    dispose() { disposables.forEach((d) => d.dispose()); rocks.dispose(); group.removeFromParent(); },
  };
}
