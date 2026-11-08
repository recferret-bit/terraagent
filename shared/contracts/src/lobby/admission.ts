import { z } from 'zod';
import { HomeColonyId, HomePlanetId } from '../rest/home';
import { PlanetType, ResourceKey, TileCoord } from '../ws/sim';
import {
  ContinentIdSchema,
  PlanetLookSchema,
  planetLookForType,
  SectorIdSchema,
  SectorKindSchema,
  type SectorId,
  type SectorKind,
} from './atlas';

/**
 * Persistent world lifecycle, health, admission, and derived availability (MATCHMAKING §0.2, §0.3).
 * Full is derived availability from free validated slots, never a permanent SEALED lifecycle transition.
 */
export const WORLD_LIFECYCLE_STATES = ['PROVISIONING', 'ACTIVE', 'ARCHIVED'] as const;
export const WorldLifecycleStateSchema = z.enum(WORLD_LIFECYCLE_STATES);
export type WorldLifecycleState = z.infer<typeof WorldLifecycleStateSchema>;

export const WORLD_HEALTH_STATES = ['OK', 'LOADING', 'RETRYING', 'FAULTED'] as const;
export const WorldHealthStateSchema = z.enum(WORLD_HEALTH_STATES);
export type WorldHealthState = z.infer<typeof WorldHealthStateSchema>;

export const WORLD_ADMISSION_STATES = ['OPEN', 'PAUSED', 'ARCHIVED'] as const;
export const WorldAdmissionStateSchema = z.enum(WORLD_ADMISSION_STATES);
export type WorldAdmissionState = z.infer<typeof WorldAdmissionStateSchema>;

export const WORLD_AVAILABILITY_STATES = ['open', 'full', 'paused', 'faulted', 'archived'] as const;
export const WorldAvailabilitySchema = z.enum(WORLD_AVAILABILITY_STATES);
export type WorldAvailability = z.infer<typeof WorldAvailabilitySchema>;

export interface DeriveAvailabilityInput {
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly freeSeats: number;
  readonly sectorKind?: SectorKind;
}

/**
 * Pure availability derivation (MATCHMAKING §0.2 MM-03/04/06/20):
 * - archived lifecycle/admission → 'archived'
 * - non-OK health or still provisioning → 'faulted'
 * - paused admission → 'paused'
 * - ocean sector or 0 free seats → 'full'
 * - otherwise → 'open'
 */
export function deriveWorldAvailability(input: DeriveAvailabilityInput): WorldAvailability {
  if (input.lifecycle === 'ARCHIVED' || input.admission === 'ARCHIVED') return 'archived';
  if (input.lifecycle !== 'ACTIVE' || input.health !== 'OK') return 'faulted';
  if (input.admission === 'PAUSED') return 'paused';
  if (input.sectorKind === 'ocean' || input.freeSeats <= 0) return 'full';
  return 'open';
}

export interface SectorOccupancyInput {
  readonly kind: SectorKind;
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly livingColonies: number | null;
  readonly presentColonies: number | null;
  readonly onlinePlayers: number | null;
  readonly lifecycle?: WorldLifecycleState;
  readonly health?: WorldHealthState;
  readonly admission?: WorldAdmissionState;
}

export interface DerivedSectorOccupancy {
  readonly freeSeats: number;
  readonly availability: WorldAvailability;
}

/**
 * Pure sector occupancy & availability computation (MATCHMAKING §0.2 MM-05/33):
 * Reserved and founded seats consume founding capacity; moving/online/present counts never change founding seats.
 */
export function deriveSectorOccupancy(input: SectorOccupancyInput): DerivedSectorOccupancy {
  const effectiveCap = input.kind === 'ocean' ? 0 : Math.min(input.foundingCapacity, input.validatedCapacity);
  const used = input.reservedSeats + input.foundedSeats;
  const freeSeats = Math.max(0, effectiveCap - used);
  const availability = deriveWorldAvailability({
    lifecycle: input.lifecycle ?? 'ACTIVE',
    health: input.health ?? 'OK',
    admission: input.admission ?? 'OPEN',
    freeSeats,
    sectorKind: input.kind,
  });
  return { freeSeats, availability };
}

export const SectorSummaryV1Schema = z
  .strictObject({
    sectorId: SectorIdSchema,
    continentId: ContinentIdSchema.nullable(),
    macroQ: z.number().int(),
    macroR: z.number().int(),
    centerQ: TileCoord,
    centerR: TileCoord,
    kind: SectorKindSchema,
    foundingCapacity: z.number().int().nonnegative(),
    validatedCapacity: z.number().int().nonnegative(),
    reservedSeats: z.number().int().nonnegative(),
    foundedSeats: z.number().int().nonnegative(),
    freeSeats: z.number().int().nonnegative(),
    livingColonies: z.number().int().nonnegative().nullable(),
    presentColonies: z.number().int().nonnegative().nullable(),
    onlinePlayers: z.number().int().nonnegative().nullable(),
    availability: WorldAvailabilitySchema,
    mainResource: ResourceKey.optional(),
    scarceResources: z.array(ResourceKey).optional(),
  })
  .superRefine((sec, ctx) => {
    if (sec.kind === 'ocean' && (sec.foundingCapacity !== 0 || sec.validatedCapacity !== 0 || sec.freeSeats !== 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['foundingCapacity'],
        message: 'ocean sectors cannot have founding capacity or free seats',
      });
    }
    if (sec.validatedCapacity > sec.foundingCapacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validatedCapacity'],
        message: 'validatedCapacity cannot exceed foundingCapacity',
      });
    }
    const expectedFree = Math.max(0, sec.validatedCapacity - sec.reservedSeats - sec.foundedSeats);
    if (sec.freeSeats !== expectedFree) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['freeSeats'],
        message: `freeSeats (${sec.freeSeats}) must equal max(0, validatedCapacity - reservedSeats - foundedSeats) (${expectedFree})`,
      });
    }
  });
