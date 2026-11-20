import * as THREE from 'three';
import {
  buildTrailFragment, TRAIL_CORE_FRAG, TRAIL_SPARK_FRAG, TRAIL_SPARK_VERT, TRAIL_VERT,
} from './plasmaTrailGlsl';

/** Trail length (m, descent world units): longer than the pod's own sheath so it reads as a streak across the sky. */
export const TRAIL_LENGTH = 34;

export interface PlasmaTrail {
  readonly group: THREE.Group;
  readonly u: { uI: THREE.IUniform<number>; uTime: THREE.IUniform<number> };
  dispose(): void;
}

/**
 * Tier 2+ Plasma Drop-Pod re-entry trail: a hollow cyan-violet sheath with scrolling lanes, a hot core thread and shed
 * sparks, alpha-blended sheath and core, additive sparks, all HDR. Built beside the pod's own orange plasma (it extends the descent, never replaces it).
 * Local space: pod centre at the origin, trail along +y. The caller sets `group.position` and `u.uI` each frame.
 */
export function createPlasmaTrail(podRadius: number, podHeight: number): PlasmaTrail {
  const group = new THREE.Group();
  group.name = 'prestige:plasmaTrail';
  group.visible = false;
  const u = { uI: { value: 0 }, uTime: { value: 0 } };
  const base = -podHeight * 0.5;
  const R = podRadius * 1.05;
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mat = (frag: string, seed: number, extra: Record<string, THREE.IUniform> = {}) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        ...u, uLen: { value: TRAIL_LENGTH }, uSeed: { value: seed },
        uHot: { value: new THREE.Color(0.1, 1.3, 1.7) }, uCool: { value: new THREE.Color(0.55, 0.18, 1.3) }, ...extra,
      },
      vertexShader: TRAIL_VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide, fog: false,
    });
    mats.push(m);
    return m;
  };
  const cone = (r0: number, r1: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, TRAIL_LENGTH, 28, 14, true).translate(0, base + TRAIL_LENGTH / 2, 0);
    geos.push(g);
    return g;
  };
  const sheath = new THREE.Mesh(cone(R * 1.1, R * 0.1), mat(buildTrailFragment(), 0.4));
  const core = new THREE.Mesh(cone(R * 0.2, R * 0.02), mat(TRAIL_CORE_FRAG, 1.1));
  for (const [m, order] of [[sheath, 27], [core, 28]] as const) { m.frustumCulled = false; m.renderOrder = order; group.add(m); }

  const n = 220;
  const seed = new Float32Array(n * 4);
  let h = 7771;
  const rnd = () => ((h = (h * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geos.push(sg);
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {
      ...u, uLen: { value: TRAIL_LENGTH }, uR: { value: R * 1.2 },
      uScale: { value: typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio, 2) },
      uHot: { value: new THREE.Color(0.1, 1.3, 1.7) }, uCool: { value: new THREE.Color(0.55, 0.18, 1.3) },
    },
    vertexShader: TRAIL_SPARK_VERT, fragmentShader: TRAIL_SPARK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  mats.push(sparkMat);
  const sparks = new THREE.Points(sg, sparkMat);
  sparks.frustumCulled = false; sparks.renderOrder = 29;
  group.add(sparks);

  return { group, u, dispose() { group.removeFromParent(); geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); } };
}
