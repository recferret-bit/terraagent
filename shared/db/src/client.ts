import { PrismaClient } from '@prisma/client';

/** Pool size per process (DATA_MODEL §9: Prisma `connection_limit`, default 20). */
export const DEFAULT_POOL_SIZE = 20;

export interface CreatePrismaClientOptions {
  /** `connection_limit`; ignored when the URL already carries one. */
  readonly poolSize?: number;
}

/** Returns `url` with `connection_limit` set (an explicit one in the URL wins). */
export function withPoolSize(url: string, poolSize: number): string {
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(poolSize));
  return u.toString();
}

/** Creates a Prisma client. Create exactly one per process (the Nest `DbModule` does); tests use the harness. */
export function createPrismaClient(url: string, options: CreatePrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    datasourceUrl: withPoolSize(url, options.poolSize ?? DEFAULT_POOL_SIZE),
  });
}

export { PrismaClient };
