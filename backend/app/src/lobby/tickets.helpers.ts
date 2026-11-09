import {
  CANONICAL_PLANETS,
  parseMatchTicketRequest,
  SUPPORTED_MATCH_MODES,
  type HomeColonyV1,
  type LandingSlotId,
  type MatchModeV1,
  type MatchTicketV1,
  type NormalizedTicketIntentV1,
  type PlanetSummaryV1,
  type PlanetType,
  type SectorId,
  type SectorPlacementIntentV1,
} from '@terra/contracts';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
} from './lobby-persistence.types';
import { buildCanonicalPlanetSummaryV1 } from './planets.helpers';
import {
  MatchTicketBadRequestException,
  type ActiveHomeV1,
  type EnqueueMatchTicketOptions,
  type EnqueueMatchTicketServiceInput,
} from './tickets.types';

export interface NormalizedServiceEnqueueCall {
  readonly playerId: string;
  readonly rawRequest: unknown;
  readonly idempotencyKey?: string;
  readonly priority?: number;
  readonly now?: Date;
}

function isObjectRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

export function normalizePlayerId(
  playerOrId: string | { readonly id: string; readonly handle?: string } | undefined,
): string {
  if (typeof playerOrId === 'string') return playerOrId.trim();
  if (isObjectRecord(playerOrId) && typeof playerOrId.id === 'string') return playerOrId.id.trim();
  return '';
}

export function extractEnqueueCallArgs(
  firstArg: string | { readonly id: string } | EnqueueMatchTicketServiceInput,
  secondArg?: unknown,
  thirdArg?: EnqueueMatchTicketOptions | string,
): NormalizedServiceEnqueueCall {
  if (typeof firstArg === 'string' || (isObjectRecord(firstArg) && 'id' in firstArg && secondArg !== undefined)) {
    const playerId = normalizePlayerId(firstArg as string | { readonly id: string });
    const opts: EnqueueMatchTicketOptions =
      typeof thirdArg === 'string' ? { idempotencyKey: thirdArg } : (thirdArg ?? {});
    return {
      playerId,
      rawRequest: secondArg,
      idempotencyKey: opts.idempotencyKey,
      priority: opts.priority,
      now: opts.now,
    };
  }

  const input = firstArg as EnqueueMatchTicketServiceInput;
  const playerId = normalizePlayerId(input.player ?? input.playerId);
  const rawRequest =
    input.request ??
    input.body ?? {
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.planetId !== undefined ? { planetId: input.planetId } : {}),
      ...(input.planetType !== undefined ? { planetType: input.planetType } : {}),
      ...(input.sectorId !== undefined ? { sectorId: input.sectorId } : {}),
      ...(input.autoSector !== undefined ? { autoSector: input.autoSector } : {}),
      ...(input.partyId !== undefined ? { partyId: input.partyId } : {}),
      ...(input.sourcePlanetId !== undefined ? { sourcePlanetId: input.sourcePlanetId } : {}),
      ...(input.sourceColonyId !== undefined ? { sourceColonyId: input.sourceColonyId } : {}),
      ...(input.carryOver !== undefined ? { carryOver: input.carryOver } : {}),
    };

  return {
    playerId,
    rawRequest,
    idempotencyKey: input.idempotencyKey,
    priority: input.priority,
    now: input.now,
  };
}

