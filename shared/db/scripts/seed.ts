// `npm run db:seed`: runs every shared/db/seeds/*.ts in name order against the worktree database. Seeds must be idempotent.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coreEnv, databaseUrl, parseEnv, readEnvSource } from '@terra/config';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../src/client';

export interface SeedContext {
  readonly prisma: PrismaClient;
  readonly log: (msg: string) => void;
}
export type Seed = (ctx: SeedContext) => Promise<void>;

const SEEDS = resolve(import.meta.dirname, '../seeds');
const ROOT = resolve(import.meta.dirname, '../../..');

const prisma = createPrismaClient(databaseUrl(parseEnv([coreEnv], readEnvSource(ROOT))), { poolSize: 2 });
try {
  const files = readdirSync(SEEDS).filter((f) => /\.(ts|js)$/.test(f)).sort();
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(SEEDS, file)).href)) as { default?: Seed };
    if (typeof mod.default !== 'function') throw new Error(`seed ${file} must default-export an async function`);
    console.log(`seed ${file}`);
    await mod.default({ prisma, log: (m) => console.log(`  ${m}`) });
  }
  console.log(`seeded ${files.length} file(s)`);
} finally {
  await prisma.$disconnect();
}
