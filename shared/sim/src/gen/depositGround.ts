import { hexTileMask } from '../grid/hexTile';
import { DEPOSIT } from '../grid/layers';
import type { SimState } from '../kernel/state';

/**
 * DEPOSIT GROUND (owner rule, 2026-11-06): a visible deposit only ever lies on a HEX TILE (`grid/hexTile.ts` R2: open
 * ground with a full, open, level one-ring). World generation follows it in two steps and nothing else:
 *
 *   G1  every writer that CHOOSES a tile for a visible deposit chooses among the hex tiles of the ground as it is at
 *       that moment (`depositGroundMask`): the `deposits` stage, and the starter deposits after the landing zones
 *       are levelled (`starterDeposits.ts`);
 *   G2  one final step of the orchestrator (`buryWildDeposits`, after every profile stage) moves a visible deposit that
 *       later ground changes left on wild ground into the hidden subsurface, where Clear / Break / Work reveal it again
 *       once its tile is a hex tile (`grid/subsurface.ts`).
 *
 * The hidden subsurface may lie under any ground: it only becomes visible on a hex tile.
 */

/** 1 = a visible deposit may lie on this tile (it is a hex tile), 0 = wild ground. */
export function depositGroundMask(state: SimState): Uint8Array {
  const L = state.grid.layers;
  return hexTileMask(state.grid.radius, { terrain: L.terrain, prep: L.prep, height: L.height });
}

/**
 * G2: every visible deposit on wild ground moves to the hidden subsurface (kind and richness kept; the visible tier is
 * dropped: a buried deposit is revealed at tier 0 like every buried one). A tile that already holds a buried deposit
 * keeps the buried one and the visible one is dropped. Returns how many visible deposits left the surface.
 */
export function buryWildDeposits(state: SimState): number {
  const L = state.grid.layers;
  const deposit = L.deposit as Uint8Array, richness = L.richness as Float32Array;
  const tier = L.depositTier as Uint8Array | undefined;
  const sub = L.subDeposit as Uint8Array | undefined, subRich = L.subRichness as Float32Array | undefined;
  const mask = depositGroundMask(state);
  let moved = 0;
  for (let i = 0; i < state.grid.count; i++) {
    if (deposit[i] === DEPOSIT.none || mask[i]) continue;
    if (sub && subRich && sub[i] === DEPOSIT.none) {
      sub[i] = deposit[i];
      subRich[i] = Math.round(richness[i]);
    }
    deposit[i] = DEPOSIT.none;
    richness[i] = 0;
    if (tier) tier[i] = 0;
    moved++;
  }
  return moved;
}
