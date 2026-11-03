import { getFootprintTileIndices, PREP, setTilePrep, spawnHqUnit, type PlanetState } from '../../src';

/**
 * W02 builds progress only while a builder works them on site (W02-16). For specs about payment and queue timing rather
 * than walking or site prep: prepares the 2×2 footprints of `sites` and puts colony `owner`'s HQ at `hq` (default the
 * origin, within the HQ's build reach [2, 3] of a site at `(2, 1)`), so the first build advances from its first step.
 * Returns the HQ's entity id.
 */
export function readyBuilder(state: PlanetState, sites: ReadonlyArray<{ q: number; r: number }>, hq = { q: 0, r: 0 }, owner = 0): number {
  for (const s of sites) for (const i of getFootprintTileIndices(state, s.q, s.r, 2, 2).indices) setTilePrep(state.grid, i, PREP.prepared);
  return spawnHqUnit(state, { owner, q: hq.q, r: hq.r });
}
