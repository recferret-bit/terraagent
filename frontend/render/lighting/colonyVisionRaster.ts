import { planetExtent, tileAt } from '../planets/hex/hexMath';
import type { ColonyVisionSourceDesc, ColonyVisionTextureInput } from './ColonyVisionAndLights';

/** Remembered terrain is separate from current sight. Ownership never grants sight by itself. */
export function rasterizeColonyVision(input: ColonyVisionTextureInput, pixels: Uint8Array, size: number): number {
  const span = Math.max(64, planetExtent(input.radius).x * 2.2);
  const step = span / size;
  const mask = input.colonyIndex >= 0 && input.colonyIndex < 8 ? 1 << input.colonyIndex : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hit = tileAt(input.radius, (x + 0.5) * step - span / 2, (y + 0.5) * step - span / 2);
      const offset = (y * size + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = hit && ((input.explored?.[hit.i] ?? 0) & mask) ? 255 : 0;
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
  const mask = input.colonyIndex >= 0 && input.colonyIndex < 8 ? 1 << input.colonyIndex : 0;
  let hash = 0;
  if (input.explored && mask) {
    for (let i = 0; i < input.explored.length; i++) {
      if (input.explored[i]! & mask) hash = (hash * 31 + i + 1) | 0;
    }
  }
  const sources = [...(input.baseCenters ?? []), ...(input.visionSources ?? [])];
  const key = sources.map(c => `${c.x.toFixed(1)},${c.z.toFixed(1)},${c.innerRadius},${c.outerRadius}`).join(';');
  return `${input.radius}:${input.colonyIndex}:${hash}:${key}`;
}
