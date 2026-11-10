import type { PrismaClient } from '@terra/db';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface MockNotifyView {
  readonly id: string;
  readonly colonyId: string;
  readonly eventId: string;
  readonly channel: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

/** `limit` query → 1..200; absent or not a number → 50. */
export function notifyListLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

/** Newest `core.mock_notify` rows. `colonyId` is an exact match when set. */
export async function listMockNotify(
  prisma: PrismaClient,
  query: { readonly colonyId?: string; readonly limit?: string },
): Promise<{ rows: MockNotifyView[] }> {
  const colonyId = query.colonyId?.trim();
  const rows = await prisma.mockNotify.findMany({
    where: colonyId ? { colonyId } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: notifyListLimit(query.limit),
  });
  return {
    rows: rows.map((row) => ({
      id: row.id.toString(),
      colonyId: row.colonyId,
      eventId: row.eventId,
      channel: row.channel,
      kind: row.kind,
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
