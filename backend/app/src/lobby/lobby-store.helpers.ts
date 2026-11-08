import { randomBytes } from 'node:crypto';
import {
  CANONICAL_PLANETS,
  deriveSectorOccupancy,
  formatLandingSlotId,
  parseMatchTicketRequest,
  parseSectorId,
  planetLookForType,
  W11_DEFAULT_SECTOR_RADIUS,
  type EnqueueTicketRequestV1,
  type NormalizedTicketIntentV1,
  type PlanetLook,
  type PlanetType,
  type SectorPlacementIntentV1,
  type TicketStateV1,
  type WorldAdmissionState,
  type WorldHealthState,
  type WorldLifecycleState,
} from '@terra/contracts';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type ProvisionCanonicalWorldInput,
  type UpsertSectorWithSlotsInput,
} from './lobby-persistence.types';

export const DEFAULT_RESERVATION_TTL_MS = 90_000;
export const ACTIVE_TICKET_STATES: readonly TicketStateV1[] = ['QUEUED', 'RESERVED', 'SPAWNING'];

/**
 * Per-key FIFO async mutex so concurrent operations on the same canonical type, planet, ticket, or party
 * serialize deterministically without race conditions.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, tail);
    void tail.finally(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return next;
  }
}

export interface NormalizedCanonicalWorldSpec {
  readonly id: string;
  readonly name: string;
  readonly type: PlanetType;
  readonly canonicalType: PlanetType;
  readonly look: PlanetLook;
  readonly seed: string;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly capacity: number;
  readonly atlasVersion: number;
  readonly atlasHash: string;
  readonly configHash: string;
}

/**
 * Validates and normalizes `ProvisionCanonicalWorldInput` against `CANONICAL_PLANETS[type]`.
 * Rejects non-canonical IDs or mismatched `look` with `LobbyPersistenceConflictError('canonical_type_conflict')`.
 */
export function normalizeCanonicalWorldInput(input: ProvisionCanonicalWorldInput): NormalizedCanonicalWorldSpec {
  const canonical = CANONICAL_PLANETS[input.type];
  if (!canonical) {
    throw new LobbyPersistenceConflictError(
      'canonical_type_conflict',
      `unsupported canonical planet type "${String(input.type)}"`,
      { type: input.type },
    );
  }
  const id = input.id ?? input.manifest?.planetId ?? canonical.id;
  if (id !== canonical.id) {
    throw new LobbyPersistenceConflictError(
      'canonical_type_conflict',
      `canonical planet for type "${input.type}" must use canonical id "${canonical.id}", got "${id}"`,
      { type: input.type, expectedId: canonical.id, actualId: id },
    );
  }
  const expectedLook = planetLookForType(input.type);
  const look = input.look ?? input.manifest?.look ?? expectedLook;
  if (look !== expectedLook) {
    throw new LobbyPersistenceConflictError(
      'canonical_type_conflict',
      `canonical planet "${id}" of type "${input.type}" requires look "${expectedLook}", got "${look}"`,
      { type: input.type, expectedLook, actualLook: look },
    );
  }
  if (input.manifest && input.manifest.planetType !== input.type) {
    throw new LobbyPersistenceConflictError(
      'canonical_type_conflict',
      `manifest planetType "${input.manifest.planetType}" does not match requested type "${input.type}"`,
      { type: input.type, manifestPlanetType: input.manifest.planetType },
    );
  }
  const seed = input.seed ?? input.manifest?.seed ?? canonical.seed;
  return {
    id,
    name: input.name ?? canonical.name,
    type: input.type,
    canonicalType: input.type,
    look,
    seed,
    lifecycle: input.lifecycle ?? 'ACTIVE',
    health: input.health ?? 'OK',
    admission: input.admission ?? 'OPEN',
    capacity: input.capacity ?? input.manifest?.validatedCapacity ?? 28,
    atlasVersion: input.manifest?.atlasVersion ?? 1,
    atlasHash: input.manifest?.atlasHash ?? '',
    configHash: input.manifest?.configHash ?? '',
  };
}

/**
 * Verifies that an already-persisted canonical world row matches the requested canonical world spec.
 */
