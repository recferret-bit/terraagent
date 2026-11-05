import * as THREE from 'three';
import type { V3 } from '../unitParts';

/** Tissue codes are shared by the biological surface shader and fauna validator. */
export type Tissue = 1 | 2 | 3 | 4 | 5;

class OrganicGeometry extends THREE.BufferGeometry { override readonly type = 'OrganicGeometry'; }

export function tissue(g: THREE.BufferGeometry, kind: Tissue): THREE.BufferGeometry {
  const source = g.index ? g.toNonIndexed() : g;
  const uv = source.attributes.uv;
  for (let i = 0; i < uv.count; i += 3) {
    const u = [uv.getX(i), uv.getX(i + 1), uv.getX(i + 2)];
    if (Math.max(...u) - Math.min(...u) > 0.5) {
      for (let j = 0; j < 3; j++) if (u[j] < 0.5) uv.setX(i + j, u[j] + 1);
    }
  }
  const count = source.attributes.position.count;
  source.setAttribute('aOrganic', new THREE.BufferAttribute(new Float32Array(count).fill(kind), 1));
  const organic = new OrganicGeometry().copy(source);
  if (source !== g) source.dispose();
  g.dispose();
  return organic;
}

/** Closed anatomical volume: unequal cross-sections and low-frequency growth, not box bevels. */
export function organ(size: V3, kind: Tissue = 1, seed = 0, ribs = 0, detail = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, detail, Math.max(4, Math.round(detail * 2 / 3)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Map along the body axis; unwrap seam triangles after conversion to non-indexed geometry.
    g.attributes.uv.setXY(i, Math.atan2(y, x) / (Math.PI * 2) + 0.5, (z + 1) / 2);
    const growth = 1 + 0.035 * Math.sin(z * 6 + seed) * Math.sin(y * 4 + 0.7);
    const band = 1 + ribs * Math.cos(z * 17 + seed) * (1 - z * z);
    p.setXYZ(i, x * size[0] * growth * band, y * size[1] * band, z * size[2]);
  }
  g.computeVertexNormals();
  return tissue(g, kind);
}

/** Closed, tapered curved appendage. Both ends have real caps for containment tests. */
export function tendril(points: V3[], radii: number[], kind: Tissue = 1, segments = 8, sides = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(segments, false);
  const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let j = 0; j <= segments; j++) {
    const t = j / segments, c = curve.getPoint(t), f = t * (radii.length - 1);
    const k = Math.min(Math.floor(f), radii.length - 2), radius = THREE.MathUtils.lerp(radii[k], radii[k + 1], f - k);
    for (let i = 0; i <= sides; i++) {
      const a = i / sides * Math.PI * 2;
      const v = c.clone().addScaledVector(frames.normals[j], Math.cos(a) * radius)
        .addScaledVector(frames.binormals[j], Math.sin(a) * radius);
      vertices.push(v.x, v.y, v.z); uv.push(i / sides, t);
      if (j < segments && i < sides) {
        const q = j * (sides + 1) + i, n = q + sides + 1;
        indices.push(q, n, q + 1, q + 1, n, n + 1);
      }
    }
  }
  for (const end of [0, segments]) {
    const c = curve.getPoint(end / segments), center = vertices.length / 3;
    vertices.push(c.x, c.y, c.z); uv.push(0.5, end / segments);
    for (let i = 0; i < sides; i++) {
      const q = end * (sides + 1) + i;
      if (end === 0) indices.push(center, q, q + 1); else indices.push(center, q + 1, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return tissue(g, kind);
}

/** Thick continuous shell around a burrow: open front and genuinely recessed closed back. */
export function burrow(width: number, height: number, depth: number, kind: Tissue = 4): THREE.BufferGeometry {
  const rings = [1, 1.04, 0.94, 0.72, 0.36, 0.025];
  const points: THREE.Vector2[] = rings.map((r, i) => new THREE.Vector2(r, i / (rings.length - 1) * depth));
  // Revolved lip + interior + exterior form a closed shell, with the far tip buried in the mound.
  const profile = [...points, ...points.slice().reverse().map(p => new THREE.Vector2(p.x + 0.17, p.y))];
  profile.push(profile[0].clone());
  const g = new THREE.LatheGeometry(profile, 18);
  g.rotateX(-Math.PI / 2);
  g.scale(width / 2, height / 2, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x * (1 + 0.025 * Math.sin(y * 19)), y + height / 2, z);
  }
  g.computeVertexNormals();
  return tissue(g, kind);
}

