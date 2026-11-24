import { Global, Module } from '@nestjs/common';
import { appPort, databaseUrl, defineEnv } from '@terra/config';
import type { Logger } from 'pino';
import { z } from 'zod';
import { layerLogger } from '../core/logging/logger';
import { databaseEnabled } from '../core/persistence';
import { APP_ENV, LOGGER, type AppEnv } from '../core/tokens';
import { JobQueuePort } from './job-queue.port';
import { JOBS_OPTIONS, JobsService, type JobsServiceOptions } from './jobs.service';
import { MemoryJobQueue } from './memory/memory-job-queue';
import { PgBossJobQueue } from './pgboss/pgboss-job-queue';
import { instanceKeyOf } from './recurring';

export const env = defineEnv('jobs', {
  /** Job queue adapter (3.7): `pgboss` (Postgres, schema `JOB_QUEUE_SCHEMA`) or `memory`; unset = pgboss with a database, memory under NODE_ENV=test. */
  JOB_QUEUE: z.enum(['pgboss', 'memory']).optional(),
  /** Postgres schema pg-boss installs and migrates itself on boot. */
  JOB_QUEUE_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default('pgboss'),
  /** pg-boss's own connection pool (separate from Prisma's `TA_DB_POOL_SIZE`). */
  JOB_QUEUE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(4),
});

/** Which adapter this environment gets. */
export function jobQueueKind(e: AppEnv): 'pgboss' | 'memory' {
  if (e.JOB_QUEUE === 'pgboss' || e.JOB_QUEUE === 'memory') return e.JOB_QUEUE;
  return e.NODE_ENV !== 'test' && databaseEnabled(e) ? 'pgboss' : 'memory';
}

/** Durable jobs for every module (3.7): `JobsService` to register loops, `JobQueuePort` for ad-hoc work. */
@Global()
@Module({
  providers: [
    {
      provide: JobQueuePort,
      inject: [APP_ENV, LOGGER],
      useFactory: (e: AppEnv, root: Logger): JobQueuePort => {
        const log = layerLogger(root, 'infra', e.LOG_LEVELS as string | undefined);
        const onError = (queue: string, err: unknown) => log.warn({ queue, err: err instanceof Error ? err.message : String(err) }, 'job queue error');
        if (jobQueueKind(e) === 'memory') return new MemoryJobQueue(onError);
        return new PgBossJobQueue({ connectionString: databaseUrl(e), schema: e.JOB_QUEUE_SCHEMA as string, poolMax: Number(e.JOB_QUEUE_POOL_MAX), onError });
      },
    },
    {
      provide: JOBS_OPTIONS,
      inject: [APP_ENV, LOGGER],
      useFactory: (e: AppEnv, root: Logger): JobsServiceOptions => ({
        instanceKey: instanceKeyOf(e.TA_WORKER_ID as string | undefined, appPort(e)),
        simRole: e.TA_SIM_ROLE,
        log: layerLogger(root, 'infra', e.LOG_LEVELS as string | undefined),
      }),
    },
    JobsService,
  ],
  exports: [JobQueuePort, JobsService],
})
export class JobsModule {}
