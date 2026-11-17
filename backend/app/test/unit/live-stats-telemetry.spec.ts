import { CANONICAL_PLANETS } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { inferPlanetTypeFromIdOrDb, LiveStatsTelemetry } from '../../src/ws/live-stats-telemetry.js';

describe('LiveStatsTelemetry', () => {
  it('resolves planet types for canonical and dev/player worlds', () => {
    expect(inferPlanetTypeFromIdOrDb(CANONICAL_PLANETS.desert.id)).toBe('desert');
    expect(inferPlanetTypeFromIdOrDb(CANONICAL_PLANETS.ocean.id)).toBe('ocean');
    expect(inferPlanetTypeFromIdOrDb(CANONICAL_PLANETS.temperate.id)).toBe('temperate');
    expect(inferPlanetTypeFromIdOrDb('pl_dev')).toBe('desert');
    expect(inferPlanetTypeFromIdOrDb('pl_dev_ocean_3')).toBe('ocean');
    expect(inferPlanetTypeFromIdOrDb('pl_custom_99', 'temperate')).toBe('temperate');
  });

  it('aggregates canonical + active dev colonies, skips archived worlds, and returns numeric 0 when no players are online', async () => {
    const gateway = {
      onlinePlayerCount: vi.fn(() => 0),
      onlinePlayersByPlanet: vi.fn(() => new Map<string, number>()),
    };
    const prisma = {
      planet: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pl_dev', type: 'desert', state: 'ACTIVE', lifecycle: 'ACTIVE' },
          { id: 'pl_dev_ocean', type: 'ocean', state: 'ACTIVE', lifecycle: 'ACTIVE' },
          { id: 'pl_old', type: 'desert', state: 'ENDED', lifecycle: 'ARCHIVED' },
        ]),
      },
      colony: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'col_0', planetId: 'pl_dev' },
          { id: 'col_1', planetId: 'pl_dev' },
          { id: 'col_0', planetId: 'pl_dev_ocean' },
          { id: 'col_dead', planetId: 'pl_old' },
        ]),
      },
      sectorReservation: {
        findMany: vi.fn().mockResolvedValue([
          { colonyId: 'col_0', planetId: 'pl_dev' }, // duplicate of colony table
          { colonyId: 'col_t1', planetId: CANONICAL_PLANETS.temperate.id },
        ]),
      },
      marketStall: {
        findMany: vi.fn().mockResolvedValue([
          { colonyId: `bot-iron.${CANONICAL_PLANETS.desert.id}`, planetId: CANONICAL_PLANETS.desert.id },
          { colonyId: `bot-iron.pl_dev`, planetId: 'pl_dev' }, // dev stalls do not inflate colony counts
        ]),
      },
    };

    const telemetry = new LiveStatsTelemetry(
      gateway as never,
      prisma as never,
      { NODE_ENV: 'production', DATABASE_URL: 'postgres://db' } as never,
    );

    const stats = await telemetry.getPublicStatsLiveCounts();
    expect(stats).toEqual({ coloniesAlive: 5, playersOnline: 0 });

    gateway.onlinePlayerCount.mockReturnValue(2);
    gateway.onlinePlayersByPlanet.mockReturnValue(
      new Map([
        ['pl_dev', 1],
        ['pl_dev_ocean', 1],
      ]),
    );

    expect(await telemetry.getPlanetLiveCounts(CANONICAL_PLANETS.desert.id, 'desert')).toEqual({
      livingColonies: 3,
      presentColonies: 3,
      onlinePlayers: 1,
    });
    expect(await telemetry.getPlanetLiveCounts(CANONICAL_PLANETS.ocean.id, 'ocean')).toEqual({
      livingColonies: 1,
      presentColonies: 1,
      onlinePlayers: 1,
    });
    expect(await telemetry.getPlanetLiveCounts(CANONICAL_PLANETS.temperate.id, 'temperate')).toEqual({
      livingColonies: 1,
      presentColonies: 1,
      onlinePlayers: 0,
    });
    expect(await telemetry.getPublicStatsLiveCounts()).toEqual({ coloniesAlive: 5, playersOnline: 2 });
  });
});
