import { ENTITY_KIND, type ViewEntity } from '@terra/sim';
import { hexDistance } from '@terra/sim/grid/hex';
import { forEachEntity } from '../../store/replica/viewCodec';

/** Other living entities inside this many hexes count toward which Trade Hub is busiest. */
const BUSY_RADIUS = 4;

export interface GuildDockSpot {
  readonly q: number;
  readonly r: number;
  readonly hubId: number | null;
  readonly hubQ: number;
  readonly hubR: number;
}

/** Used when the planet has no living Trade Hub yet. One hex is not a hub. */
export const GUILD_DOCK_FALLBACK: GuildDockSpot = { q: 2, r: 0, hubId: null, hubQ: 2, hubR: 0 };

export interface DockHub {
  readonly id: number;
  readonly q: number;
  readonly r: number;
}

/**
 * Dock one step +q from the hub with the most other entities inside {@link BUSY_RADIUS}.
 * A tie goes to the lower entity id so the spot does not flicker.
 */
export function pickBusiestDock(hubs: readonly DockHub[], others: readonly { q: number; r: number }[]): GuildDockSpot {
  if (hubs.length === 0) return GUILD_DOCK_FALLBACK;
  let best = hubs[0]!;
  let bestScore = -1;
  for (const hub of hubs) {
    let score = 0;
    for (const o of others) {
      if (hexDistance(hub.q, hub.r, o.q, o.r) <= BUSY_RADIUS) score += 1;
    }
    if (score > bestScore || (score === bestScore && hub.id < best.id)) {
      best = hub;
      bestScore = score;
    }
  }
  return { q: best.q + 1, r: best.r, hubId: best.id, hubQ: best.q, hubR: best.r };
}

/** Living Trade Hubs on the replica, scored by nearby entities. No view → the fallback spot. */
export function dockSpotFromView(
  view: { entities?: Float32Array | readonly ViewEntity[]; count?: number } | null | undefined,
): GuildDockSpot {
  if (!view?.entities) return GUILD_DOCK_FALLBACK;
  const hubs: DockHub[] = [];
  const others: { q: number; r: number }[] = [];
  forEachEntity(view.entities, view.count, (row) => {
    if (row.hp <= 0) return;
    if (row.kind === ENTITY_KIND.tradeHub) hubs.push({ id: row.id, q: row.q, r: row.r });
    else others.push({ q: row.q, r: row.r });
  });
  return pickBusiestDock(hubs, others);
}
