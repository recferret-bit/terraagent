import { z } from 'zod';
import { ColonyId, PlanetId } from '../ids';
import { PlanetType } from '../ws/sim';

export const PlanetSummary = z.object({
  id: PlanetId,
  name: z.string().min(1).max(64),
  type: PlanetType,
  state: z.string().min(1).max(32),
  seats: z.object({ taken: z.number().int().nonnegative(), capacity: z.number().int().positive() }),
  endsAtMs: z.number().int().optional(),
});
export type PlanetSummary = z.infer<typeof PlanetSummary>;

export const ColonySummary = z.object({
  id: ColonyId,
  planetId: PlanetId,
  name: z.string().min(1).max(32),
  color: z.number().int().nonnegative(),
  state: z.string().min(1).max(32),
  spawnQ: z.number().int().optional(),
  spawnR: z.number().int().optional(),
});
export type ColonySummary = z.infer<typeof ColonySummary>;

export const HomeResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NEW'), planets: z.array(PlanetSummary), newPlanetTypes: z.array(PlanetType) }),
  z.object({ state: z.literal('QUEUED'), ticketId: z.string(), position: z.number().int(), etaS: z.number().int().nullable() }),
  z.object({ state: z.literal('ACTIVE'), colony: ColonySummary, planet: PlanetSummary, away: z.record(z.string(), z.unknown()).optional() }),
  z.object({ state: z.literal('ELIMINATED'), recap: z.record(z.string(), z.unknown()), planets: z.array(PlanetSummary), newPlanetTypes: z.array(PlanetType) }),
  z.object({ state: z.literal('PLANET_ENDED'), results: z.record(z.string(), z.unknown()), planets: z.array(PlanetSummary), newPlanetTypes: z.array(PlanetType) }),
]);
export type HomeResponse = z.infer<typeof HomeResponse>;
