import type { PrismaClient } from '@terra/db';
import type { PlanetState } from '@terra/sim';
import { colonyIsAway } from '@terra/sim/systems/away/gate';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';

/** A planet with no human for this long is swept on rules only (no LLM call, no managed charge). */
export const IDLE_PLANET_AFTER_MS = 24 * 3_600_000;

/** Injected predicate of the background sweep: was a human on `planetId` within the idle window? */
export interface PlanetActivity {
  recentlyActive(planetId: string, nowMs: number): Promise<boolean> | boolean;
  /** The sweep saw a connected human on the planet right now. */
  noteHumanPresent?(planetId: string, nowMs: number): void;
}

/**
 * A seated human colony (not a Rival AI, not an empty slot) whose player the sim does not count as away: a socket is
 * connected right now (the presence tracker posts `away` 60 s after the last one closes).
 */
export function humanConnectedNow(state: PlanetState): boolean {
  return state.colonies.some((c) => {
    if (!c || c.status === 'eliminated') return false;
    const row = c as unknown as Record<string, unknown>;
    if (row.isBot === true || row.isAiColony === true || String(row.playerId ?? '').startsWith('ai:')) return false;
    const seated = typeof row.playerId === 'string' || row.foundedAtTick !== undefined;
    return seated && !colonyIsAway(state, c.index);
  });
}

/**
 * Default activity source. "Seen now" comes from the sweep itself (a human colony on manual control, or governed
 * and not away), remembered per planet; across restarts `core.colony.last_seen_at` (written by the presence tracker
 * on every away / back transition) covers the rest of the 24 h window. No database: memory only.
 */
export class PlanetHumanActivity implements PlanetActivity {
  private readonly seenAt = new Map<string, number>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly env?: AppEnv,
    private readonly windowMs: number = IDLE_PLANET_AFTER_MS,
  ) {}

  noteHumanPresent(planetId: string, nowMs: number): void {
    this.seenAt.set(planetId, nowMs);
  }

  async recentlyActive(planetId: string, nowMs: number): Promise<boolean> {
    const seen = this.seenAt.get(planetId);
    if (seen !== undefined && nowMs - seen < this.windowMs) return true;
    const db = this.prisma && databaseEnabled(this.env) ? this.prisma : undefined;
    if (!db || typeof db.colony?.findFirst !== 'function') return false;
    try {
      const row = await db.colony.findFirst({
        where: { planetId, lastSeenAt: { gte: new Date(nowMs - this.windowMs) } },
        select: { lastSeenAt: true },
      });
      if (row?.lastSeenAt) this.seenAt.set(planetId, row.lastSeenAt.getTime());
      return Boolean(row);
    } catch {
      return false;
    }
  }
}
