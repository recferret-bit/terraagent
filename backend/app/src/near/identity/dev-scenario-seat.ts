import { newId } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';

export interface DevScenarioSeat {
  readonly playerId: string;
  readonly handle: string;
  readonly planetId: string;
  /** Colony indices that exist in the scenario's sim state (default `[0]`). */
  readonly colonyIndices?: readonly number[];
}

/**
 * A `dev:` session on a scenario planet plays the next free scenario colony (BE-07; W13-30): the lowest index that exists in
 * the sim state and has no `core.colony` row, else colony 0 (the old one-colony behaviour), without a row if it is taken.
 * Social upgrade only enqueues the colony deposit for rows it can see, so the join writes one.
 * The row id is a new `co_` id, not the sim's `col_0` (BE-45).
 */
export async function seatDevScenarioPlayer(prisma: PrismaClient, input: DevScenarioSeat): Promise<number | undefined> {
  await ensurePlayer(prisma, input.playerId, input.handle);
  return ensureSeat(prisma, input.playerId, input.planetId, input.colonyIndices ?? [0], input.handle);
}

async function ensurePlayer(prisma: PrismaClient, id: string, handle: string): Promise<void> {
  if (await prisma.player.findUnique({ where: { id }, select: { id: true } })) return;
  const base = (handle.trim() || 'pilot').slice(0, 24);
  for (let n = 0; n < 5; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    try {
      await prisma.player.create({ data: { id, handle: candidate, deviceSecretHash: null } });
      return;
    } catch (e) {
      if (await prisma.player.findUnique({ where: { id }, select: { id: true } })) return;
      if (!isUnique(e)) throw e;
    }
  }
  throw new Error(`could not seat dev player ${id}`);
}

const HANDLE_COLONY_INDEX: Readonly<Record<string, number>> = {
  a: 0,
  b: 1,
  c: 2,
  d: 3,
  e: 4,
};

/** The lowest scenario colony index with no `core.colony` row on the planet; undefined when every seat is taken. */
export function nextFreeSeat(
  indices: readonly number[],
  taken: ReadonlySet<number>,
  handle?: string,
): number | undefined {
  const preferred = handle ? HANDLE_COLONY_INDEX[handle.trim().toLowerCase()] : undefined;
  if (preferred !== undefined && indices.includes(preferred) && !taken.has(preferred)) {
    return preferred;
  }
  return [...indices].sort((a, b) => a - b).find((i) => !taken.has(i));
}

/** The seated colony index (the existing seat's, or the new one); undefined when every seat is taken. */
async function ensureSeat(
  prisma: PrismaClient,
  playerId: string,
  planetId: string,
  indices: readonly number[],
  handle?: string,
): Promise<number | undefined> {
  const mine = await prisma.colony.findFirst({ where: { playerId, planetId }, select: { colonyIndex: true } });
  if (mine) return mine.colonyIndex;
  for (let attempt = 0; attempt < 3; attempt++) {
    const taken = new Set((await prisma.colony.findMany({ where: { planetId }, select: { colonyIndex: true } })).map((c) => c.colonyIndex));
    const index = nextFreeSeat(indices, taken, handle);
    if (index === undefined) return undefined; // every scenario colony is taken: this session stays on the synthetic colony 0
    try {
      await prisma.colony.create({
        data: { id: newId('co'), playerId, planetId, colonyIndex: index, name: index === 0 ? "Colonist's Colony" : `Colony ${index + 1}`, status: 'ACTIVE' },
      });
      return index;
    } catch (e) {
      if (!isUnique(e)) throw e; // a concurrent join took this index: look again
    }
  }
  return undefined;
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
