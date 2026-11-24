import type { PrismaClient } from '@terra/db';
import type { PlanetState } from '@terra/sim';
import { colonyIsAway } from '@terra/sim/systems/away/gate';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import { colonyPresence, type MemoryPresence } from '../../notify/presence.js';

/** A planet with no human for this long is swept on rules only (no LLM call, no managed charge). */
export const IDLE_PLANET_AFTER_MS = 24 * 3_600_000;

/** Injected predicate of the background sweep: was a human on `planetId` within the idle window? */
export interface PlanetActivity {
  recentlyActive(planetId: string, nowMs: number): Promise<boolean> | boolean;
  /** The sweep saw a connected human on the planet right now. */
  noteHumanPresent?(planetId: string, nowMs: number): void;
}

/**
 * A seated human colony (a player's `playerId`, not a Rival AI `ai:` one, not an empty slot) with a socket connected
 * right now: the sim does not count it away (the presence tracker posts `away` 60 s after the last socket closes), or
 * this process holds its socket (covers a stale `away` flag after a restart).
 */
export function humanConnectedNow(state: PlanetState, sockets: Pick<MemoryPresence, 'isConnected'> = colonyPresence): boolean {
  return state.colonies.some((c) => {
    if (!c || c.status === 'eliminated') return false;
    const row = c as unknown as Record<string, unknown>;
    const playerId = typeof row.playerId === 'string' ? row.playerId : '';
    if (!playerId || playerId.startsWith('ai:') || row.isBot === true || row.isAiColony === true) return false;
    return sockets.isConnected(c.id) || !colonyIsAway(state, c.index);
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

/** The persisted "last human on this planet" clock (`world.planet_activity`, written by the process that holds the sockets). */
export interface PlanetSeenClock {
  get(planetId: string): Promise<{ readonly lastHumanSeenAt: Date } | null>;
}

/** How long a "nobody was here" answer is reused before the clock is read again. */
export const IDLE_ANSWER_TTL_MS = 60_000;

/**
 * `inner` first (this process's memory, then `core.colony.last_seen_at`), then the planet clock the idle unload also
 * uses. One definition of "a human was here in the window" for both features, and it holds when another process owns
 * the sockets. A "no" is reused for {@link IDLE_ANSWER_TTL_MS}, so an idle planet costs one read a minute, not one a sweep.
 */
export function withPlanetClock(inner: PlanetActivity, clock: PlanetSeenClock, windowMs: number = IDLE_PLANET_AFTER_MS): PlanetActivity {
  const idleUntil = new Map<string, number>();
  return {
    noteHumanPresent(planetId, nowMs) {
      idleUntil.delete(planetId);
      inner.noteHumanPresent?.(planetId, nowMs);
    },
    async recentlyActive(planetId, nowMs) {
      if ((idleUntil.get(planetId) ?? 0) > nowMs) return false;
      if (await inner.recentlyActive(planetId, nowMs)) return true;
      const row = await clock.get(planetId).catch(() => null);
      if (row && nowMs - row.lastHumanSeenAt.getTime() < windowMs) return true;
      idleUntil.set(planetId, nowMs + IDLE_ANSWER_TTL_MS);
      return false;
    },
  };
}
