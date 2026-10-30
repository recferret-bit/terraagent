import { smin, type Lobe, type LandformBuilder } from './types';

/** Plateau family: mesa / butte (lobed footprint, fluted cliff, talus apron). */
export const buildPlateau: LandformBuilder = ({ kind, x, z, scale, n, R, ph, local, erosion }) => {
  const butte = kind === 'butte';
  const H = (butte ? 13 + R() * 7 : 8 + R() * 6) * scale;
  const baseR = (butte ? 4.2 + R() * 2.2 : 7 + R() * 5) * scale;
  const nLobes = butte ? 1 : 1 + Math.floor(R() * 3);
  const lobes: Lobe[] = Array.from({ length: nLobes }, (_, i) => ({
    ox: i === 0 ? 0 : (R() - 0.5) * baseR * 1.3, oz: i === 0 ? 0 : (R() - 0.5) * baseR * 1.3,
    r: baseR * (i === 0 ? 1 : 0.5 + R() * 0.45), ax: 0.55 + R() * 0.45, rot: R() * Math.PI,
  }));
  const tiltX = (R() - 0.5) * 0.12, tiltZ = (R() - 0.5) * 0.12;   // gently tilted caprock
  const dome = R() * 0.08;
  const cliffW = (butte ? 2.4 : 2.6) + H * 0.12, talusW = 3 + H * (butte ? 0.95 : 0.7);
  const flute = 0.5 + R() * 0.8, fluteF = 0.45 + R() * 0.35;
  const reach = baseR * 1.9 + cliffW + talusW + 4;
  return {
    kind, x, z, radius: reach,
    sample(px, pz, out) {
      const [lx, lz] = local(px, pz);
      if (lx * lx + lz * lz > reach * reach) return false;
      let d = 1e9;
      for (const L of lobes) {
        const cx = lx - L.ox, cz = lz - L.oz, cr = Math.cos(L.rot), sr = Math.sin(L.rot);
        const ex = (cx * cr - cz * sr) / L.ax, ez = cx * sr + cz * cr;
        d = smin(d, (Math.hypot(ex, ez) - L.r) * Math.min(1, L.ax + 0.25), 4);
      }
      d += erosion(px, pz, 1.1);
      const ang = Math.atan2(lz, lx);                                     // vertical buttresses & gullies
      d += flute * (n.ridged(Math.cos(ang) * baseR * fluteF + ph, Math.sin(ang) * baseR * fluteF, 2) - 0.5);
      if (d > cliffW + talusW) return false;
      const top = H * (1 + tiltX * lx / baseR + tiltZ * lz / baseR) - H * dome * (lx * lx + lz * lz) / (baseR * baseR) + 0.3 * n.fbm(px * 0.2 + ph, pz * 0.2, 2);
      if (d <= 0) { out.h = top; out.rock = 1; }
      else if (d <= cliffW) {
        const t = d / cliffW, sm = t * t * (3 - 2 * t);
        out.h = top * (1 - 0.7 * sm); out.rock = 1;                       // smooth cliff, rounded caprock lip
      } else {
        const t = (d - cliffW) / talusW;
        out.h = top * 0.3 * Math.pow(1 - t, 2.2); out.rock = Math.pow(1 - t, 2.2);
      }
      return true;
    },
  };
};
