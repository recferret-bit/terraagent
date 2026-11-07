import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function smooth(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  result.computeBoundingSphere();
  return result;
}

export function liquidGlobGeometry(): THREE.BufferGeometry {
  return smooth(new THREE.SphereGeometry(0.5, 8, 6));
}

/** Rounded drop with a taper along local +Z; velocity alignment stretches it in flight. */
export function liquidDropGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.5, 8, 5);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const taper = 0.75 - y * 0.5;
    position.setXYZ(i, position.getX(i) * taper, y * 1.35, position.getZ(i) * taper);
  }
  geometry.computeVertexNormals();
  geometry.rotateX(Math.PI / 2);
  return smooth(geometry);
}

export function liquidFilamentGeometry(): THREE.BufferGeometry {
  const profile = [[0, -0.6], [0.11, -0.47], [0.15, -0.3], [0.08, 0.1], [0.035, 0.48], [0, 0.65]];
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 6);
  geometry.rotateX(Math.PI / 2);
  return smooth(geometry);
}

/** Closed, irregular volume: seven thin tongues and a rounded central liquid lens, not a flat ring. */
export function liquidCrownGeometry(): THREE.BufferGeometry {
  const lens = new THREE.SphereGeometry(0.33, 8, 4);
  lens.scale(1, 1, 0.17);
  lens.translate(0, 0, 0.06);
  const parts = [smooth(lens)];
  for (let i = 0; i < 7; i++) {
    const theta = i / 7 * Math.PI * 2;
    const radius = 0.44 + 0.05 * Math.sin(i * 2.1);
    const point = (r: number, z: number) => new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, z);
    const curve = new THREE.CatmullRomCurve3([point(0.12, 0.05), point(0.3, 0.13), point(radius, 0.27), point(radius + 0.05, 0.22)]);
    const tongue = new THREE.TubeGeometry(curve, 4, 0.025 + i % 2 * 0.008, 4, false);
    const tip = new THREE.SphereGeometry(0.045, 5, 3);
    tip.translate(...point(radius + 0.05, 0.22).toArray());
    parts.push(smooth(tongue), smooth(tip));
  }
  const result = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return smooth(result);
}
