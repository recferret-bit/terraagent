/**
 * Per-player command rate limit for the WebSocket ingress: a token bucket of `burst` commands refilled at `perSecond`.
 * A human player issues a few commands per second at most; scripted spam is cut off before it reaches validation, the
 * colony lookup or a planet thread. The sim already bounds the work per unit (one live path request), this bounds the
 * work per socket.
 */
export interface CommandRateLimitOptions {
  perSecond?: number;
  burst?: number;
  now?: () => number;
}

export const DEFAULT_COMMANDS_PER_SECOND = 20;
export const DEFAULT_COMMAND_BURST = 40;
const IDLE_FORGET_MS = 60_000;

interface Bucket { tokens: number; at: number }

export class CommandRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly perMs: number;
  private readonly burst: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(o: CommandRateLimitOptions = {}) {
    this.perMs = (o.perSecond ?? DEFAULT_COMMANDS_PER_SECOND) / 1000;
    this.burst = o.burst ?? DEFAULT_COMMAND_BURST;
    this.now = o.now ?? (() => performance.now()); // monotonic: a wall-clock step back must not starve a bucket
  }

  /** Spends one token of `key`'s bucket; false when it is empty (the command is rejected `rate_limited`). */
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

  /** Forgets players idle for a minute (their bucket would be full again anyway). */
  private sweep(now: number): void {
    if (now - this.lastSweep < IDLE_FORGET_MS) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (now - b.at > IDLE_FORGET_MS) this.buckets.delete(k);
  }
}
