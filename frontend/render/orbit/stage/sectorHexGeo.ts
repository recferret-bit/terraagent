import * as THREE from 'three';

function hexCornerNormal(cornerIdx: number, angularRadius: number): THREE.Vector3 {
  const phi = (cornerIdx * Math.PI) / 3 + Math.PI / 6;
  const sinA = Math.sin(angularRadius);
  return new THREE.Vector3(Math.cos(phi) * sinA, Math.cos(angularRadius), Math.sin(phi) * sinA).normalize();
}

function sampleHexPerimeter(
  sphereRadius: number,
  angularRadius: number,
  edgeSubdivisions: number,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    p0.copy(hexCornerNormal(i, angularRadius));
    p1.copy(hexCornerNormal((i + 1) % 6, angularRadius));
    for (let s = 0; s < edgeSubdivisions; s++) {
      const t = s / edgeSubdivisions;
      pts.push(new THREE.Vector3().lerpVectors(p0, p1, t).normalize().multiplyScalar(sphereRadius));
    }
  }
  return pts;
}

/**
 * Curved hexagonal boundary projected onto a sphere around `+Y` so every segment conforms to globe curvature.
 */
export function buildSphericalHexLoopGeo(
  sphereRadius: number,
  angularRadius: number,
  edgeSubdivisions = 5,
): THREE.BufferGeometry {
  const pts = sampleHexPerimeter(sphereRadius, angularRadius, edgeSubdivisions);
  const pos = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    pos[i * 3] = pts[i]!.x;
    pos[i * 3 + 1] = pts[i]!.y;
    pos[i * 3 + 2] = pts[i]!.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}

/**
 * Curved two-ring spherical hex cap around `+Y` for translucent surface fills without chord clipping.
 */
export function buildSphericalHexFillGeo(
  sphereRadius: number,
  angularRadius: number,
  edgeSubdivisions = 5,
): THREE.BufferGeometry {
  const midRing = sampleHexPerimeter(sphereRadius, angularRadius * 0.52, edgeSubdivisions);
  const outerRing = sampleHexPerimeter(sphereRadius, angularRadius, edgeSubdivisions);
  const n = outerRing.length;
  const tris: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const center = new THREE.Vector3(0, sphereRadius, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const m0 = midRing[i]!;
    const m1 = midRing[j]!;
    const o0 = outerRing[i]!;
    const o1 = outerRing[j]!;
    pushTri(center, m1, m0);
    pushTri(m0, m1, o1);
    pushTri(m0, o1, o0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  return geo;
}

function sphericalPoint(yaw: number, pitch: number, radius: number): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).multiplyScalar(radius);
}

/**
 * Subtle curved spherical coordinate scan grid anchored to the landing-sector patch.
 */
export function buildSphericalGridGeo(sphereRadius: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const pushSeg = (a: THREE.Vector3, b: THREE.Vector3) => {
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const yaws = [-0.56, -0.37, -0.18, 0, 0.18, 0.37, 0.56];
  const pitches = [-0.42, -0.21, 0, 0.21, 0.42];
  for (const yaw of yaws) {
    for (let i = 0; i < 16; i++) {
      const p0 = -0.44 + (0.88 * i) / 16;
      const p1 = -0.44 + (0.88 * (i + 1)) / 16;
      pushSeg(sphericalPoint(yaw, p0, sphereRadius), sphericalPoint(yaw, p1, sphereRadius));
    }
  }
  for (const pitch of pitches) {
    for (let i = 0; i < 18; i++) {
      const y0 = -0.58 + (1.16 * i) / 18;
      const y1 = -0.58 + (1.16 * (i + 1)) / 18;
      pushSeg(sphericalPoint(y0, pitch, sphereRadius), sphericalPoint(y1, pitch, sphereRadius));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}
