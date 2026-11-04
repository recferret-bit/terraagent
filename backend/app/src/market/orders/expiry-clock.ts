import { Injectable } from '@nestjs/common';

interface Segment {
  readonly fromMs: number;
  readonly k: number;
}

/**
 * Planet game time for TTLs (W13-15). A dev time warp (`warp k`) runs `k` engine steps per tick slot, so game time passes
 * `k` times faster than the wall clock. Orders store only wall-clock `createdAt`/`ttlS` (no migration), so the clock keeps
 * the piecewise-constant warp history of this process (warps are in-memory and reset on restart, so "k = 1 before the
 * first record" is exact) and integrates it: `gameMsBetween(planet, from, to)` = Σ k × wall ms.
 */
@Injectable()
export class PlanetGameClock {
  private readonly history = new Map<string, Segment[]>();

  /** Records the effective warp of a planet from `atMs` on. */
  record(planetId: string, k: number, atMs: number = Date.now()): void {
    const segs = this.history.get(planetId) ?? [];
    const last = segs[segs.length - 1];
    if (last && last.k === k) return;
    segs.push({ fromMs: atMs, k });
    this.history.set(planetId, segs);
  }

  /** Planets that ever had a warp recorded (a candidate for early expiry). */
  warpedPlanets(): string[] {
    return [...this.history].filter(([, s]) => s.some((x) => x.k > 1)).map(([id]) => id);
  }

  gameMsBetween(planetId: string, fromMs: number, toMs: number): number {
    if (toMs <= fromMs) return 0;
    const segs = this.history.get(planetId) ?? [];
    let total = 0;
    let cursor = fromMs;
    let k = 1;
    for (const s of segs) {
      if (s.fromMs <= cursor) { k = s.k; continue; }
      if (s.fromMs >= toMs) break;
      total += (s.fromMs - cursor) * k;
      cursor = s.fromMs;
      k = s.k;
    }
    return total + (toMs - cursor) * k;
  }
}
