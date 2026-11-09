import { DirectorPolicyV1Schema, type DirectorActionState, type DirectorPolicyV1 } from '@terra/contracts';
import type { Prisma, PrismaClient } from '@terra/db';
import type { ProposalAccept } from './outbox.js';
import type {
  DirectorContextRecord,
  DirectorDecisionRecord,
  DirectorExpireCounts,
  DirectorPolicyRead,
  SaveDirectorContext,
  SaveDirectorDecision,
} from './types.js';

export interface DurableProposalSubmit {
  readonly requestId: string;
  readonly jobId: string;
  readonly colonyId: string;
  readonly fence: number;
  readonly epoch: number;
  readonly intentRevision: number;
  readonly permissionRevision?: number;
  readonly actions: readonly {
    readonly actionId: string;
    readonly state?: DirectorActionState;
    readonly reason?: string;
    readonly [k: string]: unknown;
  }[];
}

export interface DurableAttemptInput {
  readonly id: string;
  readonly jobId: string;
  readonly colonyId: string;
  readonly model: string;
  readonly day: string;
  readonly reservedTokens: number;
  readonly dailyCap: number;
}

/**
 * PostgreSQL repository for the W16 `ai.*` schema (`shared/db/prisma/ai.prisma`).
 * Persists durable policy, expiring contexts/decisions, fenced proposal outbox & action results,
 * reservation-ID token budgets, and scoped kill switches (AI §7, §10, W16-15, W16-44).
 */
export class PrismaDirectorStore {
  constructor(private readonly prisma: PrismaClient) {}

  async savePolicy(colonyId: string, planetId: string, policy: DirectorPolicyV1): Promise<void> {
    const parsed = DirectorPolicyV1Schema.parse(policy);
    const document = JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue;
    await this.prisma.directorPolicyRecord.upsert({
      where: { colonyId },
      create: { colonyId, planetId, revision: parsed.revision, document },
      update: { planetId, revision: parsed.revision, document },
    });
  }

  async readPolicy(colonyId: string): Promise<DirectorPolicyRead | null> {
    const row = await this.prisma.directorPolicyRecord.findUnique({ where: { colonyId } });
    if (!row) return null;
    const policy = DirectorPolicyV1Schema.parse(row.document);
    return { colonyId: row.colonyId, planetId: row.planetId, revision: row.revision, policy };
  }

