// .agents/skills/procedural-texture-synthesis/examples/ProceduralTextureRegistry.ts
import * as THREE from 'three';

export interface ProceduralPBRBundle {
  map?: THREE.Texture;
  normalMap?: THREE.DataTexture;
  roughnessMap?: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
}

export type ProceduralTextureGeneratorFn = (size?: number) => ProceduralPBRBundle;

/**
 * Converts a grayscale height canvas into a seamless tangent-space Normal DataTexture
 * using a wrapping 3x3 Sobel filter.
 */
export function heightToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  normalStrength = 2.5
): THREE.DataTexture {
  const size = heightCanvas.width;
  const ctx = heightCanvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, size, size).data;
  const out = new Uint8Array(size * size * 4);

  const h = (x: number, y: number): number => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return src[(wy * size + wx) * 4] / 255.0;
  };

  const invStrength = 1.0 / Math.max(normalStrength, 0.01);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = h(x - 1, y - 1);
      const t  = h(x,     y - 1);
      const tr = h(x + 1, y - 1);
      const l  = h(x - 1, y);
      const r  = h(x + 1, y);
      const bl = h(x - 1, y + 1);
      const b  = h(x,     y + 1);
      const br = h(x + 1, y + 1);

      const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
      const dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
      const dZ = invStrength;

      const len = Math.hypot(dX, dY, dZ) || 1.0;
      const idx = (y * size + x) * 4;
      out[idx + 0] = Math.round(((-dX / len) * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round(((-dY / len) * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((( dZ / len) * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  const normalTex = new THREE.DataTexture(out, size, size, THREE.RGBAFormat);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.colorSpace = THREE.NoColorSpace;
  normalTex.needsUpdate = true;
  return normalTex;
}

/**
 * Open Registry for startup-synthesized PBR texture bundles.
 */
export class ProceduralTextureRegistry {
  private static generators = new Map<string, ProceduralTextureGeneratorFn>();
  private static cache = new Map<string, ProceduralPBRBundle>();

  public static register(name: string, fn: ProceduralTextureGeneratorFn): void {
    this.generators.set(name, fn);
    this.cache.delete(name);
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
}

// --- Built-in Procedural PBR Generators ---

ProceduralTextureRegistry.register('scifiHullPanels', (size = 512) => {
  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base plate height & roughness
  hCtx.fillStyle = '#b8b8b8';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#707070'; // ~0.44 roughness
  rCtx.fillRect(0, 0, size, size);

  const panels = [
    [0, 0, size * 0.5, size * 0.5],
    [size * 0.5, 0, size * 0.5, size * 0.25],
    [size * 0.5, size * 0.25, size * 0.5, size * 0.25],
    [0, size * 0.5, size * 0.25, size * 0.5],
    [size * 0.25, size * 0.5, size * 0.75, size * 0.5],
  ];

  for (const [x, y, w, h] of panels) {
    // Subtle per-plate roughness variation
    const rVal = 105 + Math.floor(((x * 13 + y * 7) % 24));
    rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
    rCtx.fillRect(x + 3, y + 3, w - 6, h - 6);

    // Recessed panel groove
    hCtx.strokeStyle = '#222222';
    hCtx.lineWidth = 4;
    hCtx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    // Dusty high-roughness seam
    rCtx.strokeStyle = '#dcdcdc';
    rCtx.lineWidth = 4;
    rCtx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    // Corner rivet indentations
    hCtx.fillStyle = '#383838';
    const inset = 12;
    for (const [rx, ry] of [
      [x + inset, y + inset],
      [x + w - inset, y + inset],
      [x + inset, y + h - inset],
      [x + w - inset, y + h - inset],
    ]) {
      hCtx.beginPath();
      hCtx.arc(rx, ry, 3, 0, Math.PI * 2);
      hCtx.fill();
    }
  }

  const normalMap = heightToNormalTexture(heightCanvas, 3.0);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;

  return { normalMap, roughnessMap };
});

ProceduralTextureRegistry.register('solarHexGrid', (size = 512) => {
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  aCtx.fillStyle = '#122645';
  aCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#606060';
  hCtx.fillRect(0, 0, size, size);

  const step = size / 8;
  aCtx.strokeStyle = '#94a3b8';
  aCtx.lineWidth = 2;
  hCtx.strokeStyle = '#e2e2e2';
  hCtx.lineWidth = 3;

  for (let i = 0; i <= 8; i++) {
    const pos = i * step;
    aCtx.beginPath();
    aCtx.moveTo(pos, 0);
    aCtx.lineTo(pos, size);
    aCtx.moveTo(0, pos);
    aCtx.lineTo(size, pos);
    aCtx.stroke();

    hCtx.beginPath();
    hCtx.moveTo(pos, 0);
    hCtx.lineTo(pos, size);
    hCtx.moveTo(0, pos);
    hCtx.lineTo(size, pos);
    hCtx.stroke();
  }

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = heightToNormalTexture(heightCanvas, 2.2);
  return { map, normalMap };
});
