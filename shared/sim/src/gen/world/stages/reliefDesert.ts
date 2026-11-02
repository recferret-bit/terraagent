import { TILE_M, type WorldGenContext, type WorldStage } from '../context';
import { fbm2d, hash2d, ridged2d, smoothstep } from '../noise';

/** 16 wind directions over a half turn (dunes are symmetric under a 180° flip), pre-rounded to float32. */
const WIND_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0.98078528, 0.19509032], [0.92387953, 0.38268343], [0.83146961, 0.55557023],
  [0.70710678, 0.70710678], [0.55557023, 0.83146961], [0.38268343, 0.92387953], [0.19509032, 0.98078528],
  [0, 1], [-0.19509032, 0.98078528], [-0.38268343, 0.92387953], [-0.55557023, 0.83146961],
  [-0.70710678, 0.70710678], [-0.83146961, 0.55557023], [-0.92387953, 0.38268343], [-0.98078528, 0.19509032],
].map(([x, y]) => [Math.fround(x), Math.fround(y)] as const);

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
  const chance = ctx.num('mesaChancePerSector', 0.06);
  const rMin = ctx.num('mesaRadiusMin', 3.5), rMax = ctx.num('mesaRadiusMax', 6.5);
  const hMin = ctx.num('mesaHeightMinM', 6), hMax = ctx.num('mesaHeightMaxM', 11);
  const spawnRing = ctx.num('spawnRingRadius', 32);
  const out: Landform[] = [];
  for (const s of ctx.sectors.sectors) {
    const seed = ctx.seed('landform', s.id);
    if (hash2d(s.sq, s.sr, seed) >= chance) continue;
    const pick = s.tiles[Math.floor(hash2d(1, 7, seed) * s.tiles.length)];
    const mx = ctx.mx[pick], my = ctx.my[pick];
    const ringDist = Math.sqrt(mx * mx + my * my) / TILE_M;
    if (Math.abs(ringDist - spawnRing) < 8.5) continue; // keep the spawn ring in open dunes, not inside a mesa
    const roll = hash2d(3, 5, seed);
    const kind = roll < 0.55 ? 'mesa' : roll < 0.8 ? 'butte' : 'dome';
    const radius = kind === 'butte' ? rMin : rMin + hash2d(9, 2, seed) * (rMax - rMin);
    const heightM = hMin + hash2d(4, 4, seed) * (hMax - hMin) * (kind === 'butte' ? 1.25 : 1);
    out.push({ x: mx, y: my, radius, heightM, kind, seed });
  }
  return out;
}

function landformHeight(f: Landform, mx: number, my: number): number {
  const dx = mx - f.x, dy = my - f.y;
  const d = Math.sqrt(dx * dx + dy * dy) / TILE_M; // round footprints, in tiles (sqrt: correctly rounded everywhere)
  const wobble = 0.8 * (fbm2d(mx, my, 0.09, f.seed) - 0.5);
  const t = (d + wobble) / f.radius;
  if (t >= 1.25) return 0;
  if (f.kind === 'dome') return f.heightM * Math.max(0, 1 - t * t);
  // Plateau: flat top, steep cliff band, short scree apron.
  const top = 1 - smoothstep(0.78, 1.02, t);
  const apron = 0.18 * (1 - smoothstep(1.0, 1.25, t));
  return f.heightM * Math.max(top, apron);
}

/** Asymmetric wind-carved dune ridge wave (0..1): convex windward slope meeting a steeper leeward slip face at a crisp crest. */
function duneWave(coord: number, wavelengthM: number): number {
  const phase = (coord / wavelengthM) % 1;
  const t01 = phase < 0 ? phase + 1 : phase;
  const w = t01 < 0.7 ? t01 / 0.7 : (1 - t01) / 0.3;
  return w * (0.25 + 0.75 * w);
}

