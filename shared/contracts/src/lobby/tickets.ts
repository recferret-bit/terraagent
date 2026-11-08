import { z } from 'zod';
import { PlayerId } from '../ids';
import { HomeColonyId, HomePlanetId } from '../rest/home';
import { PlanetType, TileCoord } from '../ws/sim';
import { PlanetSummaryV1Schema } from './admission';
import { CANONICAL_PLANETS, LandingSlotIdSchema, SectorIdSchema } from './atlas';

/**
 * Matchmaking modes (MATCHMAKING §0.3):
 * `NEW_PLANET` is permanently removed and explicitly rejected with `unsupported_mode`.
 */
export const SUPPORTED_MATCH_MODES = ['JOIN_PLANET', 'AUTO', 'TRANSFER'] as const;
export const MatchModeV1Schema = z.enum(SUPPORTED_MATCH_MODES);
export type MatchModeV1 = z.infer<typeof MatchModeV1Schema>;

export const SectorPlacementIntentV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('chosen'),
    sectorId: SectorIdSchema,
  }),
  z.strictObject({
    kind: z.literal('auto'),
  }),
]);
export type SectorPlacementIntentV1 = z.infer<typeof SectorPlacementIntentV1Schema>;

export const EnqueueTicketRequestV1Schema = z
  .strictObject({
    mode: z.string().min(1).max(32),
    planetId: HomePlanetId.optional(),
    planetType: PlanetType.optional(),
    sectorId: SectorIdSchema.optional(),
    autoSector: z.boolean().optional(),
    partyId: z.string().min(1).max(64).optional(),
    sourcePlanetId: HomePlanetId.optional(),
    sourceColonyId: HomeColonyId.optional(),
    carryOver: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((req, ctx) => {
    if (req.mode === 'NEW_PLANET') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: 'unsupported_mode: NEW_PLANET is not supported on persistent canonical worlds',
      });
      return;
    }
    if (!SUPPORTED_MATCH_MODES.includes(req.mode as MatchModeV1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: `unsupported_mode: expected one of ${SUPPORTED_MATCH_MODES.join(', ')}`,
      });
      return;
    }
    if (!req.planetId && !req.planetType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planetId'],
        message: 'either planetId or planetType is required',
      });
    }
    if (req.sectorId && req.autoSector === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: 'cannot specify both a chosen sectorId and autoSector=true',
      });
    }
    if (req.mode === 'JOIN_PLANET' && !req.sectorId && req.autoSector !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: 'JOIN_PLANET requires either a chosen sectorId or explicit autoSector=true',
      });
    }
    if (req.mode === 'TRANSFER') {
      if (!req.sourcePlanetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourcePlanetId'],
          message: 'TRANSFER requires sourcePlanetId',
        });
      }
      const targetId = req.planetId ?? (req.planetType ? CANONICAL_PLANETS[req.planetType].id : undefined);
      if (targetId && req.sourcePlanetId && targetId === req.sourcePlanetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['planetId'],
          message: 'same_planet_transfer: TRANSFER must select a different canonical planet',
        });
      }
    }
  });
export type EnqueueTicketRequestV1 = z.infer<typeof EnqueueTicketRequestV1Schema>;

export interface NormalizedTicketIntentV1 {
  readonly mode: MatchModeV1;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorIntent: SectorPlacementIntentV1;
  readonly partyId?: string;
  readonly sourcePlanetId?: string;
  readonly sourceColonyId?: string;
  readonly carryOver?: Record<string, unknown>;
}

export type ParseTicketIntentResult =
  | { readonly ok: true; readonly value: NormalizedTicketIntentV1 }
  | { readonly ok: false; readonly errorCode: 'unsupported_mode' | 'same_planet_transfer' | 'validation_error'; readonly message: string };

/**
 * Validates and normalizes an admission/ticket request against W11 persistent-world rules:
 * - Rejects `NEW_PLANET` with `unsupported_mode`
 * - Rejects same-planet `TRANSFER` with `same_planet_transfer`
 * - Resolves canonical `planetId` and `planetType` and explicit `chosen` vs `auto` sector placement intent
 */
