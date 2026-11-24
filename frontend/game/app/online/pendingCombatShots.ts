/** Briefly retain events that arrive before the shooter's mesh has been created or turret finishes slewing. */
export class PendingCombatShots {
  private jobs = new Map<string, { age: number; run: (age: number) => boolean }>();
  has(key: string): boolean { return this.jobs.has(key); }
  hold(key: string, run: (age: number) => boolean): void {
    if (!this.jobs.has(key)) this.jobs.set(key, { age: 0, run });
    if (this.jobs.size > 128) this.jobs.delete(this.jobs.keys().next().value!);
  }
  update(dt: number): void {
    for (const [key, job] of this.jobs) {
      job.age += dt;
      if (job.run(job.age) || job.age > 4) this.jobs.delete(key);
    }
  }
  clear(): void { this.jobs.clear(); }
}
