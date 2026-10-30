import type { SeedContext } from '../scripts/seed';

/** Example seed: no tables exist yet. Seeds must be idempotent (upsert / `ON CONFLICT DO NOTHING`), never blind inserts. */
export default async function seed({ prisma, log }: SeedContext): Promise<void> {
  const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  log(`example seed ran (db time ${now.toISOString()}); nothing to insert yet`);
}
