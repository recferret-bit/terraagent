import type { PrismaClient } from '@terra/db';

/**
 * Away is an open `world.planet_event_digest` row (`closedAt` null), the row `colonyAway` opens
 * and `colonyBack` closes. This does not read `blobs.presence` (BE-84).
 */
export async function awayColonyIds(prisma: PrismaClient, planetId: string): Promise<ReadonlySet<string>> {
  const rows = await prisma.planetEventDigest.findMany({
    where: { planetId, closedAt: null },
    select: { colonyId: true },
  });
  return new Set(rows.map((row) => row.colonyId));
}

export async function colonyIdForAccount(prisma: PrismaClient, accountId: string): Promise<string | null> {
  const row = await prisma.nearColonyAccount.findUnique({
    where: { accountId },
    select: { colonyId: true },
  });
  return row?.colonyId ?? null;
}

/** True when this chain account's colony has an open away digest on `planetId`. No row means present. */
export async function accountIsAway(prisma: PrismaClient, planetId: string, accountId: string): Promise<boolean> {
  const colonyId = await colonyIdForAccount(prisma, accountId);
  if (!colonyId) return false;
  const away = await awayColonyIds(prisma, planetId);
  return away.has(colonyId);
}

/** Home colony ids of DAO members that are away. One id each. Never a vote. */
export async function awayMemberColonies(
  prisma: PrismaClient,
  planetId: string,
  accountIds: readonly string[],
): Promise<readonly string[]> {
  if (accountIds.length === 0) return [];
  const away = await awayColonyIds(prisma, planetId);
  if (away.size === 0) return [];
  const rows = await prisma.nearColonyAccount.findMany({
    where: { accountId: { in: [...accountIds] }, colonyId: { in: [...away] } },
    select: { colonyId: true },
  });
  const ids: string[] = [];
  for (const row of rows) {
    if (row.colonyId && away.has(row.colonyId) && !ids.includes(row.colonyId)) ids.push(row.colonyId);
  }
  return ids;
}
