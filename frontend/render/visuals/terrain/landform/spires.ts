import { smoothstep } from '../noise';
import { lerp, smax, type LandformBuilder } from './types';

/** Hoodoo / spire cluster on a rubble mound. */
export const buildSpires: LandformBuilder = ({ kind, x, z, scale, n, R, ph, local }) => {
  const nCol = 3 + Math.floor(R() * 4);
  const spread = (5 + R() * 4) * scale;
  const cols = Array.from({ length: nCol }, (_, i) => {
    const a = R() * Math.PI * 2, r = i === 0 ? 0 : spread * (0.35 + R() * 0.65);
    return { cx: Math.cos(a) * r, cz: Math.sin(a) * r, r: (2.2 + R() * 1.4) * scale, h: (i === 0 ? 13 + R() * 6 : 6 + R() * 9) * scale };
  });
  const moundH = (2.5 + R() * 2.5) * scale, moundR = spread + 7 * scale;
  const reach = moundR + 3;
  return {
    kind, x, z, radius: reach,
    sample(px, pz, out) {
      const [lx, lz] = local(px, pz);
      const q0 = Math.hypot(lx, lz);
      if (q0 > reach) return false;
      const mt = Math.min(1, q0 / moundR);
      let h = moundH * Math.pow(1 - mt * mt, 1.6) + 0.4 * n.fbm(px * 0.3 + ph, pz * 0.3, 2) * (1 - mt);
      let rock = Math.pow(1 - mt, 1.8) * 0.7;
      for (const C of cols) {
        const q = Math.hypot(lx - C.cx, lz - C.cz) + 0.5 * n.fbm(px * 0.4 + ph + C.cx, pz * 0.4, 2);
        const wall = 1 - smoothstep(C.r - 1.1, C.r + 1.1, q);             // ≥ 2 m wide wall → no comb artefacts
        if (wall <= 0) continue;
        const cap = C.h * (1 - 0.18 * Math.pow(Math.min(1, q / C.r), 3));  // rounded hoodoo cap
        h = smax(h, lerp(h, cap, wall), 1.2);
        rock = Math.max(rock, smoothstep(0.05, 0.4, wall));
      }
      out.h = h; out.rock = rock;
      return true;
    },
  };
};