export function parseMatchTicketRequest(raw: unknown): ParseTicketIntentResult {
  if (typeof raw === 'object' && raw !== null && (raw as { mode?: unknown }).mode === 'NEW_PLANET') {
    return {
      ok: false,
      errorCode: 'unsupported_mode',
      message: 'NEW_PLANET is not supported: canonical persistent worlds never create on-demand planet instances',
    };
  }
  const parsed = EnqueueTicketRequestV1Schema.safeParse(raw);
  if (!parsed.success) {
    const firstMsg = parsed.error.issues[0]?.message ?? 'Invalid match ticket request';
    if (firstMsg.startsWith('unsupported_mode:')) {
      return { ok: false, errorCode: 'unsupported_mode', message: firstMsg };
    }
    if (firstMsg.startsWith('same_planet_transfer:')) {
      return { ok: false, errorCode: 'same_planet_transfer', message: firstMsg };
    }
    return { ok: false, errorCode: 'validation_error', message: firstMsg };
  }
  const req = parsed.data;
  const planetType: PlanetType =
    req.planetType ??
    (req.planetId === CANONICAL_PLANETS.ocean.id
      ? 'ocean'
      : req.planetId === CANONICAL_PLANETS.temperate.id
        ? 'temperate'
        : 'desert');
  const planetId = req.planetId ?? CANONICAL_PLANETS[planetType].id;
  if (req.mode === 'TRANSFER' && req.sourcePlanetId === planetId) {
    return {
      ok: false,
      errorCode: 'same_planet_transfer',
      message: 'TRANSFER requires an eligible different canonical planet',
    };
  }
  const sectorIntent: SectorPlacementIntentV1 = req.sectorId
    ? { kind: 'chosen', sectorId: req.sectorId }
    : { kind: 'auto' };

  return {
    ok: true,
    value: {
      mode: req.mode as MatchModeV1,
      planetId,
      planetType,
      sectorIntent,
      ...(req.partyId ? { partyId: req.partyId } : {}),
      ...(req.sourcePlanetId ? { sourcePlanetId: req.sourcePlanetId } : {}),
      ...(req.sourceColonyId ? { sourceColonyId: req.sourceColonyId } : {}),
      ...(req.carryOver ? { carryOver: req.carryOver } : {}),
    },
  };
}

export const TICKET_STATES_V1 = [
  'QUEUED',
  'RESERVED',
  'SPAWNING',
  'ASSIGNED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
] as const;
export const TicketStateV1Schema = z.enum(TICKET_STATES_V1);
export type TicketStateV1 = z.infer<typeof TicketStateV1Schema>;

