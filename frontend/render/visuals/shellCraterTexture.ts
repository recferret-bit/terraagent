import * as THREE from 'three';

function hash2d(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(ix, iy, seed);
  const n10 = hash2d(ix + 1, iy, seed);
  const n01 = hash2d(ix, iy + 1, seed);
  const n11 = hash2d(ix + 1, iy + 1, seed);
  return (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
}

function fbm2d(x: number, y: number, seed: number): number {
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    total += amp * valueNoise2d(x * freq, y * freq, seed + i * 97);
    freq *= 2.05;
    amp *= 0.5;
  }
  return total;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface ShellCraterPixel {
  r: number;
  g: number;
  b: number;
  a: number;
  h: number;
  rough: number;
}

/**
 * Radial shell-impact hole and crater pixel sampler (`u, v` in `[0, 1]`):
 * - Deep shadowed central bore hole (`r < 0.25`)
 * - Fractured inner crater bowl and radial scorch rays (`0.25..0.46`)
 * - Raised upturned ejecta rim (`0.42..0.64`) for Sobel normal relief
 * - Feathered blast soot apron fading cleanly to `a = 0` inside UV borders (`r >= 0.96`)
 */
export function sampleShellCraterPixel(u: number, v: number): ShellCraterPixel {
  const dx = u * 2 - 1;
  const dy = v * 2 - 1;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);

  const coarse = fbm2d(dx * 4.2 + 7.1, dy * 4.2 - 3.4, 2101);
  const fine = fbm2d(dx * 10.5 - 5.3, dy * 10.5 + 8.9, 2207);
  const grit = valueNoise2d(dx * 22.0 + 1.3, dy * 22.0 - 4.7, 2311);

  // Jagged angular blast rays and radial ground fissures.
  const rayPrimary = Math.pow(0.5 + 0.5 * Math.cos(ang * 9 + coarse * 3.6), 2.0);
  const raySecondary = Math.pow(0.5 + 0.5 * Math.sin(ang * 17 - r * 5.0 + fine * 4.2), 2.5);
  const rayFactor = Math.min(1, rayPrimary * 0.65 + raySecondary * 0.55);

  const warp = (coarse - 0.5) * 0.12 + (fine - 0.5) * 0.06;
  const rw = Math.max(0, r + warp);

  // Inner dark pit & scorched crater wall.
  const pitMask = 1 - smoothstep(0.14, 0.34, rw);
  const wallMask = smoothstep(0.18, 0.34, rw) * (1 - smoothstep(0.36, 0.52, rw));
  const rimPeak = Math.exp(-Math.pow((rw - 0.48) / 0.11, 2));
  const fissureDark = Math.max(0, 1 - Math.abs(Math.sin(ang * 13 + coarse * 4.8)) * 5.2) *
    smoothstep(0.16, 0.28, r) * (1 - smoothstep(0.45, 0.85, r));

  // Heightfield drives the Sobel normal map (0 = deep pit, 128 = neutral ground, 255 = upturned rim).
  const pitDepress = pitMask * 118 + wallMask * 45 + fissureDark * 36;
  const rimRaise = rimPeak * 106 + grit * 22 * (1 - pitMask * 0.7);
  const h = Math.max(4, Math.min(252, 128 - pitDepress + rimRaise));

  // Albedo: warm scorched earth pit -> dusty rim -> soft feathered blast scuff (never pitch black).
  const pitR = 52 + grit * 14;
  const pitG = 44 + grit * 12;
  const pitB = 36 + grit * 10;

  const rimR = 132 + coarse * 30 + grit * 16;
  const rimG = 112 + coarse * 26 + grit * 14;
  const rimB = 90 + coarse * 20 + grit * 10;

  const scorchR = 78 + fine * 22 + grit * 10;
  const scorchG = 66 + fine * 18 + grit * 9;
  const scorchB = 54 + fine * 14 + grit * 8;

  const rimBlend = smoothstep(0.30, 0.52, rw) * (1 - smoothstep(0.56, 0.80, rw));
  let cr = scorchR * (1 - rimBlend) + rimR * rimBlend;
  let cg = scorchG * (1 - rimBlend) + rimG * rimBlend;
  let cb = scorchB * (1 - rimBlend) + rimB * rimBlend;

  cr = cr * (1 - pitMask) + pitR * pitMask;
  cg = cg * (1 - pitMask) + pitG * pitMask;
  cb = cb * (1 - pitMask) + pitB * pitMask;

  const crackShade = 1 - fissureDark * 0.68;
  cr *= crackShade;
  cg *= crackShade;
  cb *= crackShade;

  // Feathered organic blast apron alpha (strictly 0 outside r = 0.96 so no quad edges appear).
  const coreAlpha = 1 - smoothstep(0.42, 0.68, rw);
  const rayApron = (1 - smoothstep(0.50, 0.94, r + (1 - rayFactor) * 0.22 + (coarse - 0.5) * 0.10)) *
    (0.45 + 0.55 * rayFactor);
  const outerCutoff = 1 - smoothstep(0.84, 0.96, r);
  const alpha = Math.max(0, Math.min(1, Math.max(coreAlpha * 0.96, rayApron * 0.88) * outerCutoff));

  const rough = Math.max(178, Math.min(250, 234 - rimPeak * 28 + pitMask * 14 + (grit - 0.5) * 18));
  return { r: cr, g: cg, b: cb, a: alpha * 255, h, rough };
}

export function buildShellCraterTextureBuffers(size = 256): {
  albedo: Uint8Array;
  roughness: Uint8Array;
  height: Uint8Array;
} {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Uint8Array(size * size);
  const clampByte = (val: number) => Math.max(0, Math.min(255, Math.round(val)));

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const p = sampleShellCraterPixel(u, v);
      const k = y * size + x;
      const o = k * 4;
      albedo[o] = clampByte(p.r);
      albedo[o + 1] = clampByte(p.g);
      albedo[o + 2] = clampByte(p.b);
      albedo[o + 3] = clampByte(p.a);
      const rv = clampByte(p.rough);
      roughness[o] = rv;
      roughness[o + 1] = rv;
      roughness[o + 2] = rv;
      roughness[o + 3] = 255;
      height[k] = clampByte(p.h);
    }
  }
  return { albedo, roughness, height };
}

export function clampDecalTextureEdge(tex: THREE.Texture): THREE.Texture {
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
