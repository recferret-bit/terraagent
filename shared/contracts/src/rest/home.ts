import { z } from 'zod';
import { ColonyId, PlanetId } from '../ids';
import { PlanetType } from '../ws/sim';

export const HomePlanetId = z.union([PlanetId, z.string().regex(/^pl_[A-Za-z0-9_-]+$/)]);
export const HomeColonyId = z.union([ColonyId, z.string().regex(/^col?_[A-Za-z0-9_-]+$/)]);

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
export const PlanetSummarySchema = PlanetSummary;
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
export const ColonySummarySchema = ColonySummary;
export type ColonySummary = z.infer<typeof ColonySummary>;

export const HomeResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NEW'), planets: z.array(PlanetSummary), newPlanetTypes: z.array(PlanetType) }),
  z.object({ state: z.literal('QUEUED'), ticketId: z.string(), position: z.number().int(), etaS: z.number().int().nullable() }),
  z.object({ state: z.literal('ACTIVE'), colony: ColonySummary, planet: PlanetSummary, away: z.record(z.string(), z.unknown()).optional() }),
  z.object({
    state: z.literal('ELIMINATED'),
    colony: ColonySummary.optional(),
    planet: PlanetSummary.optional(),
    recap: z.record(z.string(), z.unknown()).optional(),
    planets: z.array(PlanetSummary).optional(),
    newPlanetTypes: z.array(PlanetType).optional(),
  }),
  z.object({
    state: z.literal('PLANET_ENDED'),
    colony: ColonySummary.optional(),
    planet: PlanetSummary.optional(),
    results: z.record(z.string(), z.unknown()).optional(),
    planets: z.array(PlanetSummary).optional(),
    newPlanetTypes: z.array(PlanetType).optional(),
  }),
]);
export const HomeResponseSchema = HomeResponse;
export type HomeResponse = z.infer<typeof HomeResponse>;