export function assertCanonicalWorldCompatible(
  existing: CanonicalWorldRecord,
  requested: NormalizedCanonicalWorldSpec,
): void {
  if (
    existing.id !== requested.id ||
    existing.type !== requested.type ||
    existing.canonicalType !== requested.canonicalType ||
    existing.look !== requested.look ||
    existing.seed !== requested.seed
  ) {
    throw new LobbyPersistenceConflictError(
      'canonical_type_conflict',
      `canonical world for "${requested.type}" is already provisioned as (${existing.id}, seed=${existing.seed})`,
      {
        type: requested.type,
        existingId: existing.id,
        requestedId: requested.id,
        existingSeed: existing.seed,
        requestedSeed: requested.seed,
      },
    );
  }
}

export function normalizeSectorSlotsInput(input: UpsertSectorWithSlotsInput) {
  const parsed = parseSectorId(input.sectorId);
  if (!parsed) {
    throw new LobbyPersistenceConflictError('sector_not_found', `invalid sectorId "${input.sectorId}"`, {
      sectorId: input.sectorId,
    });
  }
  const kind = input.kind ?? 'land';
  const radius = input.radius ?? W11_DEFAULT_SECTOR_RADIUS;
  const stride = radius * 2 + 1;
  const macroQ = input.macroQ ?? parsed.macroQ;
  const macroR = input.macroR ?? parsed.macroR;
  const centerQ = input.centerQ ?? macroQ * stride;
  const centerR = input.centerR ?? macroR * stride;
  const foundingCapacity = kind === 'ocean' ? 0 : input.foundingCapacity;
  const validatedCapacity = kind === 'ocean' ? 0 : Math.min(foundingCapacity, input.validatedCapacity);

  const slots =
    input.slots?.map((s) => ({
      landingSlotId: s.slotId ?? formatLandingSlotId(input.sectorId, s.slotIndex),
      slotIndex: s.slotIndex,
      q: s.q,
      r: s.r,
    })) ??
    Array.from({ length: validatedCapacity }, (_, slotIndex) => ({
      landingSlotId: formatLandingSlotId(input.sectorId, slotIndex),
      slotIndex,
      q: centerQ + slotIndex * 4,
      r: centerR,
    }));

  return {
    planetId: input.planetId,
    sectorId: input.sectorId,
    continentId: input.continentId === undefined ? (kind === 'land' ? 'cont_0' : null) : input.continentId,
    macroQ,
    macroR,
    centerQ,
    centerR,
    kind,
    radius,
    foundingCapacity,
    validatedCapacity,
    mainResource: input.mainResource,
    scarceResources: input.scarceResources,
    slots,
  };
}

export function computeFreeSectorSeats(
  kind: 'land' | 'ocean',
  foundingCapacity: number,
  validatedCapacity: number,
  reservedSeats: number,
  foundedSeats: number,
): number {
  return deriveSectorOccupancy({
    kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
  }).freeSeats;
}

export function normalizeTicketIntentOrThrow(
  raw: EnqueueTicketRequestV1 | NormalizedTicketIntentV1,
): NormalizedTicketIntentV1 {
  if ('sectorIntent' in raw && typeof raw.sectorIntent === 'object' && raw.sectorIntent !== null) {
    const req: EnqueueTicketRequestV1 = {
      mode: raw.mode,
      planetId: raw.planetId,
      planetType: raw.planetType,
      ...(raw.sectorIntent.kind === 'chosen' ? { sectorId: raw.sectorIntent.sectorId } : { autoSector: true }),
      ...(raw.partyId ? { partyId: raw.partyId } : {}),
      ...(raw.sourcePlanetId ? { sourcePlanetId: raw.sourcePlanetId } : {}),
      ...(raw.sourceColonyId ? { sourceColonyId: raw.sourceColonyId } : {}),
      ...(raw.carryOver ? { carryOver: raw.carryOver } : {}),
    };
    const parsed = parseMatchTicketRequest(req);
    if (!parsed.ok) {
      throw new LobbyPersistenceConflictError(
        parsed.errorCode === 'validation_error' ? 'invalid_ticket_intent' : parsed.errorCode,
        parsed.message,
      );
    }
    return parsed.value;
  }
  const parsed = parseMatchTicketRequest(raw);
  if (!parsed.ok) {
    throw new LobbyPersistenceConflictError(
      parsed.errorCode === 'validation_error' ? 'invalid_ticket_intent' : parsed.errorCode,
      parsed.message,
    );
  }
  return parsed.value;
}

export function sameSectorIntent(a: SectorPlacementIntentV1, b: SectorPlacementIntentV1): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'chosen' && b.kind === 'chosen') return a.sectorId === b.sectorId;
  return true;
}

export function generatePartyCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
