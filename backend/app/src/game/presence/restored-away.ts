import { restore, type PlanetState } from '@terra/sim';
import { colonyIsAway } from '@terra/sim/systems/away/gate';
import type { PresenceTracker } from './tracker';
import type { PresenceJoin } from './types';

/** Every presence tracker of this process (the WS gateway's), so a restored planet can arm their away timers. */
export const liveTrackers = new Set<Pick<PresenceTracker, 'armSeated'>>();

/**
 * Seated human colonies the restored sim still counts present (`away: false`). Human is the AI sweep's rule: a
 * player's `playerId`, not a Rival AI `ai:` one, not a bot, not eliminated.
 */
export function presentHumanColonies(planetId: string, state: PlanetState): Omit<PresenceJoin, 'socketId'>[] {
  const out: Omit<PresenceJoin, 'socketId'>[] = [];
  for (const c of state.colonies) {
    if (!c || c.status === 'eliminated') continue;
    const row = c as unknown as Record<string, unknown>;
    const playerId = typeof row.playerId === 'string' ? row.playerId : '';
    if (!playerId || playerId.startsWith('ai:') || row.isBot === true || row.isAiColony === true) continue;
    if (colonyIsAway(state, c.index)) continue;
    out.push({ planetId, colonyId: c.id, playerId, colonyIndex: c.index });
  }
  return out;
}

/**
 * After a planet is restored (boot, reclaim, wake), arms the away timer of its present human colonies in every tracker
 * of this process: a player who does not reconnect within `AWAY_AFTER_S` is posted `away` like after any disconnect.
 * Returns the colonies armed.
 */
export async function armRestoredPlanet(
  planets: { fullState(planetId: string, timeoutMs?: number): Promise<{ bytes: Uint8Array }> },
  planetId: string,
  trackers: ReadonlySet<Pick<PresenceTracker, 'armSeated'>> = liveTrackers,
): Promise<number> {
  if (trackers.size === 0) return 0;
  const colonies = presentHumanColonies(planetId, restore((await planets.fullState(planetId, 5_000)).bytes));
  let armed = 0;
  for (const t of trackers) armed += t.armSeated(colonies);
  return armed;
}
