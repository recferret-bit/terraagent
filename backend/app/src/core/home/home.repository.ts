import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlanetType } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { DEV_PLANET_SEED as SIM_DEV_PLANET_SEED, DEV_PLANET_TYPE as SIM_DEV_PLANET_TYPE, devPlanetIdFor, devPlanetTypeOf, type DevPlanetType } from '@terra/sim';
import { PRISMA } from '../../db/db.module';
import { APP_ENV, type AppEnv } from '../tokens';

export const DEV_PLANET_CAPACITY = 5;
export const DEV_PLANET_RADIUS = 56;
/** Shared with the client's local fallback (`@terra/sim`): one source for the dev planet's type and seed (D-38). */
export const DEV_PLANET_SEED: string = SIM_DEV_PLANET_SEED;
export const DEV_PLANET_TYPE: PlanetType = SIM_DEV_PLANET_TYPE;

export interface PlanetRecord {
  readonly id: string;
  readonly name: string;
  readonly type: PlanetType;
  readonly seed: string;
  readonly radius: number;
  readonly state: string;
  readonly status: string;
  readonly capacity: number;
  readonly seatsTaken: number;
  readonly createdAt: Date;
}

export interface ColonyRecord {
  readonly id: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly name: string;
  readonly color: number;
  readonly status: string;
  readonly state: string;
  readonly spawnQ: number;
  readonly spawnR: number;
  readonly spawn: { readonly q: number; readonly r: number };
  readonly createdAt: Date;
}

export interface CreatePlanetInput {
  readonly id: string;
  readonly name?: string;
  readonly type?: PlanetType;
  readonly seed?: string;
  readonly radius?: number;
  readonly state?: string;
  readonly capacity?: number;
}

export interface CreateColonyInput {
  readonly id?: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly name: string;
  readonly color?: number;
  readonly status?: string;
  readonly spawnQ: number;
  readonly spawnR: number;
}

function normalizePlanetType(type: string | undefined): PlanetType {
  if (type === 'desert' || type === 'ocean' || type === 'temperate') {
    return type;
  }
  return DEV_PLANET_TYPE;
}

function devPlanetName(type: DevPlanetType, index: number): string {
  const base = type === DEV_PLANET_TYPE ? 'Dev Planet' : `Dev Planet (${type})`;
  return index <= 1 ? base : `${base} ${index}`;
}

