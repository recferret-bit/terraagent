import { allModules, buildPipeline, mergeOverrides, type SimModule } from '@terra/sim';
import type { PlanetCarry } from '../protocol';
import type { Planet } from './planet-host-ops';

/** What a planet keeps on its thread beyond the snapshot, for a move (`unload { handoff }` -> `load { moved }`). */
export function carryOf(p: Planet): PlanetCarry {
  return {
    feedSeq: p.feedSeq,
    lastSectorSyncTick: p.lastSectorSyncTick,
    lastInputTickByColony: [...p.lastInputTickByColony],
    seenAutopilotTickByColony: [...p.seenAutopilotTickByColony],
    ...(Object.keys(p.tuning.live).length ? { live: p.tuning.live } : {}),
    ...(p.pendingProfile ? { pendingProfile: p.pendingProfile } : {}),
  };
}

/**
 * Re-seeds a moved planet on its new thread: feed counters (no duplicate feed items), dev live tunes (the pipeline is
 * rebuilt from base ⊕ live, as `tune` does) and an economy profile still waiting for its tick.
 */
export function applyCarry(p: Planet, c: PlanetCarry, extraModules: readonly SimModule[] | undefined): void {
  p.feedSeq = c.feedSeq;
  p.lastSectorSyncTick = c.lastSectorSyncTick;
  p.lastInputTickByColony = new Map(c.lastInputTickByColony);
  p.seenAutopilotTickByColony = new Map(c.seenAutopilotTickByColony);
  if (c.pendingProfile) p.pendingProfile = c.pendingProfile;
  if (!c.live) return;
  p.tuning.live = c.live;
  p.pipeline = buildPipeline(p.tuning.flags, mergeOverrides(p.tuning.base, c.live), extraModules ? [...allModules(), ...extraModules] : undefined, 'authority_external_bots');
}
