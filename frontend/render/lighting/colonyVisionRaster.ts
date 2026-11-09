import { planetExtent, tileAt } from '../planets/hex/hexMath';
import type { ColonyVisionSourceDesc, ColonyVisionTextureInput } from './ColonyVisionAndLights';

function isVisionTileExplored(input: ColonyVisionTextureInput, tileIdx: number): boolean {
  const col = input.colonyIndex;
  if (!Number.isInteger(col) || col < 0 || tileIdx < 0) return false;
  const bitset = input.exploredByColony?.[col];
  if (bitset) {
    const byteIdx = tileIdx >> 3;
    if (byteIdx < bitset.length && (bitset[byteIdx]! & (1 << (tileIdx & 7))) !== 0) {
      return true;
    }
  }
  if (col < 8 && input.explored) {
    return ((input.explored[tileIdx] ?? 0) & (1 << col)) !== 0;
  }
  return false;
}

/** Remembered terrain is separate from current sight. Ownership never grants sight by itself. */
export function rasterizeColonyVision(input: ColonyVisionTextureInput, pixels: Uint8Array, size: number): number {
  const span = Math.max(64, planetExtent(input.radius).x * 2.2);
  const step = span / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hit = tileAt(input.radius, (x + 0.5) * step - span / 2, (y + 0.5) * step - span / 2);
      const offset = (y * size + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = hit && isVisionTileExplored(input, hit.i) ? 255 : 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }
  // Bound each source's raster work to its own rectangle; every source participates, regardless of GPU loop budget.
  for (const source of [...(input.baseCenters ?? []), ...(input.visionSources ?? [])]) {
    rasterizeSource(source, pixels, size, span);
  }
  return span;
}

function rasterizeSource(c: ColonyVisionSourceDesc, pixels: Uint8Array, size: number, span: number): void {
  const step = span / size;
  const toPixel = (v: number) => Math.max(0, Math.min(size - 1, Math.floor((v / span + 0.5) * size)));
  const minX = toPixel(c.x - c.outerRadius), maxX = toPixel(c.x + c.outerRadius);
  const minY = toPixel(c.z - c.outerRadius), maxY = toPixel(c.z + c.outerRadius);
  for (let y = minY; y <= maxY; y++) {
    const z = (y + 0.5) * step - span / 2;
    for (let x = minX; x <= maxX; x++) {
      const distance = Math.hypot((x + 0.5) * step - span / 2 - c.x, z - c.z);
      if (distance >= c.outerRadius) continue;
      const t = Math.max(0, Math.min(1, (distance - c.innerRadius) / Math.max(0.01, c.outerRadius - c.innerRadius)));
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.max(pixels[offset]!, Math.round((1 - t * t * (3 - 2 * t)) * 255));
      pixels[offset + 1] = 255;
    }
  }
}

export function colonyVisionSignature(input: ColonyVisionTextureInput): string {
  const col = input.colonyIndex;
  const bitset = col >= 0 ? input.exploredByColony?.[col] : undefined;
  let hash = 0;
  if (bitset && col >= 8) {
    for (let b = 0; b < bitset.length; b++) {
      const byte = bitset[b]!;
      if (byte === 0) continue;
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << bit)) hash = (hash * 31 + (b << 3) + bit + 1) | 0;
      }
    }
  } else if (col >= 0 && col < 8 && (bitset || input.explored)) {
    const tileLen = Math.max(input.explored?.length ?? 0, (bitset?.length ?? 0) << 3);
    for (let i = 0; i < tileLen; i++) {
      if (isVisionTileExplored(input, i)) hash = (hash * 31 + i + 1) | 0;
    }
  }
  const sources = [...(input.baseCenters ?? []), ...(input.visionSources ?? [])];
  const key = sources.map(c => `${c.x.toFixed(1)},${c.z.toFixed(1)},${c.innerRadius},${c.outerRadius}`).join(';');
  return `${input.radius}:${input.colonyIndex}:${hash}:${key}`;
}
