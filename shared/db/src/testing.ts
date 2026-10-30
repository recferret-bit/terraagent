// Test-DB harness (`@terra/db/testing`): a fresh, migrated, throwaway database per test run on the shared dev Postgres.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { coreEnv, databaseUrl, parseEnv, readEnvSource } from '@terra/config';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './client';

const DB_DIR = resolve(import.meta.dirname, '..');
const ROOT = resolve(DB_DIR, '../..');
const SCHEMA = join(DB_DIR, 'prisma/schema.prisma');

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
  readonly prisma: PrismaClient;
  /** Disconnects the client and drops the database. Idempotent. */
  drop(): Promise<void>;
}

const withDb = (base: string, name: string) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};

/** Base server URL: `DATABASE_URL` / `TA_PG_PORT` from the real env, `.env.worktree`, `.env` (the same source as the app). */
const serverUrl = () => databaseUrl(parseEnv([coreEnv], readEnvSource(ROOT)));

/** Creates `terra_test_<random>`, runs `prisma migrate deploy` on it and returns a connected client. Logs the name. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = serverUrl();
  const name = `terra_test_${randomBytes(6).toString('hex')}`;
  const url = withDb(base, name);
  const admin = createPrismaClient(withDb(base, 'postgres'), { poolSize: 1 });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } catch (e) {
    await admin.$disconnect();
    throw new Error(`cannot create test database on ${new URL(base).host} (is \`npm run db:up\` running?)`, { cause: e });
  }
  console.log(`[test-db] created ${name}`);
  const dropDb = async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  };
  const migrated = spawnSync(join(ROOT, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', SCHEMA], {
    cwd: DB_DIR,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  if (migrated.status !== 0) {
    await dropDb();
    throw new Error(`migrate deploy failed on ${name}:\n${migrated.stdout}${migrated.stderr}`);
  }
  console.log(`[test-db] migrated ${name}`);
  const prisma = createPrismaClient(url, { poolSize: 5 });
  let dropped = false;
  return {
    name,
    url,
    prisma,
    async drop() {
      if (dropped) return;
      dropped = true;
      await prisma.$disconnect();
      await dropDb();
      console.log(`[test-db] dropped ${name}`);
    },
  };
}

/** Admin check used by tests/tools: does a database with this name exist on the server? */
export async function databaseExists(name: string): Promise<boolean> {
  const admin = createPrismaClient(withDb(serverUrl(), 'postgres'), { poolSize: 1 });
  try {
    const rows = await admin.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
    return rows.length > 0;
  } finally {
    await admin.$disconnect();
  }
}
