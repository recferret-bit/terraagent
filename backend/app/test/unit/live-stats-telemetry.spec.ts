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

  it('aggregates canonical + active dev colonies, skips archived worlds, and separates players and bots', async () => {
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
          { id: 'col_0', planetId: 'pl_dev', playerId: 'pl_human_0' },
          { id: 'col_1', planetId: 'pl_dev', playerId: 'pl_human_1' },
          { id: 'col_0', planetId: 'pl_dev_ocean', playerId: 'pl_human_2' },
          { id: 'col_dead', planetId: 'pl_old', playerId: 'pl_human_3' },
        ]),
      },
      sectorReservation: {
        findMany: vi.fn().mockResolvedValue([
          { colonyId: 'col_0', planetId: 'pl_dev', playerId: 'pl_human_0' }, // duplicate of colony table
          { colonyId: 'col_t1', planetId: CANONICAL_PLANETS.temperate.id, playerId: 'pl_human_4' },
        ]),
      },
      marketStall: {
        findMany: vi.fn().mockResolvedValue([
          { colonyId: `bot-iron.${CANONICAL_PLANETS.desert.id}`, planetId: CANONICAL_PLANETS.desert.id },
          { colonyId: `bot-iron.pl_dev`, planetId: 'pl_dev' }, // dev stalls do not inflate colony counts
        ]),
      },
      tradeApiKey: {
        findMany: vi.fn().mockResolvedValue([
          { keyId: 'tk_1', planetId: CANONICAL_PLANETS.temperate.id },
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
      playerColonies: 2,
      botColonies: 1,
    });
    expect(await telemetry.getPlanetLiveCounts(CANONICAL_PLANETS.ocean.id, 'ocean')).toEqual({
      livingColonies: 1,
      presentColonies: 1,
      onlinePlayers: 1,
      playerColonies: 1,
      botColonies: 0,
    });
    expect(await telemetry.getPlanetLiveCounts(CANONICAL_PLANETS.temperate.id, 'temperate')).toEqual({
      livingColonies: 1,
      presentColonies: 1,
      onlinePlayers: 0,
      playerColonies: 1,
      botColonies: 1,
    });
    expect(await telemetry.getPublicStatsLiveCounts()).toEqual({ coloniesAlive: 5, playersOnline: 2 });
  });
});

describe('LiveStatsTelemetry · GamePlanets sim telemetry', () => {
  it('reads Rival AI bots and real seated player colonies from loaded GamePlanets sim threads without a database', async () => {
    const sim = await import('@terra/sim');
    const state = sim.createState({
      planetId: CANONICAL_PLANETS.ocean.id,
      planetType: 'ocean',
      seed: 'test-seed',
      radius: 48,
    });
    const humanCol = sim.ensureColonyRecord(state, 0, 10);
    humanCol.id = 'co_human_0';
    humanCol.name = 'Coral Haven';
    humanCol.status = 'active';
    (humanCol as Record<string, unknown>).playerId = 'plr_human_0';
    (humanCol as Record<string, unknown>).foundingSectorId = 'sec_0_0';

    sim.seedRivalAiColonies(state, { count: 2, capacity: 8, tick: 15 });
    const bytes = sim.snapshot(state);

    const gateway = {
      onlinePlayerCount: () => 1,
      onlinePlayersByPlanet: () => new Map([[CANONICAL_PLANETS.ocean.id, 1]]),
    };
    const gamePlanets = {
      loadedIds: () => [CANONICAL_PLANETS.ocean.id],
      fullState: vi.fn(async () => ({
        planetId: CANONICAL_PLANETS.ocean.id,
        tick: 15,
        bytes,
        simVersion: state.meta.simVersion,
        dataHash: 'hash',
        planetType: 'ocean',
        warp: 1,
      })),
    };

    const telemetry = new LiveStatsTelemetry(
      gateway as never,
      undefined,
      { NODE_ENV: 'development' } as never,
      gamePlanets as never,
    );

    const ocean = await telemetry.getPlanetLiveCounts(CANONICAL_PLANETS.ocean.id, 'ocean');
    expect(ocean.playerColonies).toBe(1);
    expect(ocean.botColonies).toBe(2);
    expect(ocean.onlinePlayers).toBe(1);
    expect(ocean.livingColonies).toBe(3);
    expect(ocean.liveColonies?.filter((c) => c.isBot)).toHaveLength(2);
    expect(ocean.liveColonies?.filter((c) => !c.isBot).map((c) => c.displayName)).toEqual(['Coral Haven']);
  });
});
