import type { PrismaClient } from '@prisma/client';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
export const OPEN_RUN: readonly RunStatus[] = ['queued', 'running'];

export interface ClaimedRun {
  readonly id: string;
  readonly experimentId: string;
  readonly candidateId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly seed: number;
  readonly manifest: unknown;
}

export const padIndex = (i: number): string => String(i).padStart(4, '0');

/** SQL of the job queue: leases live in `experiment_run.hashes.lease` (the tables have no lease column per run). */
export class ExperimentRepo {
  constructor(private readonly prisma: PrismaClient) {}

  /** Leases one queued (or lease-expired running) run: `FOR UPDATE SKIP LOCKED`, per-experiment `maxWorkers` respected. */
  async claim(owner: string, leaseMs: number): Promise<ClaimedRun | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT r.id FROM economy.experiment_run r JOIN economy.experiment e ON e.id = r.experiment_id
        WHERE e.status IN ('queued', 'running')
          AND (r.status = 'queued' OR (r.status = 'running' AND (r.hashes->'lease'->>'expiresAt')::timestamptz < now()))
          AND (SELECT count(*) FROM economy.experiment_run x WHERE x.experiment_id = e.id AND x.status = 'running'
               AND (x.hashes->'lease'->>'expiresAt')::timestamptz >= now()) < COALESCE((e.manifest->'budget'->>'maxWorkers')::int, 1)
        ORDER BY r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`;
      const id = rows[0]?.id;
      if (!id) return null;
      const lease = JSON.stringify({ lease: { owner, expiresAt: new Date(Date.now() + leaseMs).toISOString() } });
      const run = await tx.economyExperimentRun.update({ where: { id }, data: { status: 'running', hashes: JSON.parse(lease) }, include: { experiment: true } });
      const progress = { ...(run.experiment.progress as Record<string, unknown>) };
      if (!progress.startedAt) progress.startedAt = new Date().toISOString();
      await tx.economyExperiment.update({ where: { id: run.experimentId }, data: { status: 'running', leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + leaseMs), progress: progress as never } });
      return { id, experimentId: run.experimentId, candidateId: run.candidateId, scenarioId: run.scenarioId, scenarioVersion: run.scenarioVersion, seed: Number(run.seed), manifest: run.experiment.manifest };
    });
  }

  /** Renews the lease; false when the run is no longer ours and running (cancelled, timed out, reclaimed). */
  async heartbeat(runId: string, owner: string, leaseMs: number): Promise<boolean> {
    const expiresAt = new Date(Date.now() + leaseMs).toISOString();
    const n = await this.prisma.$executeRaw`
      UPDATE economy.experiment_run SET hashes = jsonb_set(hashes, '{lease,expiresAt}', to_jsonb(${expiresAt}::text))
      WHERE id = ${runId} AND status = 'running' AND hashes->'lease'->>'owner' = ${owner}`;
    return n === 1;
  }

  /** Marks every open run of experiments past their wall budget `incomplete`; returns those experiment ids. */
  async expireBudgets(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM economy.experiment WHERE status IN ('queued', 'running') AND progress->>'startedAt' IS NOT NULL
        AND (progress->>'startedAt')::timestamptz + make_interval(secs => COALESCE((manifest->'budget'->>'maxWallSeconds')::int, 0)) < now()`;
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await this.prisma.economyExperimentRun.updateMany({ where: { experimentId: { in: ids }, status: { in: [...OPEN_RUN] } }, data: { status: 'incomplete' } });
    }
    return ids;
  }

  /** Returns this owner's running runs to the queue (graceful shutdown). */
  async release(owner: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE economy.experiment_run SET status = 'queued', hashes = '{}'::jsonb WHERE status = 'running' AND hashes->'lease'->>'owner' = ${owner}`;
  }
}
