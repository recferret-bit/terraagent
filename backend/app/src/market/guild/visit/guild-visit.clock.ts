/**
 * Per-planet guild clock. Unpinned planets read the wall clock.
 * `warpTo` pins a planet at an absolute instant so a test can step two visits without waiting.
 * A pin does not keep running: the next read stays on that instant until the next `warpTo`.
 */
export class GuildVisitClock {
  private readonly pinned = new Map<string, number>();

  now(planetId: string): number {
    return this.pinned.get(planetId) ?? Date.now();
  }

  warpTo(planetId: string, ms: number): void {
    this.pinned.set(planetId, ms);
  }
}
