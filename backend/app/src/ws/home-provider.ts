import type { HomeResponse } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { AppEnv } from '../core/tokens';

/** Resolves the player's `HomeResponse` for the WS `ready` payload (PROTOCOL §4.3, W01-03). */
export interface HomeProvider {
  getHome(playerId: string): Promise<HomeResponse>;
}

export const HOME_PROVIDER = Symbol('HOME_PROVIDER');

export const DEFAULT_HOME: HomeResponse = {
  state: 'NEW',
  planets: [],
  newPlanetTypes: ['temperate'],
};

/**
 * Default WS home provider: checks `core.colony` / `core.planet` when Postgres is configured, otherwise returns the
 * `NEW` home summary. W01-04 can rebind `HOME_PROVIDER` or populate `core.colony` on `/v1/me/home`.
 */
export class DbHomeProvider implements HomeProvider {
  private readonly dbEnabled: boolean;

  constructor(
    private readonly prisma?: PrismaClient,
    env?: Pick<AppEnv, 'NODE_ENV' | 'DATABASE_URL'>,
  ) {
    this.dbEnabled = Boolean(prisma) && (!env || env.NODE_ENV !== 'test' || Boolean(env.DATABASE_URL));
  }

  async getHome(playerId: string): Promise<HomeResponse> {
    if (!this.dbEnabled || !this.prisma) return DEFAULT_HOME;
    try {
      const colony = await this.prisma.colony.findFirst({
        where: { playerId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
      if (!colony) return DEFAULT_HOME;
      const planet = await this.prisma.planet.findUnique({ where: { id: colony.planetId } });
      const planetType =
        planet?.type === 'desert' || planet?.type === 'ocean' || planet?.type === 'temperate'
          ? planet.type
          : 'temperate';
      return {
        state: 'ACTIVE',
        colony: {
          id: colony.id,
          planetId: colony.planetId,
          name: colony.name,
          color: colony.color,
          state: colony.status,
          spawnQ: colony.spawnQ,
          spawnR: colony.spawnR,
        },
        planet: {
          id: planet?.id ?? colony.planetId,
          name: planet?.name ?? colony.planetId,
          type: planetType,
          state: planet?.state ?? 'ACTIVE',
          seats: { taken: planet?.seatsTaken ?? 1, capacity: planet?.capacity ?? 5 },
        },
      };
    } catch {
      return DEFAULT_HOME;
    }
  }
}