export const RESERVATION_STATES_V1 = ['HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const;
export const ReservationStateV1Schema = z.enum(RESERVATION_STATES_V1);
export type ReservationStateV1 = z.infer<typeof ReservationStateV1Schema>;

export const SectorReservationV1Schema = z.strictObject({
  reservationId: z.string().min(1).max(64),
  ticketId: z.string().min(1).max(64),
  colonyId: HomeColonyId,
  playerId: PlayerId,
  planetId: HomePlanetId,
  sectorId: SectorIdSchema,
  landingSlotId: LandingSlotIdSchema,
  slotIndex: z.number().int().nonnegative(),
  q: TileCoord,
  r: TileCoord,
  epoch: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  state: ReservationStateV1Schema,
});
export type SectorReservationV1 = z.infer<typeof SectorReservationV1Schema>;

export const MatchTicketV1Schema = z.strictObject({
  id: z.string().min(1).max(64),
  playerId: PlayerId,
  partyId: z.string().min(1).max(64).nullable().optional(),
  mode: MatchModeV1Schema,
  planetId: HomePlanetId,
  planetType: PlanetType,
  sectorIntent: SectorPlacementIntentV1Schema,
  state: TicketStateV1Schema,
  priority: z.number().int(),
  position: z.number().int().nonnegative().nullable(),
  etaS: z.number().int().nonnegative().nullable(),
  colonyId: HomeColonyId,
  reservedPlanetId: HomePlanetId.nullable(),
  reservedSectorId: SectorIdSchema.nullable(),
  reservedLandingSlotId: LandingSlotIdSchema.nullable(),
  reservationEpoch: z.number().int().nonnegative().nullable().optional(),
  reservationExpiresAt: z.string().datetime().nullable(),
  alternativeSectors: z.array(SectorIdSchema).optional(),
  attempts: z.number().int().nonnegative(),
  failureCode: z.string().max(64).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MatchTicketV1 = z.infer<typeof MatchTicketV1Schema>;

/** Party contracts (MM-55): maximum 5 members independent of sector capacity X. */
export const PARTY_MAX_MEMBERS = 5;

export const PartyMemberV1Schema = z.strictObject({
  playerId: PlayerId,
  handle: z.string().min(1).max(64),
  joinedAt: z.string().datetime(),
  colonyId: HomeColonyId.nullable().optional(),
  reservedSectorId: SectorIdSchema.nullable().optional(),
  reservedLandingSlotId: LandingSlotIdSchema.nullable().optional(),
  spawnStatus: z.enum(['PENDING', 'RESERVED', 'ASSIGNED', 'FAILED']).optional(),
});
export type PartyMemberV1 = z.infer<typeof PartyMemberV1Schema>;

export const PartyV1Schema = z.strictObject({
  id: z.string().min(1).max(64),
  code: z.string().min(4).max(16),
  leaderId: PlayerId,
  planetId: HomePlanetId.nullable(),
  sectorIntent: SectorPlacementIntentV1Schema.nullable(),
  state: z.enum(['OPEN', 'QUEUED', 'RESERVED', 'SPAWNING', 'ASSIGNED', 'PARTIAL', 'CANCELLED']),
  members: z.array(PartyMemberV1Schema).min(1).max(PARTY_MAX_MEMBERS),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PartyV1 = z.infer<typeof PartyV1Schema>;

/**
 * `HomeV1` (CONTINUITY §2 + MATCHMAKING §0.3):
 * Canonical world and founding-sector context on ACTIVE/ELIMINATED/PLANET_ENDED,
 * ticket + sectorIntent on QUEUED, and three persistent `PlanetSummaryV1` worlds on NEW/ELIMINATED/PLANET_ENDED.
 */
export const HomeColonyV1Schema = z.strictObject({
  id: HomeColonyId,
  playerId: PlayerId.optional(),
  planetId: HomePlanetId,
  colonyIndex: z.number().int().nonnegative(),
  name: z.string().min(1).max(64),
  color: z.number().int().nonnegative(),
  state: z.string().min(1).max(32),
  status: z.string().min(1).max(32).optional(),
  foundingSectorId: SectorIdSchema,
  landingSlotId: LandingSlotIdSchema.optional(),
  spawnQ: TileCoord,
  spawnR: TileCoord,
});
export type HomeColonyV1 = z.infer<typeof HomeColonyV1Schema>;

export const HomeRecapV1Schema = z.strictObject({
  colonyId: HomeColonyId,
  planetId: HomePlanetId,
  foundingSectorId: SectorIdSchema,
  survivedS: z.number().int().nonnegative().optional(),
  cause: z.string().min(1).max(64).optional(),
  recapSeen: z.boolean().optional(),
});
export type HomeRecapV1 = z.infer<typeof HomeRecapV1Schema>;

export const HomeResultsV1Schema = z.strictObject({
  colonyId: HomeColonyId,
  planetId: HomePlanetId,
  foundingSectorId: SectorIdSchema,
  rank: z.number().int().positive().optional(),
  territoryPct: z.number().nonnegative().optional(),
  terraformPct: z.number().nonnegative().optional(),
  survived: z.boolean().optional(),
  recapSeen: z.boolean().optional(),
});
export type HomeResultsV1 = z.infer<typeof HomeResultsV1Schema>;

export const HomeV1Schema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('NEW'),
    planets: z.array(PlanetSummaryV1Schema).length(3),
    queuePaused: z.boolean().optional(),
  }),
  z.strictObject({
    state: z.literal('QUEUED'),
    ticketId: z.string().min(1).max(64),
    ticketState: TicketStateV1Schema,
    planetId: HomePlanetId,
    planetType: PlanetType,
    sectorIntent: SectorPlacementIntentV1Schema,
    reservedSectorId: SectorIdSchema.nullable().optional(),
    alternativeSectors: z.array(SectorIdSchema).optional(),
    position: z.number().int().nonnegative(),
    etaS: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    state: z.literal('ACTIVE'),
    colony: HomeColonyV1Schema,
    planet: PlanetSummaryV1Schema,
    away: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    state: z.literal('ELIMINATED'),
    colony: HomeColonyV1Schema.optional(),
    planet: PlanetSummaryV1Schema.optional(),
    recap: HomeRecapV1Schema,
    recapSeen: z.boolean(),
    planets: z.array(PlanetSummaryV1Schema).length(3),
  }),
  z.strictObject({
    state: z.literal('PLANET_ENDED'),
    colony: HomeColonyV1Schema.optional(),
    planet: PlanetSummaryV1Schema.optional(),
    results: HomeResultsV1Schema,
    recapSeen: z.boolean(),
    planets: z.array(PlanetSummaryV1Schema).length(3),
  }),
]);
export type HomeV1 = z.infer<typeof HomeV1Schema>;
