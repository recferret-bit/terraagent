import { TokenBucketLimiter } from '../core/token-bucket';

/**
 * Per-player command rate limit for the WebSocket ingress: a token bucket of `burst` commands refilled at `perSecond`,
 * shared by all of a player's sockets and planets. A human player issues a few commands per second at most; scripted
 * spam is cut off before it reaches validation, the colony lookup or a planet thread (PROTOCOL WS-16 / §10).
 */
export interface CommandRateLimitOptions {
  perSecond?: number;
  burst?: number;
  now?: () => number;
}

export const DEFAULT_COMMANDS_PER_SECOND = 20;
export const DEFAULT_COMMAND_BURST = 40;

export class CommandRateLimiter extends TokenBucketLimiter {
  constructor(o: CommandRateLimitOptions = {}) {
    super({ perSecond: o.perSecond ?? DEFAULT_COMMANDS_PER_SECOND, burst: o.burst ?? DEFAULT_COMMAND_BURST, now: o.now });
  }
}
