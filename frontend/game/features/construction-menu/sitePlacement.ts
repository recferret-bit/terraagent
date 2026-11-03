import { evaluatePlacement, type CompiledDataLike, type PlacementBlock, type PlacementWorld } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { viewPlacementWorld } from '../shared/placementWorld';

/** The host's verdict on a W02 building site, for the construction ghost. */
export interface SiteVerdict {
  valid: boolean;
  reason: string;
  code?: string;
  block?: PlacementBlock;
}

/** The ghost's wording for an Extractor off a metals deposit (the card and the e2e read it). */
export const NO_DEPOSIT_TEXT = 'must cover a metals deposit';

/**
 * The site rule for a Solar / Metals Extractor at `(q, r)` through the one shared `evaluatePlacement` (D-37: the same
 * function the `enqueueTask` build handler runs on the server and the local host): deposits under a Solar, uneven
 * ground, foreign territory, terrain to terraform first, an Extractor without a metals tile. `null` until the view
 * carries complete tiles (terrain, prep, owner): the ghost then has nothing to judge. `world`: the view already adapted
 * (`viewPlacementWorld`), when one caller judges many sites.
 */
export function evaluateSiteWithSim(
  view: GameView | undefined,
  opts: { building: string; q: number; r: number; colonyId: number; data?: CompiledDataLike; fallbackTiles?: ClientTiles | null; world?: PlacementWorld },
): SiteVerdict | null {
  const world = opts.world ?? viewPlacementWorld(view, opts.fallbackTiles);
  if (world.tileCount === 0) return null;
  let res = evaluatePlacement(world, {
    colonyId: opts.colonyId,
    building: opts.building,
    q: Math.trunc(opts.q),
    r: Math.trunc(opts.r),
    requireBuilder: false,
    data: opts.data,
  });
  if (!res.ok && res.block === 'unknownBuilding' && opts.building === 'tradeHub') {
    res = evaluatePlacement(world, {
      colonyId: opts.colonyId,
      building: 'solar',
      q: Math.trunc(opts.q),
      r: Math.trunc(opts.r),
      requireBuilder: false,
      data: opts.data,
    });
  }
  if (res.ok) return { valid: true, reason: 'valid site' };
  const reason = res.block === 'noDeposit' ? NO_DEPOSIT_TEXT : res.text ?? res.code ?? 'blocked';
  return { valid: false, reason, code: res.code, block: res.block };
}

export { ownColonyIndex } from '../shared/colony';
