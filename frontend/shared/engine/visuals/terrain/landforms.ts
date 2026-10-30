import type { Noise2 } from './noise';
import { rand, smax, type Landform, type LandformKind, type LandformCtx, type LandformBuilder } from './landform/types';
import { buildPlateau } from './landform/plateau';
import { buildSpires } from './landform/spires';
import { buildRidge } from './landform/ridge';
import { buildDome } from './landform/dome';

/**
 * Reusable procedural landform generator (heightfield "stamps").
 *
 * One algorithm, many shapes: every landform is an archetype (mesa, butte, hoodoo cluster, cuesta ridge, inselberg
 * dome) whose silhouette, proportions, footprint lobes, tilt, erosion and noise phase are all drawn from its own seed,
 * so no two are alike. `scatterLandforms` places them with a minimum spacing and deals archetypes from a shuffled
 * bag so neighbours never share an archetype. Every profile keeps walls ≥ ~2 m wide so a 0.6 m terrain grid can
 * resolve them without comb/stair artefacts, and none stacks a second body on top (no "two objects" look).
 */
export { smax };
export type { Landform, LandformKind, LandformSample } from './landform/types';

/** Archetype registry (strategy per kind). */
const BUILDERS: Record<LandformKind, LandformBuilder> = {
  mesa: buildPlateau, butte: buildPlateau, spires: buildSpires, ridge: buildRidge, dome: buildDome,
};

export function createLandform(kind: LandformKind, x: number, z: number, seed: number, n: Noise2, scale = 1): Landform {
  const R = rand(seed);
  const ph = R() * 500;                         // noise phase → unique erosion pattern per instance
  const rot = R() * Math.PI * 2, c = Math.cos(rot), s = Math.sin(rot);
  const local = (px: number, pz: number) => { const dx = px - x, dz = pz - z; return [dx * c - dz * s, dx * s + dz * c] as const; };
  const erosion = (px: number, pz: number, amp: number) =>
    amp * (1.6 * n.fbm(px * 0.085 + ph, pz * 0.085, 3) + 1.0 * n.ridged(px * 0.15 + ph, pz * 0.15 - ph, 2) - 0.6);
  const ctx: LandformCtx = { kind, x, z, scale, n, R, ph, local, erosion };
  return BUILDERS[kind](ctx);
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
