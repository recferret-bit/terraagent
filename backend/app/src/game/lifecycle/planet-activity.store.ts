import type { PrismaClient } from '@terra/db';

export interface PlanetActivityRow {
  readonly planetId: string;
  /** Last time a human player had a socket on the planet (or the first time the lifecycle saw it loaded). */
  readonly lastHumanSeenAt: Date;
  /** Set while the planet is idle-unloaded. */
  readonly dormantSince: Date | null;
}

/**
 * `world.planet_activity` (migration 0037): the persisted idle clock of a planet (3.5). Written by the presence tracker
 * (the process that holds the sockets) and read by the lease holder's lifecycle job, so the two may be different
 * processes. A restart resets neither the clock nor the dormant mark.
 */
export interface PlanetActivityStore {
  /** A human was on the planet at `at` (never moves the clock back). */
  touch(planetId: string, at: Date): Promise<void>;
  /** The planet's row, created with `at` as its clock when missing (a planet first seen loaded is not idle since epoch). */
  ensure(planetId: string, at: Date): Promise<PlanetActivityRow>;
  get(planetId: string): Promise<PlanetActivityRow | null>;
  markDormant(planetId: string, at: Date): Promise<void>;
  /** Clears the dormant mark of a restored planet and starts its clock at `at`. No-op for a planet that is not dormant. */
  wake(planetId: string, at: Date): Promise<boolean>;
  dormantIds(): Promise<string[]>;
}

export class MemoryPlanetActivity implements PlanetActivityStore {
  private readonly rows = new Map<string, PlanetActivityRow>();

  async touch(planetId: string, at: Date): Promise<void> {
    const row = this.rows.get(planetId);
    const seen = row && row.lastHumanSeenAt > at ? row.lastHumanSeenAt : at;
    this.rows.set(planetId, { planetId, lastHumanSeenAt: seen, dormantSince: row?.dormantSince ?? null });
  }

  async ensure(planetId: string, at: Date): Promise<PlanetActivityRow> {
    const row = this.rows.get(planetId) ?? { planetId, lastHumanSeenAt: at, dormantSince: null };
    this.rows.set(planetId, row);
    return row;
  }

  async get(planetId: string): Promise<PlanetActivityRow | null> {
    return this.rows.get(planetId) ?? null;
  }

  async markDormant(planetId: string, at: Date): Promise<void> {
    const row = await this.ensure(planetId, at);
    this.rows.set(planetId, { ...row, dormantSince: at });
  }

  async wake(planetId: string, at: Date): Promise<boolean> {
    const row = this.rows.get(planetId);
    if (!row?.dormantSince) return false;
    this.rows.set(planetId, { planetId, dormantSince: null, lastHumanSeenAt: row.lastHumanSeenAt > at ? row.lastHumanSeenAt : at });
    return true;
  }

  async dormantIds(): Promise<string[]> {
    return [...this.rows.values()].filter((r) => r.dormantSince).map((r) => r.planetId).sort();
  }
}

interface RawRow {
  planet_id: string;
  last_human_seen_at: Date;
  dormant_since: Date | null;
}

const toRow = (r: RawRow): PlanetActivityRow => ({ planetId: r.planet_id, lastHumanSeenAt: r.last_human_seen_at, dormantSince: r.dormant_since });

/** Raw SQL on purpose: the table is read without regenerating the shared Prisma client. */
export class PrismaPlanetActivity implements PlanetActivityStore {
  constructor(private readonly prisma: PrismaClient) {}

  async touch(planetId: string, at: Date): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO world.planet_activity (planet_id, last_human_seen_at, updated_at) VALUES (${planetId}, ${at}, now())
      ON CONFLICT (planet_id) DO UPDATE
        SET last_human_seen_at = GREATEST(world.planet_activity.last_human_seen_at, EXCLUDED.last_human_seen_at), updated_at = now()`;
  }

  async ensure(planetId: string, at: Date): Promise<PlanetActivityRow> {
    await this.prisma.$executeRaw`
      INSERT INTO world.planet_activity (planet_id, last_human_seen_at, updated_at) VALUES (${planetId}, ${at}, now())
      ON CONFLICT (planet_id) DO NOTHING`;
    return (await this.get(planetId)) ?? { planetId, lastHumanSeenAt: at, dormantSince: null };
  }

  async get(planetId: string): Promise<PlanetActivityRow | null> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT planet_id, last_human_seen_at, dormant_since FROM world.planet_activity WHERE planet_id = ${planetId}`;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async markDormant(planetId: string, at: Date): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO world.planet_activity (planet_id, last_human_seen_at, dormant_since, updated_at) VALUES (${planetId}, ${at}, ${at}, now())
      ON CONFLICT (planet_id) DO UPDATE SET dormant_since = EXCLUDED.dormant_since, updated_at = now()`;
  }

  async wake(planetId: string, at: Date): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE world.planet_activity
        SET dormant_since = NULL, last_human_seen_at = GREATEST(last_human_seen_at, ${at}), updated_at = now()
        WHERE planet_id = ${planetId} AND dormant_since IS NOT NULL`;
    return n > 0;
  }

  async dormantIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ planet_id: string }[]>`
      SELECT planet_id FROM world.planet_activity WHERE dormant_since IS NOT NULL ORDER BY planet_id`;
    return rows.map((r) => r.planet_id);
  }
}
