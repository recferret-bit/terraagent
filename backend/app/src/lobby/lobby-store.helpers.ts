import { AsyncLocalStorage } from 'node:async_hooks';
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
  type EnqueueTicketRequestInput,
  type ProvisionCanonicalWorldInput,
  type SectorIntentInput,
  type SectorIntentWithMode,
  type TransferCarryRecord,
  type UpsertSectorWithSlotsInput,
} from './lobby-persistence.types';

export const DEFAULT_RESERVATION_TTL_MS = 90_000;
export const ACTIVE_TICKET_STATES: readonly TicketStateV1[] = ['QUEUED', 'RESERVED', 'SPAWNING'];

const heldMutexKeys = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Per-key FIFO async mutex so concurrent operations on the same canonical type, planet, ticket, or party
 * serialize deterministically without race conditions. Re-entrant within the same async execution context.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly instanceId = randomBytes(4).toString('hex');

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const scopedKey = `${this.instanceId}:${key}`;
    const held = heldMutexKeys.getStore();
    if (held?.has(scopedKey)) {
      return fn();
    }
    const prev = this.chains.get(key) ?? Promise.resolve();
    const runScoped = () => heldMutexKeys.run(new Set([...(held ?? []), scopedKey]), fn);
    const next = prev.then(runScoped, runScoped);
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

export function withSectorIntentModeAlias(intent: SectorPlacementIntentV1): SectorIntentWithMode {
  const base: SectorPlacementIntentV1 =
    intent.kind === 'chosen'
      ? { kind: 'chosen', sectorId: intent.sectorId }
      : { kind: 'auto' };
  Object.defineProperty(base, 'mode', {
    value: base.kind,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return base as SectorIntentWithMode;
}

export function normalizeSectorIntentInput(
  input: SectorIntentInput | string | null | undefined,
): SectorIntentWithMode {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed || trimmed === 'auto') {
      return withSectorIntentModeAlias({ kind: 'auto' });
    }
    return withSectorIntentModeAlias({ kind: 'chosen', sectorId: trimmed });
  }
  if (typeof input === 'object' && input !== null) {
    const raw = input as { kind?: unknown; mode?: unknown; sectorId?: unknown };
    const kind = raw.kind ?? raw.mode;
    if (kind === 'chosen' && typeof raw.sectorId === 'string' && raw.sectorId.trim().length > 0) {
      return withSectorIntentModeAlias({ kind: 'chosen', sectorId: raw.sectorId.trim() });
    }
    if (kind === 'auto') {
      return withSectorIntentModeAlias({ kind: 'auto' });
    }
  }
  throw new LobbyPersistenceConflictError(
    'invalid_ticket_intent',
    'Invalid sector placement intent: expected { kind/mode: "auto" } or { kind/mode: "chosen", sectorId }',
  );
}

export function extractTransferCarryFromInput(
  raw: EnqueueTicketRequestInput,
  intent: NormalizedTicketIntentV1,
  explicitCarry?: Partial<TransferCarryRecord> | null,
): TransferCarryRecord | null {
  const rawRec = raw as {
    sourcePlanetId?: string;
    sourceColonyId?: string;
    carryOver?: Readonly<Record<string, unknown>>;
    transferCarry?: Partial<TransferCarryRecord> | null;
  };
  const merged = explicitCarry ?? rawRec.transferCarry ?? null;
  const sourcePlanetId =
    merged?.sourcePlanetId ?? intent.sourcePlanetId ?? rawRec.sourcePlanetId ?? '';
  const sourceColonyId =
    merged?.sourceColonyId ?? intent.sourceColonyId ?? rawRec.sourceColonyId ?? '';
  const carryOver = merged?.carryOver ?? intent.carryOver ?? rawRec.carryOver;

  if (!sourcePlanetId && !sourceColonyId && !carryOver) {
    return null;
  }
  return {
    sourcePlanetId,
    sourceColonyId,
    ...(carryOver ? { carryOver: { ...carryOver } } : {}),
  };
}

