import { Noise2, smoothstep } from './noise';

/**
 * Reusable procedural landform generator (heightfield "stamps").
 *
 * One algorithm, many shapes: every landform is an archetype (mesa, butte, hoodoo cluster, cuesta ridge, inselberg
 * dome) whose silhouette, proportions, footprint lobes, tilt, erosion and noise phase are all drawn from its own seed,
 * so no two are alike. `scatterLandforms` places them with a minimum spacing and deals archetypes from a shuffled
 * bag so neighbours never share an archetype. Every profile keeps walls ≥ ~2 m wide so a 0.6 m terrain grid can
 * resolve them without comb/stair artefacts, and none stacks a second body on top (no "two objects" look).
 */
export type LandformKind = 'mesa' | 'butte' | 'spires' | 'ridge' | 'dome';

export interface LandformSample { h: number; rock: number }
export interface Landform {
  kind: LandformKind;
  x: number; z: number;
  /** Max influence radius (m). */
  radius: number;
  /** Writes height (m, absolute) + bedrock mask into `out`; returns false when (x, z) is outside the footprint. */
  sample(x: number, z: number, out: LandformSample): boolean;
}

const rand = (seed: number) => {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Polynomial smooth-min (union of distance fields with a soft seam of width k). */
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
/** Polynomial smooth-max. */
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

interface Lobe { ox: number; oz: number; r: number; ax: number; rot: number }

export function createLandform(kind: LandformKind, x: number, z: number, seed: number, n: Noise2, scale = 1): Landform {
  const R = rand(seed);
  const ph = R() * 500;                         // noise phase → unique erosion pattern per instance
  const rot = R() * Math.PI * 2, c = Math.cos(rot), s = Math.sin(rot);
  const local = (px: number, pz: number) => { const dx = px - x, dz = pz - z; return [dx * c - dz * s, dx * s + dz * c] as const; };
  const erosion = (px: number, pz: number, amp: number) =>
    amp * (1.6 * n.fbm(px * 0.085 + ph, pz * 0.085, 3) + 1.0 * n.ridged(px * 0.15 + ph, pz * 0.15 - ph, 2) - 0.6);

  // ---------------------------------------------------------------- plateau family (mesa / butte)
  if (kind === 'mesa' || kind === 'butte') {
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
  }

  // ---------------------------------------------------------------- hoodoo / spire cluster on a rubble mound
  if (kind === 'spires') {
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
  }

  // ---------------------------------------------------------------- cuesta ridge: steep scarp, long dip slope
  if (kind === 'ridge') {
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
  }

  // ---------------------------------------------------------------- inselberg: weathered rock dome
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
}

/**
 * Place `count` landforms in an annulus with a minimum spacing, dealing archetypes from a shuffled weighted bag so
 * adjacent landforms differ. Deterministic from `seed`.
 */
export function scatterLandforms(opts: {
  seed: number; noise: Noise2; count: number; minR: number; maxR: number; spacing: number;
  kinds: [LandformKind, number][]; scale?: number;
}): Landform[] {
  const R = rand(opts.seed);
  const bag: LandformKind[] = [];
  for (const [k, w] of opts.kinds) for (let i = 0; i < w; i++) bag.push(k);
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  const out: Landform[] = [];
  let tries = 0, bi = 0;
  while (out.length < opts.count && tries++ < 400) {
    const a = R() * Math.PI * 2, r = opts.minR + Math.sqrt(R()) * (opts.maxR - opts.minR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < opts.spacing)) continue;
    let kind = bag[bi++ % bag.length];
    // never the same archetype as the nearest already-placed neighbour
    const near = out.reduce<Landform | null>((m, o) => (!m || Math.hypot(o.x - x, o.z - z) < Math.hypot(m.x - x, m.z - z) ? o : m), null);
    if (near && near.kind === kind) kind = bag[bi++ % bag.length];
    out.push(createLandform(kind, x, z, opts.seed * 31 + out.length * 977 + 13, opts.noise, opts.scale ?? 1));
  }
  return out;
}
