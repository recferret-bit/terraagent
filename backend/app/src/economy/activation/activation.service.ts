import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { economyError, type EconomyError } from '@terra/contracts';
import { EconomyProfileRepository, withTransaction, type DbClient } from '@terra/db';
import type { EconomyActivation, PrismaClient } from '@prisma/client';
import { persistenceEnabled } from '../../core/persistence';
import { APP_ENV, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import { economyException, EconomyProfileService, type MutationMeta } from '../profile/profile.service';

/**
 * Activation lifecycle (ECONOMY §5, W13-39) on `economy.activation.state`:
 *   REQUESTED/SCHEDULED = `PENDING` (`requested_tick` = the effective tick) → APPLIED = `ACTIVE` (`applied_tick`),
 *   the replaced ACTIVE row becomes `SUPERSEDED`; a version that cannot be applied is `FAILED`.
 * The PENDING row is the outbox: it is written in the same transaction as its audit event, the host applies it to the
 * sim threads and acknowledges with `markApplied`; a crash in between is repaired by re-applying PENDING rows on boot.
 */
export const ACTIVATION_SCOPE = 'global';
export interface ActivationView {
  readonly id: string; readonly scope: string; readonly versionId: string; readonly previousId: string | null;
  readonly state: string; readonly effectiveTick: number | null; readonly appliedTick: number | null;
  readonly operator: string; readonly evidenceRunId: string | null; readonly payloadHash: string | null; readonly createdAt: string;
}
export interface ActivateInput extends MutationMeta {
  readonly scope: string;
  readonly versionId: string;
  /** The version id that must be ACTIVE for the scope right now (`null`: none yet): compare-and-swap guard. */
  readonly expectedPreviousVersionId: string | null;
  readonly evidenceRunId?: string;
  readonly effectiveTick: number;
  /** Dev sandbox activation without evidence (refused in production); recorded as `non_production` in the audit diff. */
  readonly nonProduction?: boolean;
}
export type ActivationResult = { readonly replayed: boolean; readonly activation: ActivationView };

const view = (a: EconomyActivation): ActivationView => ({
  id: a.id, scope: a.scope, versionId: a.versionId, previousId: a.previousId, state: a.state,
  effectiveTick: a.requestedTick === null ? null : Number(a.requestedTick), appliedTick: a.appliedTick === null ? null : Number(a.appliedTick),
  operator: a.operator, evidenceRunId: a.evidenceRunId, payloadHash: a.payloadHash, createdAt: a.createdAt.toISOString(),
});
const fail = (code: Parameters<typeof economyError>[0], message: string, path?: string, details?: Record<string, unknown>): never => {
  throw economyException([economyError(code, message, path, details)]);
};

@Injectable()
export class EconomyActivationService {
  private readonly repo: EconomyProfileRepository;
  private readonly listeners: (() => void)[] = [];

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(APP_ENV) private readonly env: AppEnv, private readonly profiles: EconomyProfileService) {
    this.repo = new EconomyProfileRepository(prisma);
  }

  /** Notified after a PENDING activation is committed (the host bridge applies it); also called on boot via `pending()`. */
  onScheduled(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners.splice(this.listeners.indexOf(fn) >>> 0, 1); };
  }

  async list(scope?: string): Promise<ActivationView[]> {
    return (await this.prisma.economyActivation.findMany({ where: scope ? { scope } : {}, orderBy: { createdAt: 'desc' }, take: 100 })).map(view);
  }

  /** False when the app runs without Postgres (unit tests, `SNAPSHOTS=off`): there is nothing to reconcile. */
  get persistent(): boolean { return persistenceEnabled(this.env as Parameters<typeof persistenceEnabled>[0]); }

  async pending(): Promise<ActivationView[]> {
    return (await this.prisma.economyActivation.findMany({ where: { state: 'PENDING' }, orderBy: { createdAt: 'asc' } })).map(view);
  }

  async activate(input: ActivateInput): Promise<ActivationResult> {
    const prior = await this.replay(input.requestId);
    if (prior) return prior;
    if (input.scope !== ACTIVATION_SCOPE) fail('invalid_patch', `only the "${ACTIVATION_SCOPE}" scope can be activated until the per-planet resolver lands`, 'scope');
    const compiled = await this.profiles.compileVersion(input.versionId); // structured errors when it does not compile
    return this.schedule(input, compiled.overridesHash, 'activate', {});
  }

  /** Schedules the version the ACTIVE activation replaced as a new activation; completed trades and inventory stay untouched. */
  async rollback(activationId: string, meta: MutationMeta & { effectiveTick: number }): Promise<ActivationResult> {
    const prior = await this.replay(meta.requestId);
    if (prior) return prior;
    const act = await this.prisma.economyActivation.findUnique({ where: { id: activationId }, include: { previous: true } });
    if (!act) throw economyException([economyError('version_conflict', `activation ${activationId} not found`)], 404);
    if (act.state !== 'ACTIVE') fail('version_conflict', `activation ${activationId} is ${act.state}; only the ACTIVE one can be rolled back`);
    if (!act.previous) fail('version_conflict', `activation ${activationId} has no previous version to roll back to`);
    const target = (act.previous as EconomyActivation).versionId;
    const compiled = await this.profiles.compileVersion(target);
    return this.schedule({
      ...meta, scope: act.scope, versionId: target, expectedPreviousVersionId: act.versionId, effectiveTick: meta.effectiveTick,
      ...(act.evidenceRunId ? { evidenceRunId: act.evidenceRunId } : {}),
    }, compiled.overridesHash, 'rollback', { rollbackOf: act.id }, true);
  }

  /** Host acknowledgment: PENDING → ACTIVE, the replaced ACTIVE → SUPERSEDED. Idempotent (a re-run changes nothing). */
  async markApplied(id: string, appliedTick: number): Promise<ActivationView> {
    return withTransaction(this.prisma, async (tx) => {
      const act = await tx.economyActivation.findUnique({ where: { id } });
      if (!act) return fail('version_conflict', `activation ${id} not found`);
      await this.lock(tx, act.scope);
      const cur = (await tx.economyActivation.findUnique({ where: { id } })) as EconomyActivation;
      if (cur.state === 'ACTIVE') return view(cur);
      if (cur.state !== 'PENDING') return fail('version_conflict', `activation ${id} is ${cur.state}, expected PENDING`);
      await tx.economyActivation.updateMany({ where: { scope: cur.scope, state: 'ACTIVE', NOT: { id } }, data: { state: 'SUPERSEDED' } });
      const done = await tx.economyActivation.update({ where: { id }, data: { state: 'ACTIVE', appliedTick: BigInt(appliedTick) } });
      await this.repo.recordAudit({ actor: 'host', action: 'activation.applied', versionId: cur.versionId, requestId: `apply:${id}`, diff: { activationId: id, appliedTick } }, tx);
      return view(done);
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await withTransaction(this.prisma, async (tx) => {
      const r = await tx.economyActivation.updateMany({ where: { id, state: 'PENDING' }, data: { state: 'FAILED' } });
      if (r.count > 0) await this.repo.recordAudit({ actor: 'host', action: 'activation.failed', requestId: `fail:${id}`, diff: { activationId: id, reason: reason.slice(0, 500) } }, tx);
    });
  }

  private async replay(requestId: string): Promise<ActivationResult | null> {
    const prior = await this.prisma.economyAuditEvent.findUnique({ where: { requestId } });
    const id = (prior?.diff as { activationId?: string } | undefined)?.activationId;
    if (!prior || !id) return null;
    const act = await this.prisma.economyActivation.findUnique({ where: { id } });
    return act ? { replayed: true, activation: view(act) } : null;
  }

  private lock(tx: DbClient, scope: string): Promise<number> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`economy.activation:${scope}`}))`;
  }

  private async schedule(input: ActivateInput, payloadHash: string, action: string, extra: Record<string, unknown>, isRollback = false): Promise<ActivationResult> {
    const id = `act_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const nonProduction = Boolean(input.nonProduction);
    if (!Number.isSafeInteger(input.effectiveTick) || input.effectiveTick < 0) fail('out_of_bounds', 'effectiveTick must be a non-negative integer', 'effectiveTick');
    if (nonProduction && this.env.NODE_ENV === 'production') fail('not_tunable', 'a non-production sandbox activation is refused in production', 'nonProduction');
    const result = await withTransaction(this.prisma, async (tx) => {
      await this.lock(tx, input.scope);
      const fresh = await tx.economyAuditEvent.findUnique({ where: { requestId: input.requestId } });
      if (fresh) return null; // lost a same-requestId race: replay below
      const active = await tx.economyActivation.findFirst({ where: { scope: input.scope, state: 'ACTIVE' } });
      if ((active?.versionId ?? null) !== input.expectedPreviousVersionId) {
        return fail('version_conflict', `scope ${input.scope} is at ${active?.versionId ?? 'no version'}, expected ${input.expectedPreviousVersionId ?? 'none'}`, 'expectedPreviousVersionId', { current: active?.versionId ?? null });
      }
      if (await tx.economyActivation.findFirst({ where: { scope: input.scope, state: 'PENDING' } })) {
        return fail('version_conflict', `scope ${input.scope} already has a scheduled activation`, 'scope');
      }
      const v = await tx.economyProfileVersion.findUnique({ where: { id: input.versionId }, select: { status: true } });
      if (!v) return fail('version_conflict', `version ${input.versionId} does not exist`, 'versionId');
      if (v.status !== 'APPROVED') fail('version_conflict', `version ${input.versionId} is ${v.status}; only an APPROVED version can be activated`, 'versionId');
      if (!nonProduction && !isRollback) await this.checkEvidence(tx, input.versionId, input.evidenceRunId);
      const row = await tx.economyActivation.create({
        data: { id, scope: input.scope, versionId: input.versionId, previousId: active?.id ?? null, requestedTick: BigInt(input.effectiveTick), state: 'PENDING', operator: input.actor, evidenceRunId: input.evidenceRunId ?? null, payloadHash },
      });
      await this.repo.recordAudit({
        actor: input.actor, action: `activation.${action}`, versionId: input.versionId, requestId: input.requestId,
        diff: { activationId: id, scope: input.scope, from: active?.versionId ?? null, to: input.versionId, effectiveTick: input.effectiveTick, evidenceRunId: input.evidenceRunId ?? null, ...(nonProduction ? { non_production: true } : {}), ...extra },
      }, tx);
      return view(row);
    });
    if (!result) return (await this.replay(input.requestId)) ?? fail('version_conflict', 'request id already used by another mutation', 'requestId');
    this.listeners.forEach((l) => l());
    return { replayed: false, activation: result };
  }

  /** Evidence gate: a completed run of exactly this candidate with at least one gate result and every gate `pass`. */
  private async checkEvidence(tx: DbClient, versionId: string, runId: string | undefined): Promise<void> {
    if (!runId) return fail('invalid_manifest', 'evidenceRunId is required (or a non-production sandbox activation)', 'evidenceRunId');
    const run = await tx.economyExperimentRun.findUnique({ where: { id: runId }, include: { gates: true } });
    const problems: EconomyError[] = [];
    if (!run) problems.push(economyError('invalid_manifest', `evidence run ${runId} does not exist`, 'evidenceRunId'));
    else {
      if (run.candidateId !== versionId) problems.push(economyError('invalid_manifest', `evidence run ${runId} evaluated ${run.candidateId}, not ${versionId}`, 'evidenceRunId'));
      if (run.status !== 'completed') problems.push(economyError('invalid_manifest', `evidence run ${runId} is ${run.status}, expected completed`, 'evidenceRunId'));
      if (run.gates.length === 0) problems.push(economyError('invalid_manifest', `evidence run ${runId} has no gate results`, 'evidenceRunId'));
      const bad = run.gates.filter((g) => g.outcome !== 'pass').map((g) => `${g.gateId}:${g.outcome}`);
      if (bad.length) problems.push(economyError('invalid_manifest', `evidence run ${runId} has gates that did not pass: ${bad.join(', ')}`, 'evidenceRunId', { gates: bad }));
    }
    if (problems.length) throw economyException(problems);
  }
}
