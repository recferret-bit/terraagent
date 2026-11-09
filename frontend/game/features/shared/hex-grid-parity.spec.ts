import { describe, expect, it } from 'vitest';
import { createPlanet } from '@terra/sim/gen/createPlanet';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import { hexTileMask } from '@terra/sim/grid/hexTile';
import { createHexTileTint } from '@terra/render/planets/hex/tileTint';
import { kindForPlanetType } from '@terra/render/planets/hex/planetKind';

/**
 * Parity: the hex grid the renderer draws (`uHexGrid`, one flag per cell) is exactly the sim's one rule, `hexTileMask`,
 * on generated planets of all three kinds, and stays so through incremental tile updates.
 */
const R = 56;
const TYPES = ['desert', 'ocean', 'temperate'] as const;

function generated(type: (typeof TYPES)[number]) {
  const s = createPlanet({ id: 'p', seed: `hex-grid-${type}`, type, planetType: type, radius: R });
  const { terrain, prep, height, deposit } = s.grid.layers;
  return { terrain, prep, height, deposit, kind: kindForPlanetType(type) };
}

/** The flag the shader reads: R byte of the cell's texel (axial `(q + R, r + R)`), as 0 / 1 per tile index. */
function drawnFlags(tint: ReturnType<typeof createHexTileTint>): number[] {
  const hx = hexIndex(R), n = 2 * R + 1;
  const data = tint.hexGridTexture.image.data as Uint8Array;
  return Array.from({ length: hx.count }, (_, i) => (data[((hx.r[i]! + R) * n + hx.q[i]! + R) * 4] === 255 ? 1 : 0));
}

describe('hex grid parity: renderer flag === sim hexTileMask', () => {
  for (const type of TYPES) {
    it(`${type}: every tile's drawn grid flag equals hexTileMask, and a planted obstacle clears its tile and one-ring`, () => {
      const layers = generated(type);
      const tint = createHexTileTint(R, layers);
      const mask = Array.from(hexTileMask(R, layers));
      expect(drawnFlags(tint)).toEqual(mask);
      const onGrid = mask.reduce((a, b) => a + b, 0);
      expect(onGrid, 'the planet has a grid at all').toBeGreaterThan(50);
      expect(onGrid, 'and wild ground').toBeLessThan(mask.length);

      // Plant a rock in the middle of the grid: a hex tile whose whole one-ring is hex tiles too.
      const hx = hexIndex(R);
      const ringOf = (i: number) => HEX_DIRS.map(([dq, dr]) => hx.indexOf(hx.q[i]! + dq, hx.r[i]! + dr));
      const i = mask.findIndex((m, k) => m === 1 && ringOf(k).every((j) => j >= 0 && mask[j] === 1));
      expect(i).toBeGreaterThanOrEqual(0);
      const before = { terrain: layers.terrain[i]!, height: layers.height[i]! };
      layers.terrain[i] = 2; // rock
      layers.height[i] = before.height + 1.2;
      tint.update(layers, [i]);
      const drawn = drawnFlags(tint);
      expect(drawn[i]).toBe(0);
      for (const j of ringOf(i)) expect(drawn[j]).toBe(0);
      expect(drawn, 'incremental update equals the full rule').toEqual(Array.from(hexTileMask(R, layers)));

      layers.terrain[i] = before.terrain;
      layers.height[i] = before.height;
      tint.update(layers, [i]);
      expect(drawnFlags(tint)).toEqual(mask);
      tint.dispose();
    });
  }
});
