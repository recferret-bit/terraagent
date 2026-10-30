import * as THREE from 'three';

export const PEDESTAL_R = 6.3;

type Push = (arr: number[], x1: number, z1: number, x2: number, z2: number) => void;

/** Square 1 m / 5 m lines, clipped to the pedestal circle by skipping segments whose endpoints fall outside. */
function squareLines(push: Push, minor: number[], major: number[]) {
  const N = 6;
  for (let i = -N; i <= N; i++) {
    const arr = i % 5 === 0 ? major : minor;
    for (let s = -N; s < N; s++) { push(arr, i, s, i, s + 1); push(arr, s, i, s + 1, i); }
  }
}

/** 1 m (flat-to-flat) hex tiles plus the square 5 m lines. */
function hexLines(push: Push, minor: number[], major: number[]) {
  const s = 1 / Math.sqrt(3); // circumradius so flat-to-flat = 1m
  const w = 1, h = s * 1.5;
  for (let row = -9; row <= 9; row++) for (let col = -8; col <= 8; col++) {
    const cx = col * w + (row & 1 ? w / 2 : 0), cz = row * h;
    for (let k = 0; k < 6; k++) {
      const a1 = Math.PI / 6 + (k * Math.PI) / 3, a2 = a1 + Math.PI / 3;
      push(minor, cx + Math.cos(a1) * s, cz + Math.sin(a1) * s, cx + Math.cos(a2) * s, cz + Math.sin(a2) * s);
    }
  }
  for (let i = -5; i <= 5; i += 5) { push(major, i, -6, i, 6); push(major, -6, i, 6, i); }
}

const lines = (arr: number[], color: number, op: number) => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
  l.position.y = 0.003; return l;
};

/** Calibration grid (1 m + 5 m lines) with a 1 m orange ring at the origin. */
export function buildGrid(hex: boolean): THREE.Group {
  const group = new THREE.Group();
  const R = PEDESTAL_R - 0.05;
  const minor: number[] = [], major: number[] = [];
  const push: Push = (arr, x1, z1, x2, z2) => {
    if (x1 * x1 + z1 * z1 > R * R || x2 * x2 + z2 * z2 > R * R) return;
    arr.push(x1, 0, z1, x2, 0, z2);
  };
  (hex ? hexLines : squareLines)(push, minor, major);
  group.add(lines(minor, 0x8a93a6, 0.28), lines(major, 0x5b8cff, 0.85));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff6a13, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.y = 0.005; group.add(ring);
  return group;
}
