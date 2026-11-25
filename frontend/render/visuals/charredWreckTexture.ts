function hash2d(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function tileableValueNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wx0 = ((ix % period) + period) % period;
  const wy0 = ((iy % period) + period) % period;
  const wx1 = (wx0 + 1) % period;
  const wy1 = (wy0 + 1) % period;
  const n00 = hash2d(wx0, wy0, seed);
  const n10 = hash2d(wx1, wy0, seed);
  const n01 = hash2d(wx0, wy1, seed);
  const n11 = hash2d(wx1, wy1, seed);
  return (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
}

function tileableWorleyEdge(u: number, v: number, cells: number, seed: number): { edge: number; dome: number } {
  const gx = u * cells;
  const gy = v * cells;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let d1 = 9;
  let d2 = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = (((ix + ox) % cells) + cells) % cells;
      const cy = (((iy + oy) % cells) + cells) % cells;
      const px = ix + ox + 0.15 + 0.7 * hash2d(cx, cy, seed);
      const py = iy + oy + 0.15 + 0.7 * hash2d(cx, cy, seed + 193);
      const dist = Math.hypot(px - gx, py - gy);
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }
  return { edge: d2 - d1, dome: Math.max(0, 1 - d1 * 1.45) };
}

/**
 * Tileable multi-scale fire-burned hull texture sample: carbon soot plumes, alligator-char blisters,
 * heat-fracture cracks, ash dust ridges, and matte soot/sintered-slag roughness.
 */
export function sampleCharredWreckPixel(u: number, v: number): { r: number; g: number; b: number; h: number; rough: number } {
  const macroSoot =
    0.55 * tileableValueNoise(u, v, 5, 1301) +
    0.30 * tileableValueNoise(u, v, 11, 1319) +
    0.15 * tileableValueNoise(u, v, 23, 1361);
  const flameSwirl = tileableValueNoise(u + 0.14 * Math.sin(v * Math.PI * 4), v, 7, 1409);
  const streak = 0.5 + 0.5 * Math.sin((u * 4 + flameSwirl * 0.9) * Math.PI * 2);
  const blister = tileableWorleyEdge(u, v, 10, 1451);
  const fineChar = tileableWorleyEdge(u + 0.04, v + 0.07, 22, 1493);
  const crackA = Math.max(0, 1 - blister.edge / 0.12);
  const crackB = Math.max(0, 1 - fineChar.edge / 0.10);
  const crack = Math.min(1, crackA * 0.85 + crackB * 0.5);
  const grit = tileableValueNoise(u, v, 44, 1543);
  const ashCrest = Math.max(0, macroSoot - 0.52) * 1.9 * (1 - crack * 0.8) + fineChar.dome * 0.14;
  const slag = Math.max(0, tileableValueNoise(u, v, 17, 1597) - 0.70) * 3.0;

  const sootDepth = Math.max(0, Math.min(1, (1 - macroSoot) * 0.50 + (1 - streak) * 0.22 + crack * 0.55));
  const charBase = 56 + (1 - sootDepth) * 48 + ashCrest * 22 + grit * 10;
  const r = Math.min(138, charBase + slag * 10 + ashCrest * 4);
  const g = Math.min(132, charBase * 0.96 + slag * 5 + ashCrest * 3);
  const b = Math.min(126, charBase * 0.92 + ashCrest * 3);
  const h = Math.max(6, Math.min(250, 96 + blister.dome * 64 + fineChar.dome * 28 + grit * 24 - crack * 110 - sootDepth * 18));
  const rough = Math.max(176, Math.min(252, 232 - slag * 38 + crack * 14 + (grit - 0.5) * 18));
  return { r, g, b, h, rough };
}
