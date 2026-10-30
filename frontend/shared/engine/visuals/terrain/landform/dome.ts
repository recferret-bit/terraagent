import { smoothstep } from '../noise';
import type { LandformBuilder } from './types';

/** Inselberg: weathered rock dome. */
export const buildDome: LandformBuilder = ({ kind, x, z, scale, n, R, ph, local, erosion }) => {
const Rr = (8 + R() * 6) * scale, H = (6 + R() * 6) * scale, sq = 0.65 + R() * 0.35;
const reach = Rr / Math.min(1, sq) + 5;
return {
  kind, x, z, radius: reach,
  sample(px, pz, out) {
    const [lx, lz] = local(px, pz);
    const q = Math.hypot(lx / sq, lz) + erosion(px, pz, 1.4);
    if (q > Rr + 4) return false;
    const t = Math.min(1, q / Rr);
    let h = H * Math.pow(1 - t * t, 0.8);
    h -= 0.9 * n.ridged(px * 0.2 + ph, pz * 0.2, 2) * (1 - t) * (H / 10);   // exfoliation grooves
    out.h = Math.max(0, h); out.rock = smoothstep(1.0, 0.7, t);
    return true;
  },
};
};
