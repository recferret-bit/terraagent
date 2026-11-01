import { hexDistance, hexIndex } from '../grid/hex';
import { geoBuildBlock, MAX_FOOTPRINT_SPREAD_M } from '../grid/geo';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import type { SimState } from '../kernel/state';
import { setTileDeposit, setTileHeight, setTileOwner, setTilePrep, setTileTerrain } from '../grid/tileModel';

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
  const { terrain, prep, owner, deposit, height } = state.grid.layers;
  let lo = Infinity, hi = -Infinity;
  for (const i of tiles) { lo = Math.min(lo, height[i]); hi = Math.max(hi, height[i]); }
  return hi - lo <= MAX_FOOTPRINT_SPREAD_M && tiles.every(
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
  // Fallback: level the nearest footprint, preferring one that destroys no visible deposit (they carry guarantees).
  const L = state.grid.layers;
  const deposit = L.deposit as Uint8Array | undefined;
  const lossOf = (tiles: number[]) => (deposit ? tiles.filter((i) => deposit[i] !== DEPOSIT.none).length : 0);
  const fallback = cands
    .map((c) => ({ c, tiles: footprintIdx(state, c.q, c.r) }))
    .filter((x): x is { c: (typeof cands)[number]; tiles: number[] } => x.tiles !== null)
    .sort((a, b) => lossOf(a.tiles) - lossOf(b.tiles) || a.c.d - b.c.d || a.c.r - b.c.r || a.c.q - b.c.q)[0];
  if (fallback) {
    const { c, tiles } = fallback;
    const height = L.height as Float32Array, owner = L.owner as Int8Array;
    const level = Math.fround(tiles.map((i) => height[i]).sort((x, y) => x - y)[tiles.length >> 1]);
    for (const i of tiles) {
      // Setters stamp each layer write, so the next delta carries the levelled site (D-38: runtime landing path).
      setTileTerrain(state.grid, i, TERRAIN.flat);
      setTilePrep(state.grid, i, PREP.flat);
      if (deposit && deposit[i] !== DEPOSIT.none) setTileDeposit(state.grid, i, DEPOSIT.none, 0);
      if (owner[i] >= 0 && owner[i] !== colonyId) setTileOwner(state.grid, i, -1);
      if (L.subDeposit) { (L.subDeposit as Uint8Array)[i] = DEPOSIT.none; (L.subRichness as Float32Array)[i] = 0; }
      setTileHeight(state.grid, i, level); // one level: the footprint must pass the spread rule
    }
    return { q: c.q, r: c.r };
  }
  return null;
}
