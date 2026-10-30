import * as THREE from 'three';
import { mulberry32 } from '../terrain/noise';
import { DOME_VERT, DOME_FRAG, STAR_POINT_VERT, STAR_POINT_FRAG } from './backdropShaders';

export { mulberry32 };

export interface SpaceBackdropOptions {
  seed?: number;
  starCount?: number;
  /** Nebula tints (linear colours). */
  nebulaA?: THREE.ColorRepresentation;
  nebulaB?: THREE.ColorRepresentation;
  sunDir?: THREE.Vector3;
  pixelRatio?: number;
}

/**
 * Camera-following sky dome (gradient sky ↔ deep space with nebula) + HDR twinkling starfield.
 * One object serves both the menu backdrop (uSpace=1) and the descent (uSpace 1→0, sky colours take over).
 * Dome + stars render first (renderOrder < 0, no depth) so any scene geometry draws over them.
 */
export interface SpaceBackdrop {
  readonly group: THREE.Group;
  readonly uniforms: {
    uZenith: THREE.IUniform<THREE.Color>; uHorizon: THREE.IUniform<THREE.Color>;
    uSpace: THREE.IUniform<number>; uCloud: THREE.IUniform<number>; uCloudColor: THREE.IUniform<THREE.Color>;
    uSunDir: THREE.IUniform<THREE.Vector3>; uSunColor: THREE.IUniform<THREE.Color>; uSunDisc: THREE.IUniform<number>;
    uHorizonH: THREE.IUniform<number>; uBandUp: THREE.IUniform<number>; uBandI: THREE.IUniform<number>; uBandColor: THREE.IUniform<THREE.Color>;
    uNebA: THREE.IUniform<THREE.Color>; uNebB: THREE.IUniform<THREE.Color>; uNebI: THREE.IUniform<number>; uTime: THREE.IUniform<number>;
  };
  starOpacity: THREE.IUniform<number>;
  /** Call once per frame (follows the camera). */
  update(camera: THREE.Camera, time: number): void;
  dispose(): void;
}

/** Uniform sphere of HDR twinkling stars (a few exceed 1.1 and bloom). */
function buildStarGeometry(rnd: () => number, count: number) {
  const N = count;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * r * 800, u * 800, Math.sin(a) * r * 800], i * 3);
    const temp = rnd();
    tmp.setRGB(0.75 + 0.25 * temp, 0.82 + 0.1 * (1 - Math.abs(temp - 0.5)), 1.0 - 0.35 * temp);
    const bright = Math.pow(rnd(), 6.0);
    const k = 0.35 + bright * 3.2; // a few HDR stars (>1.1 → bloom)
    col.set([tmp.r * k, tmp.g * k, tmp.b * k], i * 3);
    size[i] = 1.0 + bright * 3.2 + rnd() * 0.6;
    ph[i] = rnd() * 6.283;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  sg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  return sg;
}

export function createSpaceBackdrop(opts: SpaceBackdropOptions = {}): SpaceBackdrop {
  const rnd = mulberry32(opts.seed ?? 77);
  const group = new THREE.Group();
  group.name = 'SpaceBackdrop';
  const sunDir = (opts.sunDir ?? new THREE.Vector3(0.486, 0.763, 0.347)).clone().normalize();

  const uniforms = {
    uZenith: { value: new THREE.Color(0x0a1a3a) }, uHorizon: { value: new THREE.Color(0x4a7ab0) },
    uSpace: { value: 1 }, uCloud: { value: 0 }, uCloudColor: { value: new THREE.Color(0xffffff) },
    uSunDir: { value: sunDir }, uSunColor: { value: new THREE.Color(1.0, 0.92, 0.78) }, uSunDisc: { value: 1 },
    uHorizonH: { value: 0 }, uBandUp: { value: 0 }, uBandI: { value: 0 }, uBandColor: { value: new THREE.Color(0xffa060) },
    uNebA: { value: new THREE.Color(opts.nebulaA ?? 0x2a3f9a) }, uNebB: { value: new THREE.Color(opts.nebulaB ?? 0x8a2a6a) },
    uNebI: { value: 0.3 }, uTime: { value: 0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), domeMat);
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  group.add(dome);

  // ---- stars
  const sg = buildStarGeometry(rnd, opts.starCount ?? 2600);
  const starOpacity = { value: 1 };
  const pr = opts.pixelRatio ?? Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2);
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uOpacity: starOpacity, uPR: { value: pr } },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: STAR_POINT_VERT, fragmentShader: STAR_POINT_FRAG,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.renderOrder = -90;
  stars.frustumCulled = false;
  group.add(stars);

  return {
    group, uniforms, starOpacity,
    update(camera, time) {
      group.position.copy(camera.position);
      uniforms.uTime.value = time;
      starOpacity.value = Math.min(1, uniforms.uSpace.value * 1.4) * (1 - uniforms.uCloud.value);
      stars.visible = starOpacity.value > 0.003;
    },
    dispose() {
      dome.geometry.dispose(); domeMat.dispose(); sg.dispose(); starMat.dispose();
      group.removeFromParent();
    },
  };
}
