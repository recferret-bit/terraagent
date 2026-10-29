import type { PlanetSpec } from '../../planets/PlanetSpec';
import { Noise2, mulberry32, smoothstep, mix } from './noise';

export interface LiquidInfo { level: number; kind: 'water' }
export interface HeightField {
  height(x: number, z: number): number;
  liquid: LiquidInfo | null;
  /** wind direction (unit, xz) used by dune shading/particles */
  wind: [number, number];
}

/** Smooth max against a floor: never goes below `f`, identity well above it. */
function floorMax(h: number, f: number, k = 1.2): number {
  const d = h - f;
  if (d >= k) return h;
  if (d <= -k) return f;
  return f + (d + k) * (d + k) / (4 * k);
}

/** Terrain height function per planet kind. Includes landing-site flattening and outer edge fade. */
export function createHeightField(spec: PlanetSpec, extent: number): HeightField {
  const n = new Noise2(spec.seed);
  const rng = mulberry32(spec.seed * 7 + 1);
  const ang = rng() * Math.PI;
  const wind: [number, number] = [Math.cos(ang), Math.sin(ang)];

  let raw: (x: number, z: number) => number;
  let liquid: LiquidInfo | null = null;
  let edgeY = 0;

  const place = (minR: number, maxR: number) => {
    const a = rng() * Math.PI * 2, r = minR + rng() * (maxR - minR);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };

  switch (spec.kind) {
    case 'dune': {
      edgeY = 0.8;
      const mesas = Array.from({ length: 6 }, (_, i) => {
        const p = place(24 + (i % 3) * 9, 56);
        return { ...p, r: 4.5 + rng() * 4.5, h: 5 + rng() * 6 };
      });
      raw = (x, z) => {
        const u = x * wind[0] + z * wind[1], v = -x * wind[1] + z * wind[0];
        const warp = n.fbm(x * 0.016 + 11, z * 0.016, 3) * 14;
        const sabs = (q: number) => Math.sqrt(q * q + 0.06) - 0.2449;
        const R = 1 - sabs(n.n(u * 0.065 + warp * 0.07, v * 0.019 + 3.7));
        let h = 4.3 * Math.pow(R, 1.8) + 2.2 * n.fbm(x * 0.013, z * 0.013, 3);
        h += 0.5 * Math.pow(1 - sabs(n.n(u * 0.13 + warp * 0.1, v * 0.045 + 9)), 3);
        for (const m of mesas) {
          const dx = x - m.x, dz = z - m.z;
          const dd = Math.hypot(dx, dz) / (m.r * (1 + 0.22 * n.n(x * 0.07, z * 0.07)));
          if (dd > 1.9) continue;
          const top = m.h + 0.35 * n.fbm(x * 0.25, z * 0.25, 2) + h * 0.12;
          h += (1 - smoothstep(1.0, 1.9, dd)) * m.h * 0.22;
          h = mix(h, top, 1 - smoothstep(0.78, 1.0, dd));
        }
        return h;
      };
      break;
    }
    case 'oceanForest': {
      edgeY = -2.4;
      liquid = { level: -1.0, kind: 'water' };
      raw = (x, z) => {
        const r = Math.hypot(x, z);
        let h = 11 * n.fbm(x * 0.025 + 3, z * 0.025, 4) + 1.0 + 5.0 * Math.exp(-((r / 22) ** 2));
        h += 0.5 * n.fbm(x * 0.09, z * 0.09, 2);
        if (h < -1.0) h = -1.0 + (h + 1.0) * 0.55;
        return Math.max(h, -5.5);
      };
      break;
    }
    case 'forestRock': {
      edgeY = 2.5;
      const pond = place(24, 32);
      liquid = { level: -0.85, kind: 'water' };
      raw = (x, z) => {
        let h = 4.2 * n.fbm(x * 0.026, z * 0.026, 4) + 1.2 * n.fbm(x * 0.09, z * 0.07, 2) + 1.2;
        const pl = n.fbm(x * 0.03 + 40, z * 0.03 - 12, 3);
        h += smoothstep(0.02, 0.1, pl) * 5.5 + smoothstep(0.26, 0.34, pl) * 3.5;
        h += 0.35 * n.n(x * 0.3, z * 0.3) * smoothstep(0.02, 0.1, pl);
        h = floorMax(h, 0.1, 1.0);
        const d = Math.hypot(x - pond.x, z - pond.z);
        const bowl = 1 - smoothstep(2, 9.5, d);
        h = mix(h, -1.9, bowl * bowl * (3 - 2 * bowl));
        return h;
      };
      break;
    }
  }

  const height = (x: number, z: number) => {
    let h = raw(x, z);
    const r = Math.hypot(x, z);
    h = mix(h, 0, 1 - smoothstep(9, 22, r)); // landing site: flat at y = 0
    const e = smoothstep(extent * 0.55, extent * 0.98, Math.max(Math.abs(x), Math.abs(z)));
    return mix(h, edgeY, e);
  };
  return { height, liquid, wind };
}
