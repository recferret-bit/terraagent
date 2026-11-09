/** Reconciles event deaths with snapshot health, including prediction rollback. */
export class CombatHealthTracker {
  readonly hp = new Map<number, number>();
  readonly deaths = new Set<number>();
  private known = new Set<number>();
  private deathTicks = new Map<number, number>();

  constructor(private readonly die: (id: number) => void, private readonly revive: (id: number) => void) {}

  dead(id: number, tick: number): void {
    this.deaths.add(id);
    const latestTick = Math.max(tick, this.deathTicks.get(id) ?? -1);
    this.deathTicks.delete(id);
    this.deathTicks.set(id, latestTick);
    this.hp.set(id, 0);
    this.die(id);
    // Keep recent death protection bounded; living health is never evicted.
    if (this.deathTicks.size > 2048) {
      const oldest = this.deathTicks.keys().next().value!;
      this.deathTicks.delete(oldest);
      this.deaths.delete(oldest);
      this.hp.delete(oldest);
    }
  }

  sync(tick: number, visit: (accept: (id: number, hp: number) => void) => void): void {
    const alive = new Set<number>();
    visit((id, hp) => {
      if (hp <= 0) { this.dead(id, tick); return; }
      alive.add(id);
      // A preceding view must not undo a newer death event. A same/newer positive snapshot can correct prediction.
      if (tick < (this.deathTicks.get(id) ?? -1)) return;
      this.hp.set(id, hp);
      if (this.deaths.delete(id)) {
        this.deathTicks.delete(id);
        this.revive(id);
      }
    });
    for (const id of this.known) if (!alive.has(id)) this.dead(id, tick);
    this.known = alive;
  }

  clear(): void { this.hp.clear(); this.deaths.clear(); this.known.clear(); this.deathTicks.clear(); }
}
