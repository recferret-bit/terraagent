import { smoothstep } from '../noise';
import type { LandformBuilder } from './types';

/** Cuesta ridge: steep scarp, long dip slope. */
export const buildRidge: LandformBuilder = ({ kind, x, z, scale, n, R, ph, local, erosion }) => {
  const L = (28 + R() * 18) * scale, H = (7 + R() * 6) * scale;
  const dipW = (9 + R() * 6) * scale, scarpW = (2.6 + R() * 1.2) * scale, talusW = (4 + R() * 3) * scale;
  const bend = (R() - 0.5) * 0.04;
  const reach = L * 0.5 + dipW + scarpW + talusW + 4;
  return {
    kind, x, z, radius: reach,
    sample(px, pz, out) {
      const [lu, lv0] = local(px, pz);
      if (Math.abs(lu) > L * 0.5 + 6 || lv0 < -dipW - 4 || lv0 > scarpW + talusW + 4) return false;
      const lv = lv0 - bend * lu * lu + erosion(px, pz, 0.9);              // gently curved, eroded crest line
      const taper = smoothstep(L * 0.5 + 2, L * 0.5 - 9, Math.abs(lu));
      const crest = H * taper * (1 + 0.18 * n.fbm(lu * 0.08 + ph, 3.3, 2));
      let h: number, rock: number;
      if (lv < -dipW) return false;
      if (lv <= 0) {                                                       // dip slope with gullies
        const t = 1 + lv / dipW;
        h = crest * Math.pow(t, 1.35) - 0.8 * n.ridged(px * 0.22 + ph, pz * 0.22, 2) * t * taper;
        rock = 0.45 + 0.4 * t;
      } else if (lv <= scarpW) {
        const t = lv / scarpW;
        h = crest * (1 - 0.72 * t * t * (3 - 2 * t)); rock = 1;
      } else {
        const t = Math.min(1, (lv - scarpW) / talusW);
        h = crest * 0.28 * Math.pow(1 - t, 2.2); rock = Math.pow(1 - t, 2.2);
      }
      out.h = Math.max(0, h); out.rock = rock * taper;
      return true;
    },
  };
};