/**
 * Desert relief in metres (D-38): continuous pre-W1 wind-carved dune sea (primary transverse ridges + secondary
 * oblique barchan ripples), sandstone ridge outcrops, and mesas / buttes / domes stamped per sector. Writes `height`
 * and the scratch field `rockiness` (0..1, exposed rock; sand dunes stay 0).
 */
export const reliefDesert: WorldStage = {
  id: 'reliefDesert',
  run(ctx) {
    const height = ctx.state.grid.layers.height as Float32Array;
    const rockiness = ctx.field('rockiness');
    const seedErg = ctx.seed('erg'), seedDune = ctx.seed('dune'), seedWarp = ctx.seed('warp');
    const seedRange = ctx.seed('range'), seedRidge = ctx.seed('ridge');
    // Wind from a fixed table of unit vectors (no sin/cos: those may differ by an ulp between JS engines).
    const [wx, wy] = WIND_DIRS[Math.floor(hash2d(11, 13, ctx.seed('wind')) * WIND_DIRS.length)];
    const ergScale = ctx.num('ergScale', 0.012), duneH = ctx.num('duneHeightM', 5.2);
    const waveM = ctx.num('duneWavelengthM', 15), crossS = ctx.num('duneCrossScale', 0.018);
    const rangeS = ctx.num('rangeScale', 0.0045), rangeT = ctx.num('rangeThreshold', 0.91), rangeH = ctx.num('rangeHeightM', 12);
    const spawnRing = ctx.num('spawnRingRadius', 32);
    const forms = placeLandforms(ctx);
    for (const s of ctx.sectors.sectors) {
      // Landforms that can reach this sector (quadtree query around the sector block).
      const i0 = s.tiles[0];
      const reach = (ctx.sectors.size * 1.5 + 12) * TILE_M;
      const local = forms.filter((f) => Math.abs(f.x - ctx.mx[i0]) <= reach && Math.abs(f.y - ctx.my[i0]) <= reach);
      for (const i of s.tiles) {
        const x = ctx.mx[i], y = ctx.my[i];
        // Continuous dune sea (pre-W1 heightfields.ts look): wind-aligned primary ridges + oblique secondary ripples.
        const u = x * wx + y * wy, v = -x * wy + y * wx;
        const warp = (fbm2d(x, y, 0.015, seedWarp) - 0.5) * 32;
        const d1 = duneWave(u + warp, waveM);
        const d2 = duneWave(u * 0.7 - v * 0.5 + warp * 0.6, waveM * 0.62);
        const env = (0.72 + 0.28 * fbm2d(x, y, ergScale, seedErg)) * (0.78 + 0.22 * fbm2d(v, u * 0.25, crossS, seedDune));
        const duneBase = (d1 * duneH + d2 * (duneH * 0.32)) * env;
        // Sandstone mountain crags: narrow ridged outcrops inside the range belt mask, kept clear of the spawn ring.
        const ringDist = Math.sqrt(x * x + y * y) / TILE_M;
        const spawnClear = smoothstep(5, 10, Math.abs(ringDist - spawnRing));
        const belt = smoothstep(0.55, 0.69, fbm2d(x, y, rangeS, seedRange)) * spawnClear;
        const ridge = smoothstep(rangeT, 0.99, ridged2d(x, y, rangeS * 2.4, seedRidge));
        let rockRise = rangeH * belt * ridge * (0.65 + 0.35 * fbm2d(x, y, 0.05, seedRidge));
        for (const f of local) {
          const lh = landformHeight(f, x, y);
          if (lh > rockRise) rockRise = lh;
        }
        // Rock only where the mountain/mesa actually rises out of the sand (buried aprons stay sand); plateau tops damp dune waves.
        const baseUnderRock = duneBase * (1 - 0.65 * smoothstep(0.8, 3.5, rockRise));
        const h = baseUnderRock + rockRise;
        const rock = smoothstep(1.35, 2.5, rockRise);
        height[i] = Math.fround(h);
        rockiness[i] = Math.fround(rock);
      }
    }
  },
};