function toRawRequestFromNormalized(raw: Record<string, unknown>): Record<string, unknown> {
  let next: Record<string, unknown> = { ...raw };
  if (isObjectRecord(next.sectorIntent)) {
    const si = next.sectorIntent as { kind?: unknown; mode?: unknown; sectorId?: unknown };
    const { sectorIntent: _omit, ...rest } = next;
    const kindOrMode = si.kind ?? si.mode;
    next = {
      ...rest,
      ...(kindOrMode === 'chosen' && typeof si.sectorId === 'string'
        ? { sectorId: si.sectorId }
        : kindOrMode === 'auto'
          ? { autoSector: true }
          : {}),
    };
  }
  if (isObjectRecord(next.transferCarry)) {
    const tc = next.transferCarry as {
      sourcePlanetId?: unknown;
      sourceColonyId?: unknown;
      carryOver?: unknown;
    };
    const { transferCarry: _omitTc, ...rest } = next;
    next = {
      ...rest,
      ...(next.sourcePlanetId === undefined && typeof tc.sourcePlanetId === 'string'
        ? { sourcePlanetId: tc.sourcePlanetId }
        : {}),
      ...(next.sourceColonyId === undefined && typeof tc.sourceColonyId === 'string'
        ? { sourceColonyId: tc.sourceColonyId }
        : {}),
      ...(next.carryOver === undefined && isObjectRecord(tc.carryOver)
        ? { carryOver: tc.carryOver }
        : {}),
    };
  }
  return next;
}

/**
 * Validates and normalizes the ticket request payload using `parseMatchTicketRequest` from `@terra/contracts`.
 * Throws 400 `MatchTicketBadRequestException` with `unsupported_mode`, `same_planet_transfer`, or `validation_error`.
 */
export function parseAndValidateTicketIntent(raw: unknown): {
  readonly intent: NormalizedTicketIntentV1;
  readonly bodyIdempotencyKey?: string;
} {
  if (!isObjectRecord(raw)) {
    throw new MatchTicketBadRequestException('validation_error', 'Match ticket request body must be an object');
  }

  const bodyIdempotencyKey =
    typeof raw.idempotencyKey === 'string' && raw.idempotencyKey.trim().length > 0
      ? raw.idempotencyKey.trim()
      : undefined;

  const { idempotencyKey: _ignoredKey, ...withoutKey } = toRawRequestFromNormalized(raw);

  const rawMode = withoutKey.mode;
  if (typeof rawMode === 'string' && !SUPPORTED_MATCH_MODES.includes(rawMode as MatchModeV1)) {
    throw new MatchTicketBadRequestException(
      'unsupported_mode',
      rawMode === 'NEW_PLANET'
        ? 'NEW_PLANET is not supported: canonical persistent worlds never create on-demand planet instances'
        : `unsupported_mode: "${rawMode}" is not a supported matchmaking mode`,
    );
  }

  if (rawMode === 'TRANSFER' && typeof withoutKey.sourcePlanetId === 'string') {
    const reqPlanetType = withoutKey.planetType as PlanetType | undefined;
    const resolvedTargetId =
      typeof withoutKey.planetId === 'string'
        ? withoutKey.planetId
        : reqPlanetType && reqPlanetType in CANONICAL_PLANETS
          ? CANONICAL_PLANETS[reqPlanetType].id
          : undefined;
    if (resolvedTargetId && resolvedTargetId === withoutKey.sourcePlanetId) {
      throw new MatchTicketBadRequestException(
        'same_planet_transfer',
        'TRANSFER must select an eligible different canonical planet',
      );
    }
  }

  const parsed = parseMatchTicketRequest(withoutKey);
  if (!parsed.ok) {
    throw new MatchTicketBadRequestException(parsed.errorCode, parsed.message);
  }
  return { intent: parsed.value, bodyIdempotencyKey };
}

export function computeAlternativeSectorsForIntent(
  sectors: readonly PlanetSectorRecord[],
  sectorIntent: SectorPlacementIntentV1,
): SectorId[] {
  const kind =
    (sectorIntent as { kind?: string; mode?: string }).kind ??
    (sectorIntent as { mode?: string }).mode;
  if (kind !== 'chosen' || sectors.length === 0) return [];
  const chosenSectorId = (sectorIntent as { sectorId: SectorId }).sectorId;
  const chosen = sectors.find((s) => s.sectorId === chosenSectorId);
  if (!chosen || chosen.freeSeats > 0) return [];
  return sectors
    .filter((s) => s.kind === 'land' && s.freeSeats > 0 && s.sectorId !== chosenSectorId)
    .sort(
      (a, b) =>
        b.reservedSeats + b.foundedSeats - (a.reservedSeats + a.foundedSeats) ||
        a.sectorId.localeCompare(b.sectorId),
    )
    .map((s) => s.sectorId);
}

