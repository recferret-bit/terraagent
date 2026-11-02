import { z } from 'zod';
import { ColonyId } from '../ids';
import { PlanetType } from '../ws/sim';

/**
 * Planet ids of the home flow: ULID `pl_…` ids (`PlanetId`) and the dev planet family ids (`pl_dev`, `pl_dev_ocean_2`).
 * Colony ids: new colonies get ULID `co_…` ids (`ColonyId`); rows written before 2026-11-01 keep `col_<base36>_<hex>`
 * (BE-21, owner question: drop the legacy pattern after a DB reset).
 */
export const HomePlanetId = z.string().regex(/^pl_[A-Za-z0-9_-]{1,64}$/);
export const HomeColonyId = z.union([ColonyId, z.string().regex(/^col_[A-Za-z0-9_-]{1,64}$/)]);

export const PlanetSummary = z.object({
  id: HomePlanetId,
  name: z.string().min(1).max(64),
  type: PlanetType,
  seed: z.string().min(1).max(64).optional(),
  radius: z.number().int().positive().optional(),
  state: z.string().min(1).max(32),
  status: z.string().min(1).max(32).optional(),
  capacity: z.number().int().positive().optional(),
  seatsTaken: z.number().int().nonnegative().optional(),
  seats: z.object({ taken: z.number().int().nonnegative(), capacity: z.number().int().positive() }),
  endsAtMs: z.number().int().optional(),
});
export type PlanetSummary = z.infer<typeof PlanetSummary>;

export const ColonySummary = z.object({
  id: HomeColonyId,
  playerId: z.string().min(1).optional(),
  planetId: HomePlanetId,
  colonyIndex: z.number().int().nonnegative().optional(),
  name: z.string().min(1).max(64),
  color: z.number().int().nonnegative(),
  state: z.string().min(1).max(32),
  status: z.string().min(1).max(32).optional(),
  spawnQ: z.number().int().optional(),
  spawnR: z.number().int().optional(),
});
export type ColonySummary = z.infer<typeof ColonySummary>;

export const HomeResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NEW'), planets: z.array(PlanetSummary), newPlanetTypes: z.array(PlanetType) }),
  z.object({ state: z.literal('QUEUED'), ticketId: z.string(), position: z.number().int(), etaS: z.number().int().nullable() }),
  z.object({ state: z.literal('ACTIVE'), colony: ColonySummary, planet: PlanetSummary, away: z.record(z.string(), z.unknown()).optional() }),
  // PROTOCOL §8: the recap / results, the open planets and the new planet types are required (BE-21).
  z.object({
    state: z.literal('ELIMINATED'),
    colony: ColonySummary.optional(),
    planet: PlanetSummary.optional(),
    recap: z.record(z.string(), z.unknown()),
    planets: z.array(PlanetSummary),
    newPlanetTypes: z.array(PlanetType),
  }),
  z.object({
    state: z.literal('PLANET_ENDED'),
    colony: ColonySummary.optional(),
    planet: PlanetSummary.optional(),
    results: z.record(z.string(), z.unknown()),
    planets: z.array(PlanetSummary),
    newPlanetTypes: z.array(PlanetType),
  }),
]);
export const HomeResponseSchema = HomeResponse;
export type HomeResponse = z.infer<typeof HomeResponse>;
