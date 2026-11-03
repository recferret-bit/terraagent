import { newId } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';

export interface DevScenarioSeat {
  readonly playerId: string;
  readonly handle: string;
  readonly planetId: string;
}

/**
 * A `dev:` session on a scenario planet plays colony 0 without a `core.colony` row (BE-07).
 * Social upgrade only enqueues the colony deposit for rows it can see, so the join writes one.
 * The row id is a new `co_` id, not the sim's `col_0` (BE-45).
 */
export async function seatDevScenarioPlayer(prisma: PrismaClient, input: DevScenarioSeat): Promise<void> {
  await ensurePlayer(prisma, input.playerId, input.handle);
  await ensureIndexZero(prisma, input.playerId, input.planetId);
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

async function ensureIndexZero(prisma: PrismaClient, playerId: string, planetId: string): Promise<void> {
  const mine = await prisma.colony.findFirst({ where: { playerId, planetId }, select: { id: true } });
  if (mine) return;
  try {
    await prisma.colony.create({
      data: {
        id: newId('co'),
        playerId,
        planetId,
        colonyIndex: 0,
        name: "Colonist's Colony",
        status: 'ACTIVE',
      },
    });
  } catch (e) {
    if (!isUnique(e)) throw e;
  }
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
