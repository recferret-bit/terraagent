import * as THREE from 'three';
import { tissue, type Tissue } from './shapes';

export interface HabitatShape {
  width: number; height: number; depth: number;
  mouthWidth: number; mouthHeight: number; tunnelDepth: number;
  front: number; kind: Tissue; seed: number;
}

/** Continuous mound/vault with a level, full-sized chamber and a solid rear wall.
 * The opening is part of the shell itself: no sphere or dark disk behind the lip. */
export function habitatVault(shape: HabitatShape): THREE.BufferGeometry {
  const { width, height, depth, mouthWidth, mouthHeight, tunnelDepth, front, seed } = shape;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const sides = 32;
  const ring = (w: number, h: number, z: number, floor: number, organic: boolean): number => {
    const start = positions.length / 3;
    for (let i = 0; i < sides; i++) {
      // A broad arch with upright lower walls leaves room for feet and high abdomens.
      const a = (i - 2) / (sides - 3) * Math.PI;
      let x = i === 0 ? -w / 2 : i === 1 ? w / 2 : Math.cos(a) * w / 2;
      const spring = organic && shape.kind === 4 ? 0.14 : 0.45;
      let y = i < 2 ? floor : floor + h * (spring + (1 - spring) * Math.sin(a));
      if (organic && i >= 2) {
        const fold = shape.kind === 2 ? Math.cos(a * 9 + z * 0.7) * 0.055
          : shape.kind === 1 ? Math.cos(z * 8 + a * 2) * 0.025 : Math.sin(a * 5 + z * 1.8 + seed) * 0.065;
        x *= 1 + fold;
        y *= 1 + fold * Math.sin(a);
        y += 0.055 * Math.sin(a * 3 + seed + z) * Math.sin(a);
      }
      positions.push(x, y, z); uv.push(i / sides, (front - z) / depth);
    }
    return start;
  };
  const join = (a: number, b: number, reverse = false) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const face = [a + i, b + i, a + j, a + j, b + i, b + j];
      indices.push(...(reverse ? face.reverse() : face));
    }
  };
  const cap = (r: number, z: number, reverse: boolean) => {
    const center = positions.length / 3;
    positions.push(0, height * 0.25, z); uv.push(0.5, 1);
    for (let i = 0; i < sides; i++) {
      const face = [center, r + i, r + (i + 1) % sides];
      indices.push(...(reverse ? face.reverse() : face));
    }
  };
  const contour = new THREE.CatmullRomCurve3([
    new THREE.Vector3(mouthWidth + (width - mouthWidth) * 0.36, mouthHeight + (height - mouthHeight) * 0.40, front),
    new THREE.Vector3(width, height, front - depth * 0.18),
    new THREE.Vector3(width * 0.97, height * 1.06, front - depth * 0.48),
    new THREE.Vector3(width * 0.78, height * 0.90, front - depth * 0.79),
    new THREE.Vector3(width * 0.32, height * 0.40, front - depth),
  ]);
  const outer = Array.from({ length: 11 }, (_, i) => {
    const section = contour.getPoint(i / 10);
    return ring(section.x, section.y, section.z, 0, true);
  });
  const inner = [0, 0.18, 0.55, 1].map(t => ring(mouthWidth, mouthHeight, front - tunnelDepth * t, 0.035, false));
  for (let i = 1; i < outer.length; i++) join(outer[i - 1], outer[i]);
  for (let i = 1; i < inner.length; i++) join(inner[i - 1], inner[i], true);
  join(outer[0], inner[0], true);
  cap(outer.at(-1)!, front - depth, true);
  cap(inner.at(-1)!, front - tunnelDepth, false);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return tissue(geometry, shape.kind);
}
