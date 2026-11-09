import { DirectorPolicyV1Schema, type DirectorPolicyV1 } from '@terra/contracts';
import { partitionExpired } from './expire.js';
import type {
  DirectorAuditPort,
  DirectorContextRecord,
  DirectorDecisionRecord,
  DirectorExpireCounts,
  DirectorPolicyRead,
  DirectorPolicyRecord,
  SaveDirectorContext,
  SaveDirectorDecision,
} from './types.js';

/**
 * In-memory director audit (AI §10). Does not open a database.
 * The Prisma repository is the same `DirectorAuditPort` once W16 worker wiring lands.
 */
export class MemoryDirectorAudit implements DirectorAuditPort {
  private readonly policies = new Map<string, DirectorPolicyRecord>();
  private readonly contexts = new Map<string, DirectorContextRecord>();
  private readonly decisions = new Map<string, DirectorDecisionRecord>();

  savePolicy(colonyId: string, planetId: string, policy: DirectorPolicyV1): void {
    const parsed = DirectorPolicyV1Schema.parse(policy);
    this.policies.set(colonyId, {
      colonyId,
      planetId,
      revision: parsed.revision,
      document: jsonClone(parsed),
    });
  }

  /** Parsed policy, or null when the colony has none. Corrupt JSON throws. */
  readPolicy(colonyId: string): DirectorPolicyRead | null {
    const row = this.policies.get(colonyId);
    if (!row) return null;
    const policy = DirectorPolicyV1Schema.parse(row.document);
    return { colonyId: row.colonyId, planetId: row.planetId, revision: row.revision, policy };
  }

  /** Test hook: store a policy document without schema checks so `readPolicy` can reject it. */
  loadUnchecked(colonyId: string, document: unknown): void {
    const prev = this.policies.get(colonyId);
    this.policies.set(colonyId, {
      colonyId,
      planetId: prev?.planetId ?? 'unchecked',
      revision: prev?.revision ?? 0,
      document,
    });
  }

  saveContext(input: SaveDirectorContext): void {
    const document = jsonClone(input.document);
    this.contexts.set(input.id, {
      id: input.id,
      colonyId: input.colonyId,
      epoch: input.epoch,
      revision: input.revision,
      bytes: jsonBytes(document),
      document,
      expiresAtMs: input.expiresAtMs,
    });
  }

  saveDecision(input: SaveDirectorDecision): void {
    this.decisions.set(input.id, {
      id: input.id,
      colonyId: input.colonyId,
      outcome: input.outcome,
      summary: input.summary,
      expiresAtMs: input.expiresAtMs,
    });
  }

  context(id: string): DirectorContextRecord | undefined {
    return this.contexts.get(id);
  }

  decision(id: string): DirectorDecisionRecord | undefined {
    return this.decisions.get(id);
  }

  /** Deletes expired context and decision rows only. Policy remains. */
  expire(nowMs: number): DirectorExpireCounts {
    const doomed = partitionExpired(nowMs, [...this.contexts.values()], [...this.decisions.values()]);
    for (const row of doomed.contexts) this.contexts.delete(row.id);
    for (const row of doomed.decisions) this.decisions.delete(row.id);
    return { contexts: doomed.contexts.length, decisions: doomed.decisions.length };
  }
}

function jsonClone(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('director audit document must be JSON');
  return JSON.parse(encoded) as unknown;
}

function jsonBytes(document: unknown): number {
  return Buffer.byteLength(JSON.stringify(document), 'utf8');
}
