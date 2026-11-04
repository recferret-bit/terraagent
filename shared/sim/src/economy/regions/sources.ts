import type { ResourceKey } from '@terra/contracts';
import { consumeDepositRichness } from '../../data/terrain';
import { TICK_MS } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import { regionViewOf } from './pin';
import { regionalSourcePolicy } from './sourcePolicy';

/**
 * How the running sources apply the pinned regional policy (W13-51). Every function returns the legacy result when the
 * planet has no pinned region, so W13-off and pre-W13 planets are bit-identical to before.
 */

/**
 * One finite draw from deposit tile `tileIdx` that holds `key`: `work` is the work available this tick, `extractionYieldBp`
 * scales the REMOVED reserve and the CREDITED units together, so credit always equals depletion (it can never credit more
 * finite units than it removed). A resource the region does not allow its extractors to produce yields nothing.
 * Returns the units removed (= credited) and the work spent.
 */
export function drawDeposit(state: PlanetState, tileIdx: number, work: number, tick: number, key: ResourceKey): { got: number; spent: number } {
  const view = regionViewOf(state);
  if (!view) {
    const got = consumeDepositRichness(state, tileIdx, work, tick);
    return { got, spent: got };
  }
  const pol = regionalSourcePolicy(view, key, 'extractor');
  if (!pol.eligible) return { got: 0, spent: 0 };
  const scale = pol.extractionYieldBp / 10000;
  const got = consumeDepositRichness(state, tileIdx, work * scale, tick);
  return { got, spent: got / scale };
}

/** Terraform clearing yields (Clear / Break / Work) as the region pays them: a resource it cannot produce is dropped, the rest scale by its yield (floored to whole units). */
export function regionalClearingYields<T extends Partial<Record<ResourceKey, number>>>(state: PlanetState, yields: T): Partial<Record<ResourceKey, number>> {
  const view = regionViewOf(state);
  if (!view) return yields;
  const out: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(yields) as [ResourceKey, number][]) {
    const pol = regionalSourcePolicy(view, k, 'clearing');
    const whole = Math.floor((v * pol.extractionYieldBp) / 10000); // whole-unit atoms (LED-16)
    if (pol.eligible && whole > 0) out[k] = whole;
  }
  return out;
}

/**
 * Renewable output one of `producers` equal producers of `key` may take this step, or `undefined` when the planet has no
 * pinned region (unlimited, as before). The sector (pre-W11: the whole planet) allowance is `renewableUnitsPerSimHour`
 * (a sim hour = 3600 sim seconds of `dt` ticks); producers share it equally in entity-row order, so extra extractors never
 * multiply it. 0 allowance = no renewal. `yieldScale` is the region's yield for the key.
 */
export function renewableAllowance(state: PlanetState, key: ResourceKey, producers: number, dt: number): { perProducer: number; yieldScale: number } | undefined {
  const view = regionViewOf(state);
  if (!view) return undefined;
  const pol = regionalSourcePolicy(view, key, 'renewable');
  if (!pol.eligible || producers <= 0) return { perProducer: 0, yieldScale: 0 };
  const budget = (pol.renewableUnitsPerSimHour * dt * TICK_MS) / 3_600_000;
  return { perProducer: budget / producers, yieldScale: pol.extractionYieldBp / 10000 };
}