function generateColonyId(): string {
  return `col_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

@Injectable()
export class HomeRepository {
  private readonly planetsById = new Map<string, PlanetRecord>();
  private readonly coloniesById = new Map<string, ColonyRecord>();
  readonly dbEnabled: boolean;

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.dbEnabled = Boolean(prisma) && (!env || env.NODE_ENV !== 'test' || Boolean(env.DATABASE_URL));
  }

  async findPlanetById(id: string): Promise<PlanetRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.planet.findUnique({ where: { id } });
        if (row) {
          return this.saveMemPlanet(this.fromDbPlanet(row));
        }
        return null;
      } catch {
        // Fall through to in-memory store
      }
    }
    return this.planetsById.get(id) ?? null;
  }

  /**
   * A dev planet row created before its id named a type (pre-D-38 `pl_dev` = temperate) is retyped when nobody lives
   * on it, so the planet is regenerated with the right profile; with colonies the snapshot wipe (D-38) handles it.
   */
  private async fixDevPlanetType(planet: PlanetRecord): Promise<PlanetRecord> {
    const want = devPlanetTypeOf(planet.id);
    if (!want || planet.type === want) return planet;
    if ((await this.listColoniesByPlanetId(planet.id)).length > 0) return planet;
    if (this.dbEnabled && this.prisma) {
      const row = await this.prisma.planet.update({ where: { id: planet.id }, data: { type: want } }).catch(() => null);
      if (row) return this.saveMemPlanet(this.fromDbPlanet(row, planet.radius));
    }
    return this.saveMemPlanet({ ...planet, type: want });
  }

  async upsertDevPlanet(id: string, input: Partial<CreatePlanetInput> = {}): Promise<PlanetRecord> {
    const existing = await this.findPlanetById(id);
    if (existing) return this.fixDevPlanetType(existing);

    const name = input.name ?? (id === 'pl_dev' ? 'Dev Planet' : id);
    const type = input.type ?? devPlanetTypeOf(id) ?? DEV_PLANET_TYPE; // the id names its family's type
    const seed = input.seed ?? DEV_PLANET_SEED;
    const radius = input.radius ?? DEV_PLANET_RADIUS;
    const state = input.state ?? 'ACTIVE';
    const capacity = input.capacity ?? DEV_PLANET_CAPACITY;

    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.planet.upsert({
          where: { id },
          update: {},
          create: { id, name, type, seed, state, capacity, seatsTaken: 0 },
        });
        return this.saveMemPlanet(this.fromDbPlanet(row, radius));
      } catch {
        // Fall through to in-memory store
      }
    }

    const record: PlanetRecord = {
      id,
      name,
      type,
      seed,
      radius,
      state,
      status: state,
      capacity,
      seatsTaken: 0,
      createdAt: new Date(),
    };
    return this.saveMemPlanet(record);
  }

  /** The first dev planet of `type` (one family per type: `devPlanetIdFor`) with a free seat, not in `skip`; creates it when needed. */
  async findOrCreateOpenDevPlanet(type: DevPlanetType = DEV_PLANET_TYPE, skip?: ReadonlySet<string>): Promise<{ planet: PlanetRecord; colonyIndex: number }> {
    for (let index = 1; index <= 1000; index++) {
      const id = devPlanetIdFor(type, index);
      if (skip?.has(id)) continue; // no landing site left (`HomeService`)
      const planet = await this.upsertDevPlanet(id, {
        name: devPlanetName(type, index),
        type,
        seed: DEV_PLANET_SEED,
        radius: DEV_PLANET_RADIUS,
        capacity: DEV_PLANET_CAPACITY,
        state: 'ACTIVE',
      });
      if (planet.status === 'ENDED' || planet.status === 'PLANET_ENDED') {
        continue;
      }
      const colonies = await this.listColoniesByPlanetId(planet.id);
      const takenIndices = new Set(colonies.map((c) => c.colonyIndex));
      for (let slot = 0; slot < planet.capacity; slot++) {
        if (!takenIndices.has(slot)) {
          return { planet, colonyIndex: slot };
        }
      }
    }
    throw new Error('Unable to allocate dev planet seat');
  }

  async findLatestColonyByPlayerId(playerId: string): Promise<ColonyRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.colony.findFirst({
          where: { playerId },
          orderBy: { createdAt: 'desc' },
        });
        if (row) {
          return this.saveMemColony(this.fromDbColony(row));
        }
        return null;
      } catch {
        // Fall through to in-memory store
      }
    }
    let latest: ColonyRecord | null = null;
    for (const colony of this.coloniesById.values()) {
      if (colony.playerId !== playerId) continue;
      if (!latest || colony.createdAt.getTime() >= latest.createdAt.getTime()) {
        latest = colony;
      }
    }
    return latest;
  }

  async findColonyByPlayerId(playerId: string): Promise<ColonyRecord | null> {
    return this.findLatestColonyByPlayerId(playerId);
  }

  async findColonyByPlayer(playerId: string): Promise<ColonyRecord | null> {
    return this.findLatestColonyByPlayerId(playerId);
  }

  findMemColonyByPlayerAndPlanet(playerId: string, planetId: string): ColonyRecord | null {
    let latest: ColonyRecord | null = null;
    for (const colony of this.coloniesById.values()) {
      if (colony.playerId !== playerId || colony.planetId !== planetId) continue;
      if (!latest || colony.createdAt.getTime() >= latest.createdAt.getTime()) {
        latest = colony;
      }
    }
    return latest;
  }

  async findColonyByPlayerAndPlanet(playerId: string, planetId: string): Promise<ColonyRecord | null> {
    const inMem = this.findMemColonyByPlayerAndPlanet(playerId, planetId);
    if (inMem && !this.dbEnabled) return inMem;
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.colony.findFirst({
          where: { playerId, planetId },
          orderBy: { createdAt: 'desc' },
        });
        if (row) {
          return this.saveMemColony(this.fromDbColony(row));
        }
        return null;
      } catch {
        // Fall through to in-memory store
      }
    }
    return inMem;
  }

  async findColonyById(id: string): Promise<ColonyRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.colony.findUnique({ where: { id } });
        if (row) {
          return this.saveMemColony(this.fromDbColony(row));
        }
        return null;
      } catch {
        // Fall through to in-memory store
      }
    }
    return this.coloniesById.get(id) ?? null;
  }

  findMemColonyById(id: string): ColonyRecord | null {
    return this.coloniesById.get(id) ?? null;
  }

  async listColoniesByPlanetId(planetId: string): Promise<ColonyRecord[]> {
    if (this.dbEnabled && this.prisma) {
      try {
        const rows = await this.prisma.colony.findMany({
          where: { planetId },
          orderBy: { colonyIndex: 'asc' },
        });
        return rows.map((r) => this.saveMemColony(this.fromDbColony(r)));
      } catch {
        // Fall through to in-memory store
      }
    }
    return [...this.coloniesById.values()]
      .filter((c) => c.planetId === planetId)
      .sort((a, b) => a.colonyIndex - b.colonyIndex);
  }

  async createColony(input: CreateColonyInput): Promise<{ colony: ColonyRecord; planet: PlanetRecord }> {
    const id = input.id ?? generateColonyId();
    const color = input.color ?? input.colonyIndex;
    const status = input.status ?? 'ACTIVE';
    const basePlanet = await this.upsertDevPlanet(input.planetId);

    if (this.dbEnabled && this.prisma) {
      try {
        const created = await this.prisma.colony.create({
          data: {
            id,
            playerId: input.playerId,
            planetId: input.planetId,
            colonyIndex: input.colonyIndex,
            name: input.name,
            color,
            status,
            spawnQ: input.spawnQ,
            spawnR: input.spawnR,
          },
        });
        const count = await this.prisma.colony.count({ where: { planetId: input.planetId } });
        const updatedPlanet = await this.prisma.planet.update({
          where: { id: input.planetId },
          data: { seatsTaken: count },
        });
        return {
          colony: this.saveMemColony(this.fromDbColony(created)),
          planet: this.saveMemPlanet(this.fromDbPlanet(updatedPlanet, basePlanet.radius)),
        };
      } catch {
        // Fall through to in-memory store
      }
    }

    const colony: ColonyRecord = {
      id,
      playerId: input.playerId,
      planetId: input.planetId,
      colonyIndex: input.colonyIndex,
      name: input.name,
      color,
      status,
      state: status,
      spawnQ: input.spawnQ,
      spawnR: input.spawnR,
      spawn: { q: input.spawnQ, r: input.spawnR },
      createdAt: new Date(),
    };
    this.saveMemColony(colony);
    const coloniesOnPlanet = [...this.coloniesById.values()].filter((c) => c.planetId === input.planetId).length;
    const planet = this.saveMemPlanet({
      ...basePlanet,
      seatsTaken: coloniesOnPlanet,
    });
    return { colony, planet };
  }

  /** Removes a colony whose landing failed (seat rollback) and recounts its planet's seats. */
  async deleteColony(colonyId: string): Promise<void> {
    const colony = this.coloniesById.get(colonyId);
    this.coloniesById.delete(colonyId);
    if (this.dbEnabled && this.prisma) {
      const row = await this.prisma.colony.delete({ where: { id: colonyId } }).catch(() => null);
      const planetId = row?.planetId ?? colony?.planetId;
      if (planetId) {
        const seatsTaken = await this.prisma.colony.count({ where: { planetId } });
        await this.prisma.planet.update({ where: { id: planetId }, data: { seatsTaken } }).catch(() => null);
      }
    }
    const planet = colony && this.planetsById.get(colony.planetId);
    if (planet) this.saveMemPlanet({ ...planet, seatsTaken: Math.max(0, planet.seatsTaken - 1) });
  }

  async setColonyStatus(colonyId: string, status: string): Promise<ColonyRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const updated = await this.prisma.colony.update({
          where: { id: colonyId },
          data: { status },
        });
        return this.saveMemColony(this.fromDbColony(updated));
      } catch {
        // Fall through to in-memory store
      }
    }
    const existing = this.coloniesById.get(colonyId);
    if (!existing) return null;
    return this.saveMemColony({ ...existing, status, state: status });
  }

  async setPlanetStatus(planetId: string, status: string): Promise<PlanetRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const updated = await this.prisma.planet.update({
          where: { id: planetId },
          data: { state: status },
        });
        return this.saveMemPlanet(this.fromDbPlanet(updated));
      } catch {
        // Fall through to in-memory store
      }
    }
    const existing = this.planetsById.get(planetId);
    if (!existing) return null;
    return this.saveMemPlanet({ ...existing, state: status, status });
  }

  async listPlanets(): Promise<PlanetRecord[]> {
    if (this.dbEnabled && this.prisma) {
      try {
        const rows = await this.prisma.planet.findMany();
        return rows.map((r) => this.saveMemPlanet(this.fromDbPlanet(r)));
      } catch {
        // Fall through
      }
    }
    return [...this.planetsById.values()];
  }

  async listColonies(): Promise<ColonyRecord[]> {
    if (this.dbEnabled && this.prisma) {
      try {
        const rows = await this.prisma.colony.findMany();
        return rows.map((r) => this.saveMemColony(this.fromDbColony(r)));
      } catch {
        // Fall through
      }
    }
    return [...this.coloniesById.values()];
  }

  private fromDbPlanet(
    row: {
      id: string;
      name: string;
      type: string;
      seed: string;
      state: string;
      capacity: number;
      seatsTaken: number;
      createdAt: Date;
    },
    radius = DEV_PLANET_RADIUS,
  ): PlanetRecord {
    return {
      id: row.id,
      name: row.name,
      type: normalizePlanetType(row.type),
      seed: row.seed,
      radius,
      state: row.state,
      status: row.state,
      capacity: row.capacity,
      seatsTaken: row.seatsTaken,
      createdAt: row.createdAt,
    };
  }

  private fromDbColony(row: {
    id: string;
    playerId: string;
    planetId: string;
    colonyIndex: number;
    name: string;
    color: number;
    status: string;
    spawnQ: number;
    spawnR: number;
    createdAt: Date;
  }): ColonyRecord {
    return {
      id: row.id,
      playerId: row.playerId,
      planetId: row.planetId,
      colonyIndex: row.colonyIndex,
      name: row.name,
      color: row.color,
      status: row.status,
      state: row.status,
      spawnQ: row.spawnQ,
      spawnR: row.spawnR,
      spawn: { q: row.spawnQ, r: row.spawnR },
      createdAt: row.createdAt,
    };
  }

  private saveMemPlanet(planet: PlanetRecord): PlanetRecord {
    this.planetsById.set(planet.id, planet);
    return planet;
  }

  private saveMemColony(colony: ColonyRecord): ColonyRecord {
    this.coloniesById.set(colony.id, colony);
    return colony;
  }
}
