/**
 * Process-local digest row total. `seed` is one boot `COUNT(*)`. `add` tracks later inserts and purges.
 * Callers run seed and add inside `exclusive` so the count cannot race a write.
 */
export class DigestRowTally {
  private total = 0;
  private warmed = false;
  private tail: Promise<void> = Promise.resolve();

  value(): number {
    return this.total;
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  seed(total: number): void {
    this.total = Math.max(0, total);
    this.warmed = true;
  }

  add(delta: number): void {
    this.total = Math.max(0, this.total + delta);
  }

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
