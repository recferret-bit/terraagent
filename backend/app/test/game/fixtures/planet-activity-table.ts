import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@terra/db';

const MIGRATION = resolve(import.meta.dirname, '../../../../../shared/db/prisma/migrations/0037_planet_activity/migration.sql');

/**
 * `@terra/db/testing` migrates from the `shared/db` the workspace links to; in a worktree that is the main checkout,
 * which may not have migration 0037 yet. Applies it to the throwaway test database when the table is missing.
 */
export async function ensurePlanetActivityTable(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('world.planet_activity')::text AS t`;
  if (row?.t) return;
  for (const stmt of readFileSync(MIGRATION, 'utf8').split(';').map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(stmt);
  }
}