export function computeQueuePositionAndEta(
  ticket: MatchTicketRecord,
  queuedOnPlanet: readonly MatchTicketRecord[],
  paused: boolean,
): { readonly position: number | null; readonly etaS: number | null } {
  if (ticket.state !== 'QUEUED') {
    return { position: null, etaS: null };
  }
  const idx = queuedOnPlanet.findIndex((t) => t.id === ticket.id);
  const position = idx >= 0 ? idx : 0;
  const etaS = paused ? null : position * 5;
  return { position, etaS };
}

export function formatMatchTicketV1(
  record: MatchTicketRecord,
  extras: {
    readonly position: number | null;
    readonly etaS: number | null;
    readonly alternativeSectors: readonly SectorId[];
  },
): MatchTicketV1 {
  return {
    id: record.id,
    playerId: record.playerId,
    ...(record.partyId !== undefined ? { partyId: record.partyId } : {}),
    mode: record.mode,
    planetId: record.planetId,
    planetType: record.planetType,
    sectorIntent: record.sectorIntent,
    state: record.state,
    priority: record.priority,
    position: extras.position,
    etaS: extras.etaS,
    colonyId: record.colonyId,
    reservedPlanetId: record.reservedPlanetId,
    reservedSectorId: record.reservedSectorId,
    reservedLandingSlotId: record.reservedLandingSlotId,
    ...(record.reservationEpoch !== undefined ? { reservationEpoch: record.reservationEpoch } : {}),
    reservationExpiresAt: record.reservationExpiresAt,
    alternativeSectors: [...extras.alternativeSectors],
    attempts: record.attempts,
    failureCode: record.failureCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function buildPlanetSummaryV1ForHome(
  world: CanonicalWorldRecord | null,
  sectors: readonly PlanetSectorRecord[],
  fallbackPlanetId: string,
  fallbackType: PlanetType,
): PlanetSummaryV1 {
  return buildCanonicalPlanetSummaryV1({
    world,
    sectors,
    fallbackPlanetId,
    fallbackType,
    planetLiveCounts: {
      livingColonies: 1,
      presentColonies: 1,
      onlinePlayers: 1,
    },
  });
}

export function buildActiveHomeSummary(
  colonyInput: {
    readonly id: string;
    readonly playerId: string;
    readonly planetId: string;
    readonly colonyIndex: number;
    readonly name: string;
    readonly color: number;
    readonly foundingSectorId: SectorId;
    readonly landingSlotId?: LandingSlotId;
    readonly spawnQ: number;
    readonly spawnR: number;
  },
  world: CanonicalWorldRecord | null,
  sectors: readonly PlanetSectorRecord[],
  fallbackType: PlanetType = 'desert',
): ActiveHomeV1 {
  const colony: HomeColonyV1 = {
    id: colonyInput.id,
    playerId: colonyInput.playerId,
    planetId: colonyInput.planetId,
    colonyIndex: colonyInput.colonyIndex,
    name: colonyInput.name,
    color: colonyInput.color,
    state: 'ACTIVE',
    status: 'ACTIVE',
    foundingSectorId: colonyInput.foundingSectorId,
    ...(colonyInput.landingSlotId ? { landingSlotId: colonyInput.landingSlotId } : {}),
    spawnQ: colonyInput.spawnQ,
    spawnR: colonyInput.spawnR,
  };
  const planet = buildPlanetSummaryV1ForHome(world, sectors, colonyInput.planetId, fallbackType);
  return {
    state: 'ACTIVE',
    colony,
    planet,
  };
}
