import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../core/errors/core-exception.js';

/** Lobby archive and the home `ENDED` / `PLANET_ENDED` labels. A missing planet row is not ended. */
const ENDED = new Set(['ENDED', 'ARCHIVED', 'PLANET_ENDED']);

export function planetLifecycleEnded(row: {
  readonly lifecycle?: string | null;
  readonly state?: string | null;
  readonly status?: string | null;
}): boolean {
  return [row.lifecycle, row.state, row.status].some((value) => ENDED.has(String(value ?? '').toUpperCase()));
}

/**
 * Council `propose` stops when `core.planet` is ended or archived.
 * No row (a dev DAO with no planet record) is still open.
 */
export async function rejectEndedPlanet(prisma: PrismaClient | undefined, planetId: string): Promise<void> {
  if (!prisma) return;
  const row = await prisma.planet.findUnique({
    where: { id: planetId.trim() },
    select: { lifecycle: true, state: true },
  });
  if (!row || !planetLifecycleEnded(row)) return;
  throw new CoreException('planet_ended', {
    status: 409,
    message: 'This planet has ended.',
    details: { planetId: planetId.trim() },
  });
}
