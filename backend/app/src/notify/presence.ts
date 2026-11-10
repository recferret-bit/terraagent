/**
 * Whether a colony currently has a connected player socket (CT-38).
 * The 60s away timer is W09-02; this set only answers "a socket is held".
 */
export interface PresenceQuery {
  isConnected(colonyId: string): boolean | Promise<boolean>;
}

/** Nest token for {@link PresenceQuery}. The default value is {@link colonyPresence}. */
export const PRESENCE = Symbol('PRESENCE');

/** In-memory refcount of open colony sockets. Each socket releases only the hold it took. */
export class MemoryPresence implements PresenceQuery {
  private readonly counts = new Map<string, number>();

  connect(colonyId: string): void {
    this.counts.set(colonyId, (this.counts.get(colonyId) ?? 0) + 1);
  }

  disconnect(colonyId: string): void {
    const n = this.counts.get(colonyId) ?? 0;
    if (n <= 1) this.counts.delete(colonyId);
    else this.counts.set(colonyId, n - 1);
  }

  isConnected(colonyId: string): boolean {
    return this.counts.has(colonyId);
  }

  isAway(colonyId: string): boolean {
    return !this.counts.has(colonyId);
  }

  setAway(colonyId: string, away: boolean): void {
    if (away) this.counts.delete(colonyId);
    else if (!this.counts.has(colonyId)) this.counts.set(colonyId, 1);
  }

  clear(): void {
    this.counts.clear();
  }
}

export { MemoryPresence as ColonyPresenceRegistry };

/** Process-wide set. Tests and the socket writer share it until W09-02 replaces the writer. */
export const colonyPresence = new MemoryPresence();