export type SectorSummaryV1 = z.infer<typeof SectorSummaryV1Schema>;

export const PublicColonySummaryV1Schema = z.strictObject({
  colonyId: HomeColonyId,
  displayName: z.string().min(1).max(64),
  foundingSectorId: SectorIdSchema,
  foundedAt: z.string().datetime(),
});
export type PublicColonySummaryV1 = z.infer<typeof PublicColonySummaryV1Schema>;

/**
 * `PlanetSummaryV1` (MATCHMAKING §0.3):
 * Canonical ID/type/look, lifecycle/health/admission, derived availability, atlas version/hash,
 * total/land/ocean sector counts, validated capacity, reserved/founded/free seats,
 * nullable live counts (living/present/online), updated time, and sector summaries.
 * Strictly rejects legacy `admissionClosesAt` / `endsAt` timers and `newPlanet` fields.
 */
export const PlanetSummaryV1Schema = z
  .strictObject({
    id: HomePlanetId,
    name: z.string().min(1).max(64),
    type: PlanetType,
    look: PlanetLookSchema,
    lifecycle: WorldLifecycleStateSchema,
    health: WorldHealthStateSchema,
    admission: WorldAdmissionStateSchema,
    availability: WorldAvailabilitySchema,
    atlasVersion: z.number().int().positive(),
    atlasHash: z.string().min(1).max(128),
    configHash: z.string().min(1).max(128),
    totalSectors: z.number().int().positive(),
    landSectors: z.number().int().positive(),
    oceanSectors: z.number().int().nonnegative(),
    nominalCapacity: z.number().int().nonnegative(),
    validatedCapacity: z.number().int().nonnegative(),
    reservedSeats: z.number().int().nonnegative(),
    foundedSeats: z.number().int().nonnegative(),
    freeSeats: z.number().int().nonnegative(),
    livingColonies: z.number().int().nonnegative().nullable(),
    presentColonies: z.number().int().nonnegative().nullable(),
    onlinePlayers: z.number().int().nonnegative().nullable(),
    updatedAt: z.string().datetime(),
    sectors: z.array(SectorSummaryV1Schema).min(1),
    colonies: z.array(PublicColonySummaryV1Schema).optional(),
    faultCode: z.string().min(1).max(64).nullable().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.look !== planetLookForType(p.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['look'],
        message: `look "${p.look}" does not match planet type "${p.type}"`,
      });
    }
    const expectedAvail = deriveWorldAvailability({
      lifecycle: p.lifecycle,
      health: p.health,
      admission: p.admission,
      freeSeats: p.freeSeats,
    });
    if (p.availability !== expectedAvail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availability'],
        message: `availability "${p.availability}" does not match derived "${expectedAvail}"`,
      });
    }
    const expectedFree = Math.max(0, p.validatedCapacity - p.reservedSeats - p.foundedSeats);
    if (p.freeSeats !== expectedFree) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['freeSeats'],
        message: `freeSeats (${p.freeSeats}) must equal max(0, validatedCapacity - reservedSeats - foundedSeats) (${expectedFree})`,
      });
    }
  });
export type PlanetSummaryV1 = z.infer<typeof PlanetSummaryV1Schema>;

/**
 * `PlanetListV1` (MATCHMAKING §0.3):
 * Always lists all three canonical types in one response; strictly omits `newPlanet`.
 */
export const PlanetListV1Schema = z
  .strictObject({
    planets: z.array(PlanetSummaryV1Schema).length(3),
    queuePaused: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((list, ctx) => {
    const types = new Set(list.planets.map((p) => p.type));
    for (const requiredType of ['desert', 'ocean', 'temperate'] as const) {
      if (!types.has(requiredType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['planets'],
          message: `PlanetListV1 must contain all three canonical planet types; missing "${requiredType}"`,
        });
      }
    }
  });
export type PlanetListV1 = z.infer<typeof PlanetListV1Schema>;

export const PublicPlanetStatsV1Schema = z.strictObject({
  planetsActive: z.number().int().nonnegative(),
  coloniesAlive: z.number().int().nonnegative().nullable(),
  playersOnline: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().datetime(),
});
export type PublicPlanetStatsV1 = z.infer<typeof PublicPlanetStatsV1Schema>;
export type { SectorId };
