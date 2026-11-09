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
  look: z.enum(['dune', 'oceanForest', 'forestRock']).optional(),
  seed: z.string().min(1).max(64).optional(),
  radius: z.number().int().positive().optional(),
  state: z.string().min(1).max(32),
  status: z.string().min(1).max(32).optional(),
  lifecycle: z.enum(['PROVISIONING', 'ACTIVE', 'ARCHIVED']).optional(),
  health: z.enum(['OK', 'LOADING', 'RETRYING', 'FAULTED']).optional(),
  admission: z.enum(['OPEN', 'PAUSED', 'ARCHIVED']).optional(),
  availability: z.enum(['open', 'full', 'paused', 'faulted', 'archived']).optional(),
  atlasVersion: z.number().int().positive().optional(),
  atlasHash: z.string().min(1).max(128).optional(),
  configHash: z.string().min(1).max(128).optional(),
  totalSectors: z.number().int().positive().optional(),
  landSectors: z.number().int().positive().optional(),
  oceanSectors: z.number().int().nonnegative().optional(),
  nominalCapacity: z.number().int().nonnegative().optional(),
  validatedCapacity: z.number().int().nonnegative().optional(),
  reservedSeats: z.number().int().nonnegative().optional(),
  foundedSeats: z.number().int().nonnegative().optional(),
  freeSeats: z.number().int().nonnegative().optional(),
  livingColonies: z.number().int().nonnegative().nullable().optional(),
  presentColonies: z.number().int().nonnegative().nullable().optional(),
  onlinePlayers: z.number().int().nonnegative().nullable().optional(),
  updatedAt: z.string().optional(),
  sectors: z.array(z.record(z.string(), z.unknown())).optional(),
  capacity: z.number().int().nonnegative().optional(),
  seatsTaken: z.number().int().nonnegative().optional(),
  seats: z.object({ taken: z.number().int().nonnegative(), capacity: z.number().int().nonnegative() }),
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
  foundingSectorId: z.string().regex(/^sec_-?\d+_-?\d+$/).optional(),
  landingSlotId: z.string().regex(/^slot_sec_-?\d+_-?\d+_\d+$/).optional(),
  spawnQ: z.number().int().optional(),
  spawnR: z.number().int().optional(),
});
export type ColonySummary = z.infer<typeof ColonySummary>;

export const HomeResponse = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('NEW'),
    planets: z.array(PlanetSummary),
    newPlanetTypes: z.array(PlanetType).default([]),
    queuePaused: z.boolean().optional(),
  }),
  z.object({
    state: z.literal('QUEUED'),
    ticketId: z.string(),
    ticketState: z.string().optional(),
    planetId: HomePlanetId.optional(),
    planetType: PlanetType.optional(),
    sectorIntent: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('chosen'), sectorId: z.string() }),
        z.object({ kind: z.literal('auto') }),
      ])
      .optional(),
    reservedSectorId: z.string().nullable().optional(),
    alternativeSectors: z.array(z.string()).optional(),
    position: z.number().int(),
    etaS: z.number().int().nullable(),
  }),
  z.object({ state: z.literal('ACTIVE'), colony: ColonySummary, planet: PlanetSummary, away: z.record(z.string(), z.unknown()).optional() }),
  // PROTOCOL §8: the recap / results, the open planets and the new planet types are required (BE-21).
  z.object({
    state: z.literal('ELIMINATED'),
    colony: ColonySummary.optional(),
    planet: PlanetSummary.optional(),
    recap: z.record(z.string(), z.unknown()),
    recapSeen: z.boolean().optional(),
    planets: z.array(PlanetSummary),
    newPlanetTypes: z.array(PlanetType).default([]),
  }),
  z.object({
    state: z.literal('PLANET_ENDED'),
    colony: ColonySummary.optional(),
    planet: PlanetSummary.optional(),
    results: z.record(z.string(), z.unknown()),
    recapSeen: z.boolean().optional(),
    planets: z.array(PlanetSummary),
    newPlanetTypes: z.array(PlanetType).default([]),
  }),
]);
export const HomeResponseSchema = HomeResponse;
export type HomeResponse = z.infer<typeof HomeResponse>;
