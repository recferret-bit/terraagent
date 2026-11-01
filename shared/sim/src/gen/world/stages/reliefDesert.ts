import { TILE_M, type WorldGenContext, type WorldStage } from '../context';
import { fbm2d, hash2d, ridged2d, smoothstep } from '../noise';

/** A rock landform stamped onto the relief (mesa = flat top + cliffs, butte = small and tall, dome = rounded). */
interface Landform {
  x: number; // centre, metres
  y: number;
  radius: number; // tiles
  heightM: number;
  kind: 'mesa' | 'butte' | 'dome';
  seed: number;
}

/** Per-sector landform centres: each sector rolls its own stream, so sectors never depend on each other. */
function placeLandforms(ctx: WorldGenContext): Landform[] {
  const chance = ctx.num('mesaChancePerSector', 0.16);
  const rMin = ctx.num('mesaRadiusMin', 3), rMax = ctx.num('mesaRadiusMax', 7);
  const hMin = ctx.num('mesaHeightMinM', 4.5), hMax = ctx.num('mesaHeightMaxM', 9);
  const out: Landform[] = [];
  for (const s of ctx.sectors.sectors) {
    const seed = ctx.seed('landform', s.id);
    if (hash2d(s.sq, s.sr, seed) >= chance) continue;
    const pick = s.tiles[Math.floor(hash2d(1, 7, seed) * s.tiles.length)];
    const roll = hash2d(3, 5, seed);
    const kind = roll < 0.55 ? 'mesa' : roll < 0.8 ? 'butte' : 'dome';
    const radius = kind === 'butte' ? rMin : rMin + hash2d(9, 2, seed) * (rMax - rMin);
    const heightM = hMin + hash2d(4, 4, seed) * (hMax - hMin) * (kind === 'butte' ? 1.25 : 1);
    out.push({ x: ctx.mx[pick], y: ctx.my[pick], radius, heightM, kind, seed });
  }
  return out;
}

function landformHeight(f: Landform, mx: number, my: number): number {
  const d = Math.hypot(mx - f.x, my - f.y) / TILE_M; // round footprints, in tiles
  const wobble = 0.8 * (fbm2d(mx, my, 0.09, f.seed) - 0.5);
  const t = (d + wobble) / f.radius;
  if (t >= 1.25) return 0;
  if (f.kind === 'dome') return f.heightM * Math.max(0, 1 - t * t);
  // Plateau: flat top, steep cliff band, short scree apron.
  const top = 1 - smoothstep(0.78, 1.02, t);
  const apron = 0.18 * (1 - smoothstep(1.0, 1.25, t));
  return f.heightM * Math.max(top, apron);
}

/**
 * Desert relief in metres (D-38): wind-aligned dune seas (erg) over gravel plains (reg), ridged mountain ranges, and
 * mesas / buttes / domes stamped per sector. Writes `height` and the scratch field `rockiness` (0..1, exposed rock).
 */
export const reliefDesert: WorldStage = {
  id: 'reliefDesert',
  run(ctx) {
    const height = ctx.state.grid.layers.height as Float32Array;
    const rockiness = ctx.field('rockiness');
    const seedErg = ctx.seed('erg'), seedDune = ctx.seed('dune'), seedWarp = ctx.seed('warp');
    const seedRange = ctx.seed('range'), seedRidge = ctx.seed('ridge'), seedPlain = ctx.seed('plain');
    const ang = hash2d(11, 13, ctx.seed('wind')) * Math.PI;
    const wx = Math.cos(ang), wy = Math.sin(ang);
    const ergScale = ctx.num('ergScale', 0.006), duneH = ctx.num('duneHeightM', 4.2);
    const waveM = ctx.num('duneWavelengthM', 16), crossS = ctx.num('duneCrossScale', 0.018);
    const rangeS = ctx.num('rangeScale', 0.0045), rangeT = ctx.num('rangeThreshold', 0.6), rangeH = ctx.num('rangeHeightM', 16);
    const forms = placeLandforms(ctx);
    for (const s of ctx.sectors.sectors) {
      // Landforms that can reach this sector (quadtree query around the sector block).
      const i0 = s.tiles[0];
      const reach = (ctx.sectors.size * 1.5 + 12) * TILE_M;
      const local = forms.filter((f) => Math.abs(f.x - ctx.mx[i0]) <= reach && Math.abs(f.y - ctx.my[i0]) <= reach);
      for (const i of s.tiles) {
        const x = ctx.mx[i], y = ctx.my[i];
        const erg = smoothstep(0.34, 0.52, fbm2d(x, y, ergScale, seedErg));
        // Transverse dunes: a periodic crest line across the wind, wavelength `duneWavelengthM`, bent by a warp field,
        // with a gentle windward slope and a steep slip face (skewed sine), heights varying along the crest.
        const u = x * wx + y * wy, v = -x * wy + y * wx;
        const warp = (fbm2d(x, y, 0.016, seedWarp) - 0.5) * 24;
        const phase = ((u + warp) / waveM) % 1;
        const t01 = phase < 0 ? phase + 1 : phase;
        const skew = t01 < 0.72 ? t01 / 0.72 : 1 - (t01 - 0.72) / 0.28; // windward 72 %, slip face 28 %
        const crest = skew * skew * (3 - 2 * skew);
        const along = 0.5 + 0.5 * fbm2d(v, u * 0.25, crossS, seedDune);
        const dunes = duneH * crest * along + 0.6 * fbm2d(x, y, 0.02, seedPlain);
        const plain = 0.45 * fbm2d(x, y, 0.03, seedPlain);
        let h = erg * dunes + (1 - erg) * plain;
        // Mountain ranges: ridge lines of low-frequency ridged noise, only inside the range belt mask.
        const belt = smoothstep(0.5, 0.62, fbm2d(x, y, rangeS, seedRange));
        const ridge = smoothstep(rangeT, 0.985, ridged2d(x, y, rangeS * 2.4, seedRidge));
        const mountain = rangeH * belt * ridge * (0.55 + 0.45 * fbm2d(x, y, 0.05, seedRidge));
        let rock = smoothstep(2.5, 4, mountain);
        h = Math.max(h, mountain);
        for (const f of local) {
          const lh = landformHeight(f, x, y);
          if (lh > h) h = lh;
          if (lh > 1.2) rock = Math.max(rock, smoothstep(1.2, 2.4, lh));
        }
        height[i] = Math.fround(h);
        rockiness[i] = Math.fround(rock);
      }
    }
  },
};
