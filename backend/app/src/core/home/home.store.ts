import type { PlanetType } from '@terra/contracts';

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

/** A planet row to create when missing (all fields decided by the caller). */
export interface NewPlanetRow {
  readonly id: string;
  readonly name: string;
  readonly type: PlanetType;
  readonly seed: string;
  readonly radius: number;
  readonly state: string;
  readonly capacity: number;
}

/** A colony row to insert (all fields decided by the caller). */
export interface NewColonyRow {
  readonly id: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly name: string;
  readonly color: number;
  readonly status: string;
  readonly spawnQ: number;
  readonly spawnR: number;
}

/**
 * Where planet and colony rows live: Postgres (`PrismaHomeStore`) or process memory ({@link MemoryHomeStore}),
 * chosen once by `HomeRepository`. Errors are never swallowed (a unique `(planet, colonyIndex)` clash propagates).
 */
export interface HomeStore {
  findPlanet(id: string): Promise<PlanetRecord | null>;
  /** The planet row, created from `row` when missing (an existing row is returned unchanged). */
  upsertPlanet(row: NewPlanetRow): Promise<PlanetRecord>;
  setPlanetType(id: string, type: PlanetType): Promise<PlanetRecord | null>;
  setPlanetState(id: string, state: string): Promise<PlanetRecord | null>;
  listPlanets(): Promise<PlanetRecord[]>;
  findColony(id: string): Promise<ColonyRecord | null>;
  /** The player's newest colony, optionally on one planet. */
  findLatestColony(playerId: string, planetId?: string): Promise<ColonyRecord | null>;
  listColonies(planetId?: string): Promise<ColonyRecord[]>;
  /** Inserts the colony and recounts its planet's seats. */
  createColony(row: NewColonyRow): Promise<{ colony: ColonyRecord; planet: PlanetRecord | null }>;
  /** Deletes the colony (if any) and recounts its planet's seats; returns the planet id it was on. */
  deleteColony(id: string): Promise<string | null>;
  setColonyStatus(id: string, status: string): Promise<ColonyRecord | null>;
  /** Deletes every colony row of the planet and resets its seat count (dev wipe); returns how many colonies. */
  deleteColoniesOfPlanet(planetId: string): Promise<number>;
}

export function colonyFromRow(row: NewColonyRow & { createdAt: Date }): ColonyRecord {
  return { ...row, state: row.status, spawn: { q: row.spawnQ, r: row.spawnR } };
}

const newest = (a: ColonyRecord | null, b: ColonyRecord) => (!a || b.createdAt.getTime() >= a.createdAt.getTime() ? b : a);

/** Process-memory store (unit tests, and runs where colony rows do not persist: `persistenceEnabled` off). */
export class MemoryHomeStore implements HomeStore {
  private readonly planets = new Map<string, PlanetRecord>();
  private readonly colonies = new Map<string, ColonyRecord>();

  async findPlanet(id: string): Promise<PlanetRecord | null> {
    return this.planets.get(id) ?? null;
  }

  async upsertPlanet(row: NewPlanetRow): Promise<PlanetRecord> {
    const existing = this.planets.get(row.id);
    if (existing) return existing;
    const planet: PlanetRecord = { ...row, status: row.state, seatsTaken: 0, createdAt: new Date() };
    this.planets.set(planet.id, planet);
    return planet;
  }

  async setPlanetType(id: string, type: PlanetType): Promise<PlanetRecord | null> {
    return this.patchPlanet(id, { type });
  }

  async setPlanetState(id: string, state: string): Promise<PlanetRecord | null> {
    return this.patchPlanet(id, { state, status: state });
  }

  async listPlanets(): Promise<PlanetRecord[]> {
    return [...this.planets.values()];
  }

  async findColony(id: string): Promise<ColonyRecord | null> {
    return this.colonies.get(id) ?? null;
  }

  async findLatestColony(playerId: string, planetId?: string): Promise<ColonyRecord | null> {
    let latest: ColonyRecord | null = null;
    for (const c of this.colonies.values()) if (c.playerId === playerId && (planetId === undefined || c.planetId === planetId)) latest = newest(latest, c);
    return latest;
  }

  async listColonies(planetId?: string): Promise<ColonyRecord[]> {
    return [...this.colonies.values()].filter((c) => planetId === undefined || c.planetId === planetId).sort((a, b) => a.colonyIndex - b.colonyIndex);
  }

  async createColony(row: NewColonyRow): Promise<{ colony: ColonyRecord; planet: PlanetRecord | null }> {
    if ([...this.colonies.values()].some((c) => c.planetId === row.planetId && c.colonyIndex === row.colonyIndex)) {
      throw new Error(`colony index ${row.colonyIndex} on ${row.planetId} is taken`);
    }
    const colony = colonyFromRow({ ...row, createdAt: new Date() });
    this.colonies.set(colony.id, colony);
    return { colony, planet: this.recount(row.planetId) };
  }

  async deleteColony(id: string): Promise<string | null> {
    const colony = this.colonies.get(id);
    if (!colony) return null;
    this.colonies.delete(id);
    this.recount(colony.planetId);
    return colony.planetId;
  }

  async setColonyStatus(id: string, status: string): Promise<ColonyRecord | null> {
    const c = this.colonies.get(id);
    if (!c) return null;
    const next = { ...c, status, state: status };
    this.colonies.set(id, next);
    return next;
  }

  async deleteColoniesOfPlanet(planetId: string): Promise<number> {
    const ids = [...this.colonies.values()].filter((c) => c.planetId === planetId).map((c) => c.id);
    for (const id of ids) this.colonies.delete(id);
    this.recount(planetId);
    return ids.length;
  }

  private recount(planetId: string): PlanetRecord | null {
    const seatsTaken = [...this.colonies.values()].filter((c) => c.planetId === planetId).length;
    return this.patchPlanet(planetId, { seatsTaken });
  }

  private patchPlanet(id: string, patch: Partial<PlanetRecord>): PlanetRecord | null {
    const p = this.planets.get(id);
    if (!p) return null;
    const next = { ...p, ...patch };
    this.planets.set(id, next);
    return next;
  }
}