export function normalizeTicketIntentOrThrow(
  raw: EnqueueTicketRequestInput,
  fallbackTransferCarry?: Partial<TransferCarryRecord> | null,
): NormalizedTicketIntentV1 {
  const rawRec = raw as Record<string, unknown>;
  const rawTc =
    (typeof rawRec.transferCarry === 'object' && rawRec.transferCarry !== null
      ? (rawRec.transferCarry as Partial<TransferCarryRecord>)
      : undefined) ??
    fallbackTransferCarry ??
    undefined;
  const sourcePlanetId =
    (typeof rawRec.sourcePlanetId === 'string' ? rawRec.sourcePlanetId : undefined) ??
    rawTc?.sourcePlanetId;
  const sourceColonyId =
    (typeof rawRec.sourceColonyId === 'string' ? rawRec.sourceColonyId : undefined) ??
    rawTc?.sourceColonyId;
  const carryOver =
    (typeof rawRec.carryOver === 'object' && rawRec.carryOver !== null
      ? (rawRec.carryOver as Record<string, unknown>)
      : undefined) ??
    (rawTc?.carryOver ? { ...rawTc.carryOver } : undefined);

  let sectorFields: { sectorId?: string; autoSector?: boolean } = {};
  if ('sectorIntent' in rawRec && typeof rawRec.sectorIntent === 'object' && rawRec.sectorIntent !== null) {
    const si = rawRec.sectorIntent as { kind?: unknown; mode?: unknown; sectorId?: unknown };
    const kind = si.kind ?? si.mode;
    sectorFields =
      kind === 'chosen' && typeof si.sectorId === 'string'
        ? { sectorId: si.sectorId }
        : { autoSector: true };
  } else if (typeof rawRec.sectorId === 'string') {
    sectorFields = { sectorId: rawRec.sectorId };
  } else if (rawRec.autoSector === true || rawRec.mode === 'AUTO' || rawRec.mode === 'TRANSFER') {
    sectorFields = { autoSector: true };
  }

  const req: EnqueueTicketRequestV1 = {
    mode: String(rawRec.mode ?? ''),
    ...(typeof rawRec.planetId === 'string' ? { planetId: rawRec.planetId } : {}),
    ...(typeof rawRec.planetType === 'string' ? { planetType: rawRec.planetType as PlanetType } : {}),
    ...sectorFields,
    ...(typeof rawRec.partyId === 'string' ? { partyId: rawRec.partyId } : {}),
    ...(sourcePlanetId ? { sourcePlanetId } : {}),
    ...(sourceColonyId ? { sourceColonyId } : {}),
    ...(carryOver ? { carryOver } : {}),
  };

  const parsed = parseMatchTicketRequest(req);
  if (parsed.ok) {
    return {
      ...parsed.value,
      sectorIntent: withSectorIntentModeAlias(parsed.value.sectorIntent),
    };
  }
  if (req.mode === 'TRANSFER' && parsed.errorCode !== 'unsupported_mode') {
    const planetType: PlanetType =
      req.planetType ??
      (req.planetId === CANONICAL_PLANETS.ocean.id
        ? 'ocean'
        : req.planetId === CANONICAL_PLANETS.temperate.id
          ? 'temperate'
          : 'desert');
    const planetId = req.planetId ?? CANONICAL_PLANETS[planetType].id;
    const sectorIntent = withSectorIntentModeAlias(
      req.sectorId ? { kind: 'chosen', sectorId: req.sectorId } : { kind: 'auto' },
    );
    return {
      mode: 'TRANSFER',
      planetId,
      planetType,
      sectorIntent,
      ...(req.partyId ? { partyId: req.partyId } : {}),
      ...(sourcePlanetId ? { sourcePlanetId } : {}),
      ...(sourceColonyId ? { sourceColonyId } : {}),
      ...(carryOver ? { carryOver } : {}),
    };
  }
  throw new LobbyPersistenceConflictError(
    parsed.errorCode === 'validation_error' ? 'invalid_ticket_intent' : parsed.errorCode,
    parsed.message,
  );
}

export function sameSectorIntent(
  a: SectorPlacementIntentV1 | SectorIntentInput,
  b: SectorPlacementIntentV1 | SectorIntentInput,
): boolean {
  const kindA = (a as { kind?: string; mode?: string }).kind ?? (a as { mode?: string }).mode;
  const kindB = (b as { kind?: string; mode?: string }).kind ?? (b as { mode?: string }).mode;
  if (kindA !== kindB) return false;
  if (kindA === 'chosen' && kindB === 'chosen') {
    return (a as { sectorId: string }).sectorId === (b as { sectorId: string }).sectorId;
  }
  return true;
}

export function generatePartyCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
