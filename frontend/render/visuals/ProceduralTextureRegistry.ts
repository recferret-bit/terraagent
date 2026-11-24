// .agents/skills/procedural-texture-synthesis/examples/ProceduralTextureRegistry.ts
import * as THREE from 'three';

export interface ProceduralPBRBundle {
  map?: THREE.Texture;
  normalMap?: THREE.DataTexture;
  roughnessMap?: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

export interface HeightBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

export type ProceduralTextureGeneratorFn = (size?: number) => ProceduralPBRBundle;

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

function makeDataTex(rgba: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Converts a grayscale height canvas or raw `HeightBuffer` into a seamless tangent-space Normal DataTexture
 * using a wrapping 3x3 Sobel filter.
 */
export function heightToNormalTexture(
  heightSource: HTMLCanvasElement | HeightBuffer,
  normalStrength = 2.5,
): THREE.DataTexture {
  const size = heightSource.width;
  const isBuffer = 'data' in heightSource;
  const src = isBuffer
    ? heightSource.data
    : heightSource.getContext('2d')!.getImageData(0, 0, size, size).data;
  const stride = isBuffer && src.length === size * size ? 1 : 4;
  const out = new Uint8Array(size * size * 4);

  const h = (x: number, y: number): number => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return src[(wy * size + wx) * stride]! / 255.0;
  };

  const invStrength = 1.0 / Math.max(normalStrength, 0.01);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = h(x - 1, y - 1);
      const t = h(x, y - 1);
      const tr = h(x + 1, y - 1);
      const l = h(x - 1, y);
      const r = h(x + 1, y);
      const bl = h(x - 1, y + 1);
      const b = h(x, y + 1);
      const br = h(x + 1, y + 1);

      const dX = tr + 2.0 * r + br - (tl + 2.0 * l + bl);
      const dY = bl + 2.0 * b + br - (tl + 2.0 * t + tr);
      const dZ = invStrength;

      const len = Math.hypot(dX, dY, dZ) || 1.0;
      const idx = (y * size + x) * 4;
      out[idx + 0] = clampByte(((-dX / len) * 0.5 + 0.5) * 255);
      out[idx + 1] = clampByte(((-dY / len) * 0.5 + 0.5) * 255);
      out[idx + 2] = clampByte(((dZ / len) * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  return makeDataTex(out, size, false);
}

/**
 * Open Registry for startup-synthesized PBR texture bundles.
 */
export class ProceduralTextureRegistry {
  private static generators = new Map<string, ProceduralTextureGeneratorFn>();
  private static cache = new Map<string, ProceduralPBRBundle>();

  public static register(name: string, fn: ProceduralTextureGeneratorFn): void {
    this.generators.set(name, fn);
    const prefix = `${name}_`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))) this.cache.delete(key);
    }
  }

  public static get(name: string, size = 512): ProceduralPBRBundle {
    const key = `${name}_${size}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const fn = this.generators.get(name);
    if (!fn) {
      throw new Error(`ProceduralTextureRegistry: Unknown preset "${name}"`);
    }
    const bundle = fn(size);
    this.cache.set(key, bundle);
    return bundle;
  }

  public static listPresets(): string[] {
    return [...this.generators.keys()];
  }
}

function buildBufferPbrPreset(
  size: number,
  normalStrength: number,
  sample: (u: number, v: number) => { r: number; g: number; b: number; h: number; rough: number },
): ProceduralPBRBundle {
  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const p = sample(u, v);
      const k = y * size + x;
      const o = k * 4;
      albedo[o] = clampByte(p.r);
      albedo[o + 1] = clampByte(p.g);
      albedo[o + 2] = clampByte(p.b);
      albedo[o + 3] = 255;
      const rv = clampByte(p.rough);
      rough[o] = rv;
      rough[o + 1] = rv;
      rough[o + 2] = rv;
      rough[o + 3] = 255;
      height[k] = clampByte(p.h);
    }
  }
  return {
    map: makeDataTex(albedo, size, true),
    normalMap: heightToNormalTexture({ width: size, height: size, data: height }, normalStrength),
    roughnessMap: makeDataTex(rough, size, false),
  };
}

// --- Built-in Mechanical & Industrial Presets ---

ProceduralTextureRegistry.register('scifiHullPanels', (size = 256) =>
  buildBufferPbrPreset(size, 3.0, (u, v) => {
    const gx = (u * 4) % 1;
    const gy = (v * 4) % 1;
    const seam = gx < 0.03 || gx > 0.97 || gy < 0.03 || gy > 0.97;
    const grain = tileableValueNoise(u, v, 32, 101) * 14;
    const h = seam ? 36 : 186 + grain;
    const rough = seam ? 220 : 112 + grain * 0.6;
    return { r: 164 + grain * 0.5, g: 170 + grain * 0.5, b: 178 + grain * 0.5, h, rough };
  }),
);

ProceduralTextureRegistry.register('solarHexGrid', (size = 256) =>
  buildBufferPbrPreset(size, 2.2, (u, v) => {
    const gx = (u * 8) % 1;
    const gy = (v * 8) % 1;
    const bus = gx < 0.06 || gy < 0.06;
    return bus
      ? { r: 152, g: 168, b: 188, h: 226, rough: 92 }
      : { r: 22, g: 46, b: 84, h: 96, rough: 68 };
  }),
);

ProceduralTextureRegistry.register('flagshipSovereignHull', (size = 256) =>
  buildBufferPbrPreset(size, 3.4, (u, v) => {
    const row = Math.floor(v * 4);
    const stagger = (row % 2) * 0.5;
    const tx = (u * 2 + stagger) % 1;
    const ty = (v * 4) % 1;
    const majorSeam = tx < 0.028 || tx > 0.972 || ty < 0.038 || ty > 0.962;
    const subSeam =
      !majorSeam &&
      ((Math.abs(tx - 0.5) < 0.011 && ty > 0.16 && ty < 0.84) ||
        (Math.abs(ty - 0.5) < 0.014 && tx > 0.10 && tx < 0.42));
    const bevel = Math.min(tx, 1 - tx, ty, 1 - ty);
    const cornerBolt = !majorSeam && Math.hypot(Math.min(tx, 1 - tx) - 0.075, Math.min(ty, 1 - ty) - 0.11) < 0.02;
    const plateId = hash2d(Math.floor(u * 2 + stagger) % 4, row % 4, 409);
    const brush = 0.5 + 0.5 * Math.sin((u * 36 + tileableValueNoise(u, v, 20, 419) * 0.6) * Math.PI * 2);
    const grain = tileableValueNoise(u, v, 36, 431);
    const h = majorSeam
      ? 24
      : subSeam
        ? 86
        : cornerBolt
          ? 240
          : Math.min(228, 152 + Math.min(bevel * 620, 46) + plateId * 16 + brush * 7);
    const rough = majorSeam
      ? 232
      : subSeam
        ? 184
        : cornerBolt
          ? 64
          : 92 + (1 - plateId) * 22 + (1 - brush) * 12 + grain * 10;
    const luma = majorSeam
      ? 104
      : subSeam
        ? 156
        : cornerBolt
          ? 244
          : 208 + (plateId - 0.5) * 22 + (brush - 0.5) * 9 + (grain - 0.5) * 7;
    const coolTint = majorSeam ? -4 : cornerBolt ? 8 : plateId > 0.62 ? 6 : -3;
    return { r: luma - coolTint * 0.4, g: luma + coolTint * 0.15, b: luma + coolTint, h, rough };
  }),
);

// --- Living Biosphere Botanical & Organic Presets ---

ProceduralTextureRegistry.register('treeBarkFissures', (size = 256) =>
  buildBufferPbrPreset(size, 2.8, (u, v) => {
    const warp = (tileableValueNoise(u, v, 6, 311) - 0.5) * 0.08;
    const ridge = Math.abs(Math.sin((u + warp) * Math.PI * 14));
    const knot = tileableValueNoise(u, v, 12, 317);
    const fine = tileableValueNoise(u, v, 48, 331);
    const h = 55 + ridge * 145 * (0.7 + 0.3 * knot) + fine * 28;
    const moss = Math.max(0, knot - 0.68) * 2.2;
    const base = 0.55 + 0.45 * ridge;
    return {
      r: 96 * base * (1 - moss * 0.35) + 46 * moss,
      g: 72 * base * (1 - moss * 0.2) + 98 * moss,
      b: 50 * base * (1 - moss * 0.4) + 42 * moss,
      h,
      rough: 235 - ridge * 48,
    };
  }),
);

ProceduralTextureRegistry.register('meadowGrassClover', (size = 256) =>
  buildBufferPbrPreset(size, 2.0, (u, v) => {
    const patch = tileableValueNoise(u, v, 5, 501);
    const blades = tileableValueNoise(u, v, 28, 509) * 0.65 + tileableValueNoise(u, v, 64, 521) * 0.35;
    const bloom = Math.max(0, tileableValueNoise(u, v, 18, 541) - 0.78) * 4.2;
    const h = 75 + blades * 140 + bloom * 35;
    const lush = 0.72 + 0.42 * patch;
    return {
      r: (68 * lush + 34 * blades) * (1 - bloom) + 232 * bloom,
      g: (116 * lush + 52 * blades) * (1 - bloom) + 206 * bloom,
      b: (52 * lush + 22 * blades) * (1 - bloom) + 108 * bloom,
      h,
      rough: 228 - blades * 44 - bloom * 30,
    };
  }),
);

ProceduralTextureRegistry.register('desertPebbleCrust', (size = 256) =>
  buildBufferPbrPreset(size, 2.4, (u, v) => {
    const ripple = 0.5 + 0.5 * Math.sin((v * 10 + (tileableValueNoise(u, v, 4, 701) - 0.5) * 1.4) * Math.PI * 2);
    const pebble = Math.max(0, tileableValueNoise(u, v, 30, 719) - 0.66) * 2.9;
    const crack = Math.max(0, 0.12 - Math.abs(tileableValueNoise(u, v, 9, 733) - 0.5)) * 6.0;
    const h = 110 + ripple * 62 + pebble * 74 - crack * 65;
    return {
      r: 208 + ripple * 24 - pebble * 52 - crack * 38,
      g: 154 + ripple * 20 - pebble * 46 - crack * 32,
      b: 98 + ripple * 14 - pebble * 34 - crack * 22,
      h,
      rough: 236 - pebble * 45 + crack * 14,
    };
  }),
);

ProceduralTextureRegistry.register('warmFurPelage', (size = 256) =>
  buildBufferPbrPreset(size, 2.35, (u, v) => {
    const row = Math.floor(v * 6);
    const stagger = (row % 2) * 0.5;
    const cu = ((u * 5 + stagger) % 1) - 0.5;
    const cv = (v * 6) % 1;
    const vNotch = 1 - Math.min(1, cv * 0.85 + Math.abs(cu) * 1.45);
    const lockShape = Math.max(0, Math.min(1, vNotch * 1.35));
    const tuft = tileableValueNoise(u * 2, v, 14, 907) * 0.65 + tileableValueNoise(u * 3, v, 28, 919) * 0.35;
    const guard = 0.5 + 0.5 * Math.sin((u * 12 + tuft * 2.4 + cu * 1.6) * Math.PI * 2);
    const parting = Math.max(0, 1 - lockShape * 1.6);
    const h = 72 + lockShape * 116 + tuft * 34 + guard * 18;
    const luma = 192 + (lockShape - 0.44) * 52 + (tuft - 0.5) * 22 + (guard - 0.5) * 14 - parting * 22;
    return {
      r: luma,
      g: luma,
      b: luma,
      h,
      rough: 214 - lockShape * 28 - guard * 24,
    };
  }),
);

ProceduralTextureRegistry.register('avianFeatherVane', (size = 256) =>
  buildBufferPbrPreset(size, 1.5, (u, v) => {
    const row = Math.floor(v * 10);
    const stagger = (row % 2) * 0.5;
    const cellU = ((u * 8 + stagger) % 1) - 0.5;
    const cellV = (v * 10) % 1;
    const barb = 0.5 + 0.5 * Math.cos((Math.abs(cellU) * 14 + cellV * 12) * Math.PI);
    const edge = Math.max(0, 1 - Math.abs(cellU) * 1.9);
    const overlap = Math.min(1, cellV * 1.25) * edge;
    const fine = tileableValueNoise(u * 2, v * 2, 28, 1021);
    const h = 88 + overlap * 98 + barb * 28 + fine * 18;
    const luma = 198 + (overlap - 0.5) * 24 + (barb - 0.5) * 16 + (fine - 0.5) * 14;
    return {
      r: luma,
      g: luma,
      b: luma,
      h,
      rough: 186 - overlap * 36 - barb * 20,
    };
  }),
);
