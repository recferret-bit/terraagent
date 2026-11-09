import type { SimCommandV1 } from '@terra/contracts';

/** Wall clock the tracker reads. Tests pass a manual clock; production uses `Date` / `setTimeout`. */
export interface PresenceClock {
  now(): number;
  /** Fires `fn` once after `ms`. The return value cancels it. */
  delay(ms: number, fn: () => void): () => void;
}

export interface PresenceJoin {
  readonly socketId: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly playerId: string;
  readonly colonyIndex?: number;
}

export interface PresenceCommandPort {
  submit(planetId: string, cmd: SimCommandV1): Promise<{ ok: boolean; code?: string }>;
}

export interface LastSeenTouch {
  readonly colonyId: string;
  readonly playerId: string;
  readonly at: Date;
  readonly colonyIndex?: number;
}

export interface LastSeenPort {
  /** Stamps `core.colony` / `core.player`. Returns the colony index when the row has one. Never throws. */
  touch(input: LastSeenTouch): Promise<{ colonyIndex?: number }>;
}

export interface PresenceLog {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export const noopLastSeen: LastSeenPort = {
  async touch(input) {
    return { colonyIndex: input.colonyIndex };
  },
};
