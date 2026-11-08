import type { PlanetType } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { DEV_PLANET_RADIUS, DEV_PLANET_TYPE } from '@terra/sim';
import { type ColonyRecord, colonyFromRow, type HomeStore, type NewColonyRow, type NewPlanetRow, type PlanetRecord } from './home.store';

interface PlanetRow {
  id: string;
  name: string;
  type: string;
  seed: string;
  state: string;
  capacity: number;
  seatsTaken: number;
  createdAt: Date;
}

const isPlanetType = (t: string): t is PlanetType => t === 'desert' || t === 'ocean' || t === 'temperate';

/** `radius` is not a column (BE-20): every planet read from the database is a dev-size planet. */
function planetFromRow(row: PlanetRow): PlanetRecord {
  return {
    id: row.id, name: row.name, type: isPlanetType(row.type) ? row.type : DEV_PLANET_TYPE, seed: row.seed, radius: DEV_PLANET_RADIUS,
    state: row.state, status: row.state, capacity: row.capacity, seatsTaken: row.seatsTaken, createdAt: row.createdAt,
  };
}

const orNull = <T>(row: T | null, map: (r: T) => ColonyRecord | PlanetRecord) => (row ? map(row) : null);

/** Planet and colony rows in `core.planet` / `core.colony`. */
export class PrismaHomeStore implements HomeStore {
  private readonly recapSeenIds = new Set<string>();

  constructor(private readonly prisma: PrismaClient) {}

  private toColony = (row: NewColonyRow & { createdAt: Date }): ColonyRecord =>
    colonyFromRow({ ...row, recapSeen: this.recapSeenIds.has(row.id) });

  async findPlanet(id: string): Promise<PlanetRecord | null> {
    return orNull(await this.prisma.planet.findUnique({ where: { id } }), planetFromRow) as PlanetRecord | null;
  }

  async upsertPlanet(row: NewPlanetRow): Promise<PlanetRecord> {
    const { radius: _radius, ...data } = row;
    return planetFromRow(await this.prisma.planet.upsert({ where: { id: row.id }, update: {}, create: { ...data, seatsTaken: 0 } }));
  }

  async setPlanetType(id: string, type: PlanetType): Promise<PlanetRecord | null> {
    const r = await this.prisma.planet.updateMany({ where: { id }, data: { type } });
    return r.count ? this.findPlanet(id) : null;
  }

  async setPlanetState(id: string, state: string): Promise<PlanetRecord | null> {
    const r = await this.prisma.planet.updateMany({ where: { id }, data: { state } });
    return r.count ? this.findPlanet(id) : null;
  }

  async listPlanets(): Promise<PlanetRecord[]> {
    return (await this.prisma.planet.findMany()).map(planetFromRow);
  }

  async findColony(id: string): Promise<ColonyRecord | null> {
    return orNull(await this.prisma.colony.findUnique({ where: { id } }), this.toColony) as ColonyRecord | null;
  }

  async findLatestColony(playerId: string, planetId?: string): Promise<ColonyRecord | null> {
    const row = await this.prisma.colony.findFirst({ where: { playerId, ...(planetId === undefined ? {} : { planetId }) }, orderBy: { createdAt: 'desc' } });
    return orNull(row, this.toColony) as ColonyRecord | null;
  }

  async listColonies(planetId?: string): Promise<ColonyRecord[]> {
    const rows = await this.prisma.colony.findMany({ ...(planetId === undefined ? {} : { where: { planetId } }), orderBy: { colonyIndex: 'asc' } });
    return rows.map(this.toColony);
  }

  async createColony(row: NewColonyRow): Promise<{ colony: ColonyRecord; planet: PlanetRecord | null }> {
    const { recapSeen, foundingSectorId, landingSlotId, ...rest } = row;
    const created = await this.prisma.colony.create({
      data: {
        ...rest,
        foundingSectorId: foundingSectorId ?? 'sec_0_0',
        ...(landingSlotId !== undefined ? { landingSlotId } : {}),
      },
    });
    if (recapSeen) this.recapSeenIds.add(created.id);
    return { colony: this.toColony(created), planet: await this.recount(row.planetId) };
  }

  async deleteColony(id: string): Promise<string | null> {
    const rows = await this.prisma.colony.findMany({ where: { id }, select: { planetId: true } });
    if (!rows[0]) return null;
    this.recapSeenIds.delete(id);
    await this.prisma.colony.deleteMany({ where: { id } });
    await this.recount(rows[0].planetId);
    return rows[0].planetId;
  }

  async setColonyStatus(id: string, status: string): Promise<ColonyRecord | null> {
    if (status === 'ELIMINATED') this.recapSeenIds.delete(id);
    const r = await this.prisma.colony.updateMany({ where: { id }, data: { status } });
    return r.count ? this.findColony(id) : null;
  }

  async setColonyRecapSeen(id: string, recapSeen = true): Promise<ColonyRecord | null> {
    if (recapSeen) this.recapSeenIds.add(id);
    else this.recapSeenIds.delete(id);
    return this.findColony(id);
  }

  async deleteColoniesOfPlanet(planetId: string): Promise<number> {
    const { count } = await this.prisma.colony.deleteMany({ where: { planetId } });
    await this.recount(planetId);
    return count;
  }

  private async recount(planetId: string): Promise<PlanetRecord | null> {
    const seatsTaken = await this.prisma.colony.count({ where: { planetId } });
    await this.prisma.planet.updateMany({ where: { id: planetId }, data: { seatsTaken } });
    return this.findPlanet(planetId);
  }
}
