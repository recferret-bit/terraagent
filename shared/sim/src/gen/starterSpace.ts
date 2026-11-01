import { hexDistance, hexIndex } from '../grid/hex';
import { geoBuildBlock } from '../grid/geo';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import type { SimState } from '../kernel/state';

/** Hub footprint is 3×3 (centre + ring 1); mirrors `getHubFootprintTiles`. */
const HUB_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) out.push([dq, dr]);
  return out;
})();

/** Search radius (hex distance from the landing tile) for a ready Hub site. */
export const STARTER_HUB_SEARCH_RADIUS = 3;

function footprintIdx(state: SimState, q: number, r: number): number[] | null {
  const hex = hexIndex(state.grid.radius);
  const out: number[] = [];
  for (const [dq, dr] of HUB_OFFSETS) {
    const i = hex.indexOf(q + dq, r + dr);
    if (i < 0) return null;
    out.push(i);
  }
  return out;
}

/** Same geo rule the Command Hub placement check applies (Flat, no trees / rock / water / deposit), plus ownership. */
function siteReady(state: SimState, tiles: number[], colonyId: number): boolean {
  const { terrain, prep, owner, deposit } = state.grid.layers;
  return tiles.every(
    (i) => geoBuildBlock(terrain[i], prep[i], deposit ? deposit[i] : DEPOSIT.none, 'forbid') === null && (owner[i] < 0 || owner[i] === colonyId),
  );
}

/**
 * Guarantees a clear, buildable 3×3 Command Hub site within `STARTER_HUB_SEARCH_RADIUS` of the landing tile.
 * If none exists, the 3×3 around the landing tile (or the nearest in-grid centre) is deterministically levelled to Flat.
 * Returns the centre of the guaranteed site. Pure of RNG: same state gives the same result.
 */
export function ensureStarterHubSpace(state: SimState, q: number, r: number, colonyId: number): { q: number; r: number } | null {
  const R = STARTER_HUB_SEARCH_RADIUS;
  const cands: Array<{ q: number; r: number; d: number }> = [];
  for (let dr = -R; dr <= R; dr++) {
    for (let dq = -R; dq <= R; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (d <= R) cands.push({ q: q + dq, r: r + dr, d });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.r - b.r || a.q - b.q);
  for (const c of cands) {
    const tiles = footprintIdx(state, c.q, c.r);
    if (tiles && siteReady(state, tiles, colonyId)) return { q: c.q, r: c.r };
  }
  for (const c of cands) {
    const tiles = footprintIdx(state, c.q, c.r);
    if (!tiles) continue;
    const L = state.grid.layers;
    const terrain = L.terrain as Uint8Array, prep = L.prep as Uint8Array, owner = L.owner as Int8Array, height = L.height as Float32Array;
    const deposit = L.deposit as Uint8Array | undefined;
    for (const i of tiles) {
      terrain[i] = TERRAIN.flat;
      prep[i] = PREP.flat;
      if (deposit) deposit[i] = DEPOSIT.none;
      if (owner[i] >= 0 && owner[i] !== colonyId) owner[i] = -1;
      if (height[i] < 0.05 || height[i] > 0.18) height[i] = Math.fround(0.08 + ((i * 17) % 9) * 0.01);
    }
    return { q: c.q, r: c.r };
  }
  return null;
}
