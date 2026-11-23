import type { PresenceClock, PresenceLog } from './types';

/** How often a planet with a human socket refreshes its persisted clock (well under any idle threshold). */
export const PLANET_SEEN_HEARTBEAT_MS = 10 * 60_000;

/** Where "a human is on this planet" is persisted (`PlanetActivityStore.touch`). */
export interface PlanetSeenSink {
  touch(planetId: string, at: Date): Promise<void>;
}

/**
 * Keeps `world.planet_activity.last_human_seen_at` (3.5) current from the process that holds the sockets: stamped when
 * the first human socket joins a planet, every {@link PLANET_SEEN_HEARTBEAT_MS} while any stays, and when the last one
 * leaves. Spectators are not tracked here. A crashed process stops the heartbeat, so the clock is at most one beat old.
 */
export class PlanetSeenWriter {
  private readonly beats = new Map<string, () => void>();

  constructor(
    private readonly sink: PlanetSeenSink,
    private readonly clock: PresenceClock,
    private readonly log?: PresenceLog,
    private readonly heartbeatMs = PLANET_SEEN_HEARTBEAT_MS,
  ) {}

  /** A human socket is on `planetId` (repeat calls while occupied do nothing). */
  occupied(planetId: string): void {
    if (this.beats.has(planetId)) return;
    this.stamp(planetId);
    this.arm(planetId);
  }

  /** The last human socket left `planetId`. */
  empty(planetId: string): void {
    const cancel = this.beats.get(planetId);
    if (!cancel) return;
    cancel();
    this.beats.delete(planetId);
    this.stamp(planetId);
  }

  stop(): void {
    for (const cancel of this.beats.values()) cancel();
    this.beats.clear();
  }

  private arm(planetId: string): void {
    this.beats.set(planetId, this.clock.delay(this.heartbeatMs, () => {
      if (!this.beats.has(planetId)) return;
      this.stamp(planetId);
      this.arm(planetId);
    }));
  }

  private stamp(planetId: string): void {
    void this.sink.touch(planetId, new Date(this.clock.now())).catch((err: unknown) => {
      this.log?.warn({ planetId, err: err instanceof Error ? err.message : String(err) }, 'planet last-seen not stored');
    });
  }
}
