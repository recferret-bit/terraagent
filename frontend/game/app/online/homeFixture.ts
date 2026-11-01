import type { HomeResponse, PlanetType } from '@terra/contracts';

/** Test-only: a ULID-shaped colony id as the server mints them (`co_<ULID>`). */
export const TEST_COLONY_ID = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAW';

/**
 * Test-only: an `ACTIVE` `/v1/me/home` answer exactly as the server sends it (`toColonySummary` / `toPlanetSummary`), so
 * the boot specs exercise the contract parse (`HomeResponse`) instead of a hand-shaped object.
 */
export function activeHome(o: { colonyIndex?: number; planetId?: string; type?: PlanetType; spawnQ?: number; spawnR?: number; colonyId?: string; radius?: number } = {}): HomeResponse {
  const planetId = o.planetId ?? 'pl_dev';
  return {
    state: 'ACTIVE',
    colony: {
      id: o.colonyId ?? TEST_COLONY_ID, playerId: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', planetId, colonyIndex: o.colonyIndex ?? 0,
      name: "Colonist-0001's Colony", color: o.colonyIndex ?? 0, state: 'ACTIVE', status: 'ACTIVE', spawnQ: o.spawnQ ?? 4, spawnR: o.spawnR ?? -2,
    },
    planet: {
      id: planetId, name: 'Dev Planet', type: o.type ?? 'desert', seed: 'golden-1', radius: o.radius ?? 56, state: 'ACTIVE', status: 'ACTIVE',
      capacity: 5, seatsTaken: 1, seats: { taken: 1, capacity: 5 },
    },
  };
}
