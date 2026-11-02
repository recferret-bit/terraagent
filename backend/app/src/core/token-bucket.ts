export interface TokenBucketOptions {
  /** Tokens refilled per second. */
  readonly perSecond: number;
  /** Bucket size (the burst a fresh key may spend at once). */
  readonly burst: number;
  readonly now?: () => number;
}

const IDLE_FORGET_MS = 60_000;

interface Bucket { tokens: number; at: number }

/** Keyed token buckets (per player, per IP): `take(key)` spends one token, false when the key's bucket is empty. */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly perMs: number;
  private readonly burst: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(o: TokenBucketOptions) {
    this.perMs = o.perSecond / 1000;
    this.burst = o.burst;
    this.now = o.now ?? (() => performance.now()); // monotonic: a wall-clock step back must not starve a bucket
  }

  /** Spends one token of `key`'s bucket; false when it is empty. */
  take(key: string): boolean {
    const now = this.now();
    this.sweep(now);
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + Math.max(0, now - b.at) * this.perMs);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Forgets keys idle for a minute whose bucket is full again anyway. */
  private sweep(now: number): void {
    if (now - this.lastSweep < IDLE_FORGET_MS) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (Math.min(this.burst, b.tokens + (now - b.at) * this.perMs) >= this.burst) this.buckets.delete(k);
  }
}
