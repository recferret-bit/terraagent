import { DEPOSIT, DEPOSIT_KEYS, type DepositKey } from './tileModel';
import { setTileDeposit } from './tileModel';
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
  const richnessBp = Math.round((L.subRichness as Float32Array)[i]);
  setTileDeposit(state.grid, i, kind, richnessBp, tick);
  sub[i] = DEPOSIT.none;
  (L.subRichness as Float32Array)[i] = 0;
  return { deposit: DEPOSIT_KEYS[kind], richnessBp };
}
