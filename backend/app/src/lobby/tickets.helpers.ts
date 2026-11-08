import {
  CANONICAL_PLANETS,
  canonicalPlanetById,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  parseMatchTicketRequest,
  planetLookForType,
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
  type SectorSummaryV1,
} from '@terra/contracts';
import { buildDefaultCanonicalAtlasManifest } from './atlas-manifest.helper';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
} from './lobby-persistence.types';
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
  if (!isObjectRecord(raw.sectorIntent)) return raw;
  const si = raw.sectorIntent as { kind?: unknown; sectorId?: unknown };
  const { sectorIntent: _omit, ...rest } = raw;
  return {
    ...rest,
    ...(si.kind === 'chosen' && typeof si.sectorId === 'string'
      ? { sectorId: si.sectorId }
      : si.kind === 'auto'
        ? { autoSector: true }
        : {}),
  };
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
  if (sectorIntent.kind !== 'chosen' || sectors.length === 0) return [];
  const chosen = sectors.find((s) => s.sectorId === sectorIntent.sectorId);
  if (!chosen || chosen.freeSeats > 0) return [];
  return sectors
    .filter((s) => s.kind === 'land' && s.freeSeats > 0 && s.sectorId !== sectorIntent.sectorId)
    .map((s) => s.sectorId)
    .sort((a, b) => a.localeCompare(b));
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

function toSectorSummaryV1(
  world: Pick<CanonicalWorldRecord, 'lifecycle' | 'health' | 'admission'>,
  sec: PlanetSectorRecord,
): SectorSummaryV1 {
  const occ = deriveSectorOccupancy({
    kind: sec.kind,
    foundingCapacity: sec.foundingCapacity,
    validatedCapacity: sec.validatedCapacity,
    reservedSeats: sec.reservedSeats,
    foundedSeats: sec.foundedSeats,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
  });
  return {
    sectorId: sec.sectorId,
    continentId: sec.continentId,
    macroQ: sec.macroQ,
    macroR: sec.macroR,
    centerQ: sec.centerQ,
    centerR: sec.centerR,
    kind: sec.kind,
    foundingCapacity: sec.foundingCapacity,
    validatedCapacity: sec.validatedCapacity,
    reservedSeats: sec.reservedSeats,
    foundedSeats: sec.foundedSeats,
    freeSeats: occ.freeSeats,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    availability: occ.availability,
    ...(sec.mainResource ? { mainResource: sec.mainResource } : {}),
    ...(sec.scarceResources ? { scarceResources: [...sec.scarceResources] } : {}),
  };
}

export function buildPlanetSummaryV1ForHome(
  world: CanonicalWorldRecord | null,
  sectors: readonly PlanetSectorRecord[],
  fallbackPlanetId: string,
  fallbackType: PlanetType,
): PlanetSummaryV1 {
  const canonicalDef = canonicalPlanetById(fallbackPlanetId) ?? CANONICAL_PLANETS[fallbackType];
  const type = world?.type ?? canonicalDef.type;
  const lifecycle = world?.lifecycle ?? 'ACTIVE';
  const health = world?.health ?? 'OK';
  const admission = world?.admission ?? 'OPEN';

  const effectiveSectors: SectorSummaryV1[] =
    sectors.length > 0
      ? sectors.map((s) => toSectorSummaryV1({ lifecycle, health, admission }, s))
      : buildDefaultCanonicalAtlasManifest(type).sectors.map((mSec) => ({
          sectorId: mSec.sectorId,
          continentId: mSec.continentId,
          macroQ: mSec.macroQ,
          macroR: mSec.macroR,
          centerQ: mSec.centerQ,
          centerR: mSec.centerR,
          kind: mSec.kind,
          foundingCapacity: mSec.foundingCapacity,
          validatedCapacity: mSec.validatedSafeSites,
          reservedSeats: 0,
          foundedSeats: 1,
          freeSeats: Math.max(0, mSec.validatedSafeSites - 1),
          livingColonies: null,
          presentColonies: null,
          onlinePlayers: null,
          availability: deriveWorldAvailability({
            lifecycle,
            health,
            admission,
            freeSeats: Math.max(0, mSec.validatedSafeSites - 1),
            sectorKind: mSec.kind,
          }),
        }));

  const landSectors = effectiveSectors.filter((s) => s.kind === 'land');
  const oceanSectors = effectiveSectors.filter((s) => s.kind === 'ocean');
  const nominalCapacity = landSectors.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const validatedCapacity = landSectors.reduce((sum, s) => sum + s.validatedCapacity, 0);
  const reservedSeats = landSectors.reduce((sum, s) => sum + s.reservedSeats, 0);
  const foundedSeats = landSectors.reduce((sum, s) => sum + s.foundedSeats, 0);
  const freeSeats = Math.max(0, validatedCapacity - reservedSeats - foundedSeats);

  return {
    id: world?.id ?? fallbackPlanetId,
    name: world?.name ?? canonicalDef.name,
    type,
    look: world?.look ?? planetLookForType(type),
    lifecycle,
    health,
    admission,
    availability: deriveWorldAvailability({ lifecycle, health, admission, freeSeats }),
    atlasVersion: world?.atlasVersion || 1,
    atlasHash: world?.atlasHash || 'w11-canonical-atlas-v1',
    configHash: world?.configHash || 'w11-canonical-config-v1',
    totalSectors: effectiveSectors.length,
    landSectors: Math.max(1, landSectors.length),
    oceanSectors: oceanSectors.length,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies: 1,
    presentColonies: 1,
    onlinePlayers: 1,
    updatedAt: (world?.updatedAt ?? new Date()).toISOString(),
    sectors: effectiveSectors,
    ...(world?.faultCode ? { faultCode: world.faultCode } : {}),
  };
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