  async saveContext(input: SaveDirectorContext): Promise<DirectorContextRecord> {
    const raw = JSON.stringify(input.document);
    if (raw === undefined) throw new Error('director context document must be JSON');
    const bytes = Buffer.byteLength(raw, 'utf8');
    const document = JSON.parse(raw) as Prisma.InputJsonValue;
    const row = await this.prisma.directorContextSnapshot.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        colonyId: input.colonyId,
        epoch: input.epoch,
        revision: input.revision,
        bytes,
        document,
        expiresAt: new Date(input.expiresAtMs),
      },
      update: {
        epoch: input.epoch,
        revision: input.revision,
        bytes,
        document,
        expiresAt: new Date(input.expiresAtMs),
      },
    });
    return {
      id: row.id,
      colonyId: row.colonyId,
      epoch: row.epoch,
      revision: row.revision,
      bytes: row.bytes,
      document: row.document,
      expiresAtMs: row.expiresAt.getTime(),
    };
  }

  async saveDecision(input: SaveDirectorDecision & { readonly requestId?: string }): Promise<DirectorDecisionRecord> {
    const row = await this.prisma.directorDecision.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        colonyId: input.colonyId,
        requestId: input.requestId ?? null,
        outcome: input.outcome,
        summary: input.summary,
        expiresAt: new Date(input.expiresAtMs),
      },
      update: {
        outcome: input.outcome,
        summary: input.summary,
        expiresAt: new Date(input.expiresAtMs),
      },
    });
    return {
      id: row.id,
      colonyId: row.colonyId,
      outcome: row.outcome,
      summary: row.summary,
      expiresAtMs: row.expiresAt.getTime(),
    };
  }

  /** Deletes expired context and decision rows while keeping `director_policy` intact (W16-15, AI-06). */
  async expire(nowMs: number): Promise<DirectorExpireCounts> {
    const cutoff = new Date(nowMs);
    const [contexts, decisions] = await this.prisma.$transaction([
      this.prisma.directorContextSnapshot.deleteMany({ where: { expiresAt: { lte: cutoff } } }),
      this.prisma.directorDecision.deleteMany({ where: { expiresAt: { lte: cutoff } } }),
    ]);
    return { contexts: contexts.count, decisions: decisions.count };
  }

  /**
   * Atomically accepts a proposal into `ai.director_proposal` and `ai.director_action_result` (W16-12, AI-07).
   * Dedupes duplicate `requestId` deliveries and rejects stale fences or older intent revisions.
   */
  async acceptProposal(input: DurableProposalSubmit, minIntentRevision = 0): Promise<ProposalAccept> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.colonyId}))`;
      const existing = await tx.directorProposal.findUnique({ where: { requestId: input.requestId } });
      if (existing) return { ok: true, duplicate: true };

      const prior = await tx.directorProposal.findMany({
        where: { colonyId: input.colonyId },
        select: { fence: true, intentRevision: true },
      });
      const maxFence = prior.reduce((m, r) => Math.max(m, r.fence), -1);
      const maxIntent = prior.reduce((m, r) => Math.max(m, r.intentRevision), minIntentRevision);
      if (input.fence < maxFence || input.intentRevision < maxIntent) {
        return { ok: false, outcome: 'superseded' };
      }

      const conflictFence = await tx.directorProposal.findUnique({
        where: { jobId_fence: { jobId: input.jobId, fence: input.fence } },
      });
      if (conflictFence) return { ok: false, outcome: 'superseded' };

      const doc = JSON.parse(JSON.stringify(input.actions)) as Prisma.InputJsonValue;
      await tx.directorProposal.create({
        data: {
          requestId: input.requestId,
          jobId: input.jobId,
          colonyId: input.colonyId,
          fence: input.fence,
          epoch: input.epoch,
          intentRevision: input.intentRevision,
          permissionRevision: input.permissionRevision ?? 0,
          status: 'accepted',
          document: doc,
        },
      });

      if (input.actions.length > 0) {
        await tx.directorActionResult.createMany({
          data: input.actions.map((act) => ({
            id: `${input.requestId}:${act.actionId}`,
            requestId: input.requestId,
            actionId: act.actionId,
            colonyId: input.colonyId,
            state: act.state ?? 'proposed',
            reason: act.reason ?? null,
          })),
        });
      }
      return { ok: true };
    });
  }

  /**
   * Reserves tokens for a provider attempt in a single database transaction (W16-08, W16-44, AI-09).
   * Concurrent workers racing on the same UTC day cannot exceed `dailyCap`.
   */
  async reserveAttemptBudget(
    input: DurableAttemptInput,
  ): Promise<{ ok: true } | { ok: false; outcome: 'budget_exhausted' }> {
    if (!Number.isFinite(input.reservedTokens) || input.reservedTokens < 0) {
      return { ok: false, outcome: 'budget_exhausted' };
    }
    const dayId = `global:${input.day}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "ai"."director_budget_day" ("id", "day", "reserved_tokens", "spent_tokens", "requests")
        VALUES (${dayId}, ${input.day}, 0, 0, 0)
        ON CONFLICT ("id") DO NOTHING
      `;
      const rows = await tx.$queryRaw<
        { reserved_tokens: number; spent_tokens: number }[]
      >`SELECT "reserved_tokens", "spent_tokens" FROM "ai"."director_budget_day" WHERE "id" = ${dayId} FOR UPDATE`;
      const current = rows[0] ?? { reserved_tokens: 0, spent_tokens: 0 };
      if (current.reserved_tokens + current.spent_tokens + input.reservedTokens > input.dailyCap) {
        return { ok: false, outcome: 'budget_exhausted' as const };
      }

      await tx.directorBudgetDay.update({
        where: { id: dayId },
        data: {
          reservedTokens: { increment: input.reservedTokens },
          requests: { increment: 1 },
        },
      });
      await tx.directorAttempt.create({
        data: {
          id: input.id,
          jobId: input.jobId,
          colonyId: input.colonyId,
          model: input.model,
          outcome: 'reserved',
          reservedTokens: input.reservedTokens,
        },
      });
      return { ok: true as const };
    });
  }

  /**
   * Reconciles a specific attempt by `attemptId` (AI-09). Idempotent on retry: once reconciled,
   * a second call is a no-op and cannot close another worker's reservation of the same size.
   */
  async reconcileAttemptBudget(
    attemptId: string,
    day: string,
    actual: { inputTokens: number; outputTokens: number } | null,
    outcome = 'proposed',
  ): Promise<boolean> {
    const dayId = `global:${day}`;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { outcome: string; reserved_tokens: number }[]
      >`SELECT "outcome", "reserved_tokens" FROM "ai"."director_attempt" WHERE "id" = ${attemptId} FOR UPDATE`;
      const attempt = rows[0];
      if (!attempt || attempt.outcome !== 'reserved') return false;

      const charged =
        actual === null
          ? attempt.reserved_tokens
          : Math.max(0, actual.inputTokens + actual.outputTokens);

      await tx.directorAttempt.update({
        where: { id: attemptId },
        data: {
          outcome,
          inputTokens: actual?.inputTokens ?? attempt.reserved_tokens,
          outputTokens: actual?.outputTokens ?? 0,
        },
      });
      await tx.directorBudgetDay.update({
        where: { id: dayId },
        data: {
          reservedTokens: { decrement: attempt.reserved_tokens },
          spentTokens: { increment: charged },
        },
      });
      return true;
    });
  }

  /** Persists a scoped kill switch (`global`, `planet:<id>`, `colony:<id>`) in Postgres (W16-17). */
  async setKillSwitch(scope: string, enabled: boolean, reason: string): Promise<void> {
    await this.prisma.directorKillSwitch.upsert({
      where: { scope },
      create: { scope, enabled, reason },
      update: { enabled, reason },
    });
  }

  async isKilled(scope: string): Promise<boolean> {
    const rows = await this.prisma.directorKillSwitch.findMany({
      where: { scope: { in: ['global', scope] }, enabled: true },
    });
    return rows.length > 0;
  }
}
