import type { PresenceClock } from './types';

interface Timer {
  at: number;
  fn: () => void;
  dead: boolean;
}

/** Production clock. Timers are unref'd so a quiet process can exit. */
export class SystemPresenceClock implements PresenceClock {
  now(): number {
    return Date.now();
  }

  delay(ms: number, fn: () => void): () => void {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  }
}

/**
 * Injected clock for tests. `advance` fires every timer whose deadline is <= the new time,
 * in deadline order, with `now()` equal to that deadline. A deadline of exactly `AWAY_AFTER_S` fires.
 */
export class ManualPresenceClock implements PresenceClock {
  nowMs = 0;
  private readonly items: Timer[] = [];

  now(): number {
    return this.nowMs;
  }

  delay(ms: number, fn: () => void): () => void {
    const item: Timer = { at: this.nowMs + ms, fn, dead: false };
    this.items.push(item);
    return () => {
      item.dead = true;
    };
  }

  advance(ms: number): void {
    const end = this.nowMs + ms;
    for (;;) {
      const next = this.soonest(end);
      if (!next) break;
      this.nowMs = next.at;
      next.dead = true;
      next.fn();
    }
    this.nowMs = end;
  }

  /** Runs the soonest live timer twice without consuming it. Duplicate fire must stay one event. */
  fireSoonestTwice(): void {
    const next = this.soonest(Number.POSITIVE_INFINITY);
    if (!next) throw new Error('no presence timer');
    this.nowMs = next.at;
    next.fn();
    next.fn();
    next.dead = true;
  }

  private soonest(end: number): Timer | undefined {
    return this.items.filter((item) => !item.dead && item.at <= end).sort((a, b) => a.at - b.at)[0];
  }
}
