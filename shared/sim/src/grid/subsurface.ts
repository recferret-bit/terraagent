import { DEPOSIT, DEPOSIT_KEYS, type DepositKey } from './tileModel';
import { setTileDeposit } from './tileModel';
import { regionViewOf, stableTileDraws } from '../economy/regions/pin';
import { rollRegionalDeposit } from '../economy/regions/sourcePolicy';
import { hexIndex } from './hex';
import { hexTileRing, isHexTile } from './hexTile';
import type { PlanetState } from '../kernel/state';

/**
 * Reveals the hidden subsurface of tile `i` (D-38): a deposit buried under trees / rock / dunes (server-only layers
 * `subDeposit` / `subRichness`, written by world generation) becomes a visible deposit once its tile is a HEX TILE
 * (`grid/hexTile.ts`: open ground with an open, level one-ring); a visible deposit never appears on wild ground.
 * Pure grid write with a stamp, so the next delta carries the new `deposit` / `richness` to clients (who never saw the
 * hidden layers). Returns the revealed deposit key, or `null` when nothing was buried, a deposit is already visible,
 * or the tile is not a hex tile yet (the deposit stays buried until it is: see {@link revealAroundChanged}).
 */
export function revealSubsurface(state: PlanetState, i: number, tick: number): { deposit: DepositKey; richnessBp: number } | null {
  const L = state.grid.layers;
  const sub = L.subDeposit as Uint8Array | undefined;
  if (!sub || sub[i] === DEPOSIT.none || L.deposit[i] !== DEPOSIT.none) return null;
  if (!isHexTile(state.grid.radius, i, { terrain: L.terrain, prep: L.prep, height: L.height })) return null;
  const kind = sub[i];
  const view = regionViewOf(state);
  let richnessBp = Math.round((L.subRichness as Float32Array)[i]);
  let tier = 0;
  if (view) { // W13-51: the region decides the tier and reserve of a buried deposit, seeded once by tile identity; none allowed = nothing found
    const [pick, reserve] = stableTileDraws(state, 'sub', i, 2);
    const roll = rollRegionalDeposit(view, 'subsurfaceDeposit', { pick, reserve }, [kind]);
    sub[i] = DEPOSIT.none;
    (L.subRichness as Float32Array)[i] = 0;
    if (!roll) return null;
    richnessBp = roll.richnessBp;
    tier = roll.tier;
  }
  setTileDeposit(state.grid, i, kind, richnessBp, tick, tier);
  sub[i] = DEPOSIT.none;
  (L.subRichness as Float32Array)[i] = 0;
  return { deposit: DEPOSIT_KEYS[kind], richnessBp };
}

export interface RevealedDeposit {
  q: number;
  r: number;
  deposit: DepositKey;
  richnessBp: number;
}

/**
 * The one reveal step after ground changed (every completed terraform calls it with the tiles it changed): a tile's
 * hex-tile state depends on its six neighbours, so the changed tiles AND their neighbours are tried, each once, in
 * ascending tile order. A buried deposit beside the last rock you break, or inside a flattened dune disc, appears here.
 * Returns what was revealed with its coordinates (callers emit `groundRevealed` for each).
 */
export function revealAroundChanged(state: PlanetState, changed: Iterable<number>, tick: number): RevealedDeposit[] {
  const sub = state.grid.layers.subDeposit as Uint8Array | undefined;
  if (!sub) return [];
  const tiles = new Set<number>();
  for (const i of changed) for (const j of hexTileRing(state.grid.radius, i)) if (sub[j] !== DEPOSIT.none) tiles.add(j);
  const hx = hexIndex(state.grid.radius);
  const out: RevealedDeposit[] = [];
  for (const i of [...tiles].sort((a, b) => a - b)) {
    const found = revealSubsurface(state, i, tick);
    if (found) out.push({ q: hx.q[i]!, r: hx.r[i]!, ...found });
  }
  return out;
}
