import * as THREE from 'three';
import type { ParallaxCtx, ParallaxPart } from './types';

interface Rock { x: number; y: number; z: number; s: number; vx: number; lim: number; s0: number; rx: number; ry: number; ax: number; ay: number }

const COUNT = 42;

function lumpyRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + 0.28 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7); p.setXYZ(i, v.x * n, v.y * n, v.z * n); }
  geo.computeVertexNormals();
  return geo;
}

/** Mid-depth asteroid drift, lit by the stage's lights. */
export function createAsteroids(ctx: ParallaxCtx): ParallaxPart {
  const { rnd, halfTan, camDist } = ctx;
  const rockGeo = lumpyRockGeometry();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6a66, roughness: 0.95, metalness: 0.05 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, COUNT);
  // Asteroids drift forever: they travel just past the widest possible view edge, shrink to nothing at both ends
  // (so there is never a visible pop), then respawn on the far side with new height/size/speed.
  const spawn = (r: Rock, first: boolean) => {
    r.z = -40 + rnd() * 75;
    r.lim = halfTan * (camDist - r.z) * 2.6 * 1.3;           // beyond a 2.6:1 ultrawide view + camera parallax
    r.x = first ? (rnd() * 2 - 1) * r.lim : -r.lim;
    r.y = (rnd() * 2 - 1) * halfTan * (camDist - r.z) * 0.95;
    r.s0 = 0.04 + Math.pow(rnd(), 2.4) * 0.2; r.vx = 0.15 + rnd() * 0.5;
    r.rx = rnd() * 6; r.ry = rnd() * 6; r.ax = rnd() - 0.5; r.ay = rnd() - 0.5;
  };
  const rd = Array.from({ length: COUNT }, () => { const r = { x: 0, y: 0, z: 0, s: 1, vx: 0, lim: 1, s0: 0.1, rx: 0, ry: 0, ax: 0, ay: 0 }; spawn(r, true); return r; });
  rocks.frustumCulled = false; ctx.group.add(rocks);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  return {
    update(dt, time) {
      for (let i = 0; i < COUNT; i++) {
        const r = rd[i]; r.x += r.vx * dt; if (r.x > r.lim) spawn(r, false);
        r.s = r.s0 * THREE.MathUtils.smoothstep(r.lim - Math.abs(r.x), 0, r.lim * 0.14);
        e.set(r.rx + time * r.ax * 0.6, r.ry + time * r.ay * 0.6, 0); q.setFromEuler(e);
        m4.compose(pv.set(r.x, r.y, r.z), q, sv.setScalar(r.s)); rocks.setMatrixAt(i, m4);
      }
      rocks.instanceMatrix.needsUpdate = true;
    },
    dispose() { rockGeo.dispose(); rockMat.dispose(); rocks.dispose(); },
  };
}
