// Animation poses of a part, mirroring the vertex shader of UnifiedColonyMaterial.
import type { PartDef } from './types';

export interface Pose { label: string; tris: Float32Array }
export function poses(p: PartDef): Pose[] {
  const src = p.tris, out: Pose[] = [];
  const make = (label: string, f: (x: number, y: number, z: number, o: number, t: Float32Array) => void) => {
    const t = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) f(src[i], src[i + 1], src[i + 2], i, t);
    out.push({ label, tris: t });
  };
  const [px, , pz] = p.pivot;
  if (p.animType === 1) {
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI * 2) / 24, c = Math.cos(a), s = Math.sin(a);
      make(`${k * 15}° of its spin`, (x, y, z, i, t) => { const rx = x - px, rz = z - pz; t[i] = px + rx * c - rz * s; t[i + 1] = y; t[i + 2] = pz + rx * s + rz * c; });
    }
  } else if (p.animType === 2) {
    for (const dy of [-0.05, -0.025, 0.025, 0.05]) make(`${dy > 0 ? '+' : ''}${(dy * 100).toFixed(1)} cm bob`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y + dy; t[i + 2] = z; });
  } else if (p.animType === 3) {
    for (const dz of [-0.015, -0.03, -0.045, -0.06]) make(`${(dz * 100).toFixed(1)} cm recoil`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y; t[i + 2] = z + dz; });
  }
  return out;
}

