/** Briefly retain events that arrive before the shooter's mesh has been created. */
export class PendingCombatShots {
  private jobs = new Map<string, { age: number; run: () => boolean }>();
  hold(key: string, run: () => boolean): void {
    if (!this.jobs.has(key)) this.jobs.set(key, { age: 0, run });
    if (this.jobs.size > 128) this.jobs.delete(this.jobs.keys().next().value!);
  }
  update(dt: number): void {
    for (const [key, job] of this.jobs) {
      job.age += dt;
      if (job.run() || job.age > 2) this.jobs.delete(key);
    }
  }
  clear(): void { this.jobs.clear(); }
}
