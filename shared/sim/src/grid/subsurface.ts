import { DEPOSIT, DEPOSIT_KEYS, type DepositKey } from './tileModel';
import { setTileDeposit } from './tileModel';
import { regionViewOf, stableTileDraws } from '../economy/regions/pin';
import { rollRegionalDeposit } from '../economy/regions/sourcePolicy';
import type { PlanetState } from '../kernel/state';

/**
 * Reveals the hidden subsurface of tile `i` (D-38): a deposit buried under trees / rock (server-only layers
 * `subDeposit` / `subRichness`, written by world generation) becomes a visible deposit once the obstacle is removed.
 * Pure grid write with a stamp, so the next delta carries the new `deposit` / `richness` to clients (who never saw the
 * hidden layers). Returns the revealed deposit key, or `null` when nothing was buried or a deposit is already visible.
 */
export function revealSubsurface(state: PlanetState, i: number, tick: number): { deposit: DepositKey; richnessBp: number } | null {
  const L = state.grid.layers;
  const sub = L.subDeposit as Uint8Array | undefined;
  if (!sub || sub[i] === DEPOSIT.none || L.deposit[i] !== DEPOSIT.none) return null;
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
