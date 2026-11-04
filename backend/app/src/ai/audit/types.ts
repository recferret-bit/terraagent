import type { DirectorPolicyV1 } from '@terra/contracts';

/**
 * Columns of `ai.director_policy`, `ai.director_context` and `ai.director_decision` this port uses.
 * Attempt, proposal and action-result tables are not written here. Expiry times are epoch milliseconds
 * (`expires_at` is timestamptz in Prisma).
 */

/** Durable player policy. One row per colony. Expiry never deletes it (AI §10). */
export interface DirectorPolicyRecord {
  readonly colonyId: string;
  readonly planetId: string;
  readonly revision: number;
  /** JSON document. `readPolicy` parses it with `DirectorPolicyV1Schema`. */
  readonly document: unknown;
}

export interface DirectorPolicyRead {
  readonly colonyId: string;
  readonly planetId: string;
  /** `director_policy.revision`. Matches `policy.revision` after `savePolicy`. */
  readonly revision: number;
  readonly policy: DirectorPolicyV1;
}

export interface SaveDirectorContext {
  readonly id: string;
  readonly colonyId: string;
  readonly epoch: number;
  readonly revision: number;
  readonly document: unknown;
  readonly expiresAtMs: number;
}

/** Short-lived brief snapshot (`ai.director_context`). */
export interface DirectorContextRecord {
  readonly id: string;
  readonly colonyId: string;
  readonly epoch: number;
  readonly revision: number;
  /** UTF-8 byte length of the stored JSON (`director_context.bytes`). */
  readonly bytes: number;
  readonly document: unknown;
  readonly expiresAtMs: number;
}

export interface SaveDirectorDecision {
  readonly id: string;
  readonly colonyId: string;
  readonly outcome: string;
  readonly summary: string;
  readonly expiresAtMs: number;
}

/** Decision audit (`ai.director_decision`). No raw prompt. `request_id` stays unset until worker wiring. */
export interface DirectorDecisionRecord {
  readonly id: string;
  readonly colonyId: string;
  readonly outcome: string;
  readonly summary: string;
  readonly expiresAtMs: number;
}

export interface DirectorExpireCounts {
  readonly contexts: number;
  readonly decisions: number;
}

/** Rows whose `expiresAtMs` has arrived. These are the rows to delete. */
export interface DirectorRowsToDelete {
  readonly contexts: readonly DirectorContextRecord[];
  readonly decisions: readonly DirectorDecisionRecord[];
}

/** Persistence port. `MemoryDirectorAudit` is the in-memory implementation; Prisma uses the same shape later. */
export interface DirectorAuditPort {
  savePolicy(colonyId: string, planetId: string, policy: DirectorPolicyV1): void;
  readPolicy(colonyId: string): DirectorPolicyRead | null;
  saveContext(input: SaveDirectorContext): void;
  saveDecision(input: SaveDirectorDecision): void;
  expire(nowMs: number): DirectorExpireCounts;
}
