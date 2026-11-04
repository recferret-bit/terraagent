import type { TransactionClient } from '@terra/db';
import type { ColonyState } from '@terra/sim';

/** The sim owns stage/outcome. Project only explicit stage values; current worlds start at stage 1. */
export async function projectColonies(tx: TransactionClient, planetId: string, colonies: readonly ColonyState[]): Promise<void> {
  for (const colony of colonies) {
    const stage = typeof colony.stage === 'number' && Number.isInteger(colony.stage) && colony.stage >= 0 && colony.stage <= 10 ? colony.stage : undefined;
    const status = colony.status === 'founding' ? 'ACTIVE' : colony.status.toUpperCase();
    await tx.colony.updateMany({ where: { planetId, id: colony.id }, data: { status, ...(stage === undefined ? {} : { stage }) } });
    if (colony.status !== 'eliminated' && colony.status !== 'settled') continue;
    const row = await tx.colony.findUnique({ where: { id: colony.id } });
    const planet = await tx.planet.findUnique({ where: { id: planetId } });
    if (!row || row.planetId !== planetId || !planet) continue;
    const id = `archive:${row.id}`;
    await tx.colonyHistory.upsert({ where: { id }, update: {}, create: {
      id, playerId: row.playerId, colonyId: row.id, name: row.name, planetId, planetName: planet.name,
      planetType: planet.type, stageReached: row.stage, outcome: colony.status, foundedAt: row.createdAt,
    } });
  }
}
