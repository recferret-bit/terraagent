import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { databaseUrl, defineEnv } from '@terra/config';
import { createPrismaClient, DEFAULT_POOL_SIZE, type PrismaClient } from '@terra/db';
import { z } from 'zod';
import { ReadinessRegistry } from '../core/readiness.registry';
import { APP_ENV, type AppEnv } from '../core/tokens';

export const env = defineEnv('db', {
  /** Prisma `connection_limit` for this process (DATA_MODEL §9). */
  TA_DB_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(DEFAULT_POOL_SIZE),
});

/** Injection token for the process-wide Prisma client: `@Inject(PRISMA) prisma: PrismaClient`. */
export const PRISMA = Symbol('PRISMA');

/** Owns the client's lifetime: registers the `db` readiness check and disconnects on shutdown. */
@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, readiness: ReadinessRegistry) {
    readiness.register('db', async () => {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/** Global: the one Prisma client of the process. Connects lazily, so the app boots without Postgres (readyz reports it). */
@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [APP_ENV],
      useFactory: (e: AppEnv) => createPrismaClient(databaseUrl(e), { poolSize: e.TA_DB_POOL_SIZE as number }),
    },
    DbLifecycle,
  ],
  exports: [PRISMA],
})
export class DbModule {}
